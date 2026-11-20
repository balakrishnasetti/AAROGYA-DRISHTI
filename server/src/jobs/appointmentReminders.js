import { Appointment, Patient } from '../models/index.js';
import { createNotificationService } from '../services/notificationService.js';

export async function sendAppointmentReminders({
  appointmentModel = Appointment,
  patientModel = Patient,
  notificationService = createNotificationService(),
  logger = console,
  now = new Date(),
} = {}) {
  const startsAt = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const endsAt = new Date(now.getTime() + 25 * 60 * 60 * 1000);
  const appointments = await appointmentModel.find({
    status: { $in: ['accepted', 'confirmed'] },
    slotStart: { $gte: startsAt, $lt: endsAt },
    reminderSentAt: { $exists: false },
  }).select('_id patientId doctorId slotStart').limit(200).lean();
  let sent = 0;

  for (const appointment of appointments) {
    const claimed = await appointmentModel.findOneAndUpdate(
      {
        _id: appointment._id,
        reminderSentAt: { $exists: false },
        $or: [
          { reminderClaimedAt: { $exists: false } },
          { reminderClaimedAt: { $lt: new Date(now.getTime() - 30 * 60 * 1000) } },
        ],
      },
      { $set: { reminderClaimedAt: now } },
      { new: true },
    ).select('_id patientId doctorId');
    if (!claimed) continue;

    try {
      const patient = await patientModel.findById(claimed.patientId).select('userId').lean();
      if (!patient) throw new Error('Appointment patient record not found.');
      await Promise.all([
        notificationService.createNotification({
          userId: patient.userId,
          type: 'reminder',
          channel: 'in_app',
          metadata: { appointmentId: claimed._id.toString() },
        }),
        notificationService.createNotification({
          userId: claimed.doctorId,
          type: 'reminder',
          channel: 'in_app',
          metadata: { appointmentId: claimed._id.toString() },
        }),
      ]);
      await appointmentModel.updateOne(
        { _id: claimed._id, reminderClaimedAt: now },
        { $set: { reminderSentAt: new Date() }, $unset: { reminderClaimedAt: 1 } },
      );
      sent += 1;
    } catch (error) {
      await appointmentModel.updateOne(
        { _id: claimed._id, reminderClaimedAt: now },
        { $unset: { reminderClaimedAt: 1 } },
      );
      logger.error?.(`Appointment reminder failed for ${claimed._id}: ${error.message}`);
    }
  }
  return sent;
}
