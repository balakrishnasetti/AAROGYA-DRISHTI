import mongoose from 'mongoose';
import {
  Appointment,
  Consent,
  DoctorProfile,
  Hospital,
  Patient,
  ScreeningSession,
  TimeSlot,
  UrgentRequest,
  User,
} from '../models/index.js';
import { createNotificationService } from './notificationService.js';
import { ApiError } from '../utils/apiError.js';
import { getAppointableDoctorFilter } from '../utils/providerEligibility.js';

async function createAppointmentWithoutTransaction({
  patientId,
  doctorId,
  hospitalId,
  timeSlotId,
  slotStart,
  screeningSessionId,
  reason,
  consultationMode,
  patientName,
  patientPhone,
  appointmentModel,
}) {
  const [patient, hospital, doctor] = await Promise.all([
    Patient.findOne({ _id: patientId, active: true }).select('_id userId isSynthetic').lean(),
    Hospital.findOne({ _id: hospitalId, status: 'active' }).select('_id isSynthetic').lean(),
    DoctorProfile.findOne({
      userId: doctorId,
      hospitalId,
      $or: getAppointableDoctorFilter(),
    }).select('_id consultationFee isSynthetic').lean(),
  ]);
  if (!patient || !hospital || !doctor) {
    throw new ApiError(404, 'APPOINTMENT_TARGET_NOT_FOUND', 'That appointment option is not available.');
  }

  if (screeningSessionId) {
    const [screening, sharingConsent] = await Promise.all([
      ScreeningSession.findOne({ _id: screeningSessionId, patientId }).select('_id').lean(),
      Consent.findOne({
        patientId,
        consentType: 'data_sharing',
        granted: true,
        withdrawnAt: null,
      }).select('_id').lean(),
    ]);
    if (!screening || !sharingConsent) {
      throw new ApiError(403, 'DATA_SHARING_CONSENT_REQUIRED', 'Active consent is required to link a screening record.');
    }
  }

  const slot = await TimeSlot.findOneAndUpdate(
    {
      _id: timeSlotId,
      doctorId,
      hospitalId,
      startAt: new Date(slotStart),
      status: 'available',
    },
    { $set: { status: 'booked' } },
    { new: true },
  );
  if (!slot) {
    throw new ApiError(409, 'TIME_SLOT_UNAVAILABLE', 'That appointment slot is no longer available.');
  }

  try {
    const existing = await appointmentModel.findOne({
      doctorId,
      slotStart: new Date(slotStart),
      status: { $nin: ['cancelled', 'declined', 'completed', 'missed', 'no_show', 'rescheduled'] },
    }).lean();
    if (existing) {
      throw new ApiError(409, 'TIME_SLOT_UNAVAILABLE', 'That appointment slot is no longer available.');
    }

    const [appointment] = await appointmentModel.create([{
      patientId,
      doctorId,
      hospitalId,
      timeSlotId,
      slotStart: new Date(slotStart),
      screeningSessionId,
      reason,
      consultationMode,
      paymentOption: 'pay_at_hospital',
      paymentStatus: 'due_at_hospital',
      feeAmount: doctor.consultationFee ?? 0,
      currency: 'INR',
      patientNameAtBooking: patientName,
      patientPhoneAtBooking: patientPhone,
      isSynthetic:
        patient.isSynthetic === true || hospital.isSynthetic === true || doctor.isSynthetic === true,
    }]);
    return { appointment, patientUserId: patient.userId };
  } catch (error) {
    await TimeSlot.updateOne(
      { _id: timeSlotId, status: 'booked' },
      { $set: { status: 'available' } },
    );
    throw error;
  }
}

export function createAppointmentService({
  appointmentModel = Appointment,
  urgentRequestModel = UrgentRequest,
  notificationService = createNotificationService(),
} = {}) {
  return {
    async createAppointmentRequest({
      patientId,
      doctorId,
      hospitalId,
      timeSlotId,
      slotStart,
      screeningSessionId,
      reason,
      consultationMode = 'in_person',
      patientName,
      patientPhone,
      status = 'requested',
    }) {
      if (!mongoose.Types.ObjectId.isValid(patientId)) {
        throw new Error('Invalid patientId');
      }
      if (!mongoose.Types.ObjectId.isValid(doctorId)) {
        throw new Error('Invalid doctorId');
      }
      if (!mongoose.Types.ObjectId.isValid(hospitalId)) {
        throw new Error('Invalid hospitalId');
      }

      const session = await mongoose.startSession();
      try {
        let created;
        let patientUserId;
        try {
          await session.withTransaction(async () => {
          const [patient, hospital, doctor] = await Promise.all([
            Patient.findOne({ _id: patientId, active: true })
              .session(session)
              .select('_id userId isSynthetic'),
            Hospital.findOne({ _id: hospitalId, status: 'active' }).session(session).select('_id isSynthetic'),
            DoctorProfile.findOne({
              userId: doctorId,
              hospitalId,
              $or: getAppointableDoctorFilter(),
            }).session(session).select('_id consultationFee isSynthetic'),
          ]);
          if (!patient || !hospital || !doctor) {
            throw new ApiError(404, 'APPOINTMENT_TARGET_NOT_FOUND', 'That appointment option is not available.');
          }
          patientUserId = patient.userId;
          if (!timeSlotId) {
            throw new ApiError(400, 'TIME_SLOT_REQUIRED', 'Choose an available appointment slot.');
          }
          const slot = await TimeSlot.findOneAndUpdate(
            {
              _id: timeSlotId,
              doctorId,
              hospitalId,
              startAt: new Date(slotStart),
              status: 'available',
            },
            { $set: { status: 'booked' } },
            { new: true, session },
          );
          if (!slot) {
            throw new ApiError(409, 'TIME_SLOT_UNAVAILABLE', 'That appointment slot is no longer available.');
          }
          if (screeningSessionId) {
            const [screening, sharingConsent] = await Promise.all([
              ScreeningSession.findOne({ _id: screeningSessionId, patientId }).session(session).select('_id'),
              Consent.findOne({
                patientId,
                consentType: 'data_sharing',
                granted: true,
                withdrawnAt: null,
              }).session(session).select('_id'),
            ]);
            if (!screening || !sharingConsent) {
              throw new ApiError(403, 'DATA_SHARING_CONSENT_REQUIRED', 'Active consent is required to link a screening record.');
            }
          }
          const existing = await appointmentModel
            .findOne({
              doctorId,
              slotStart: new Date(slotStart),
              status: { $nin: ['cancelled', 'declined', 'completed', 'missed', 'no_show', 'rescheduled'] },
            })
            .session(session)
            .lean();

          if (existing) {
            throw new ApiError(409, 'TIME_SLOT_UNAVAILABLE', 'That appointment slot is no longer available.');
          }

          const result = await appointmentModel.create(
            [
              {
                patientId,
                doctorId,
                hospitalId,
                timeSlotId,
                slotStart: new Date(slotStart),
                screeningSessionId,
                reason,
                consultationMode,
                paymentOption: 'pay_at_hospital',
                paymentStatus: 'due_at_hospital',
                feeAmount: doctor.consultationFee ?? 0,
                currency: 'INR',
                patientNameAtBooking: patientName,
                patientPhoneAtBooking: patientPhone,
                isSynthetic:
                  patient.isSynthetic === true || hospital.isSynthetic === true || doctor.isSynthetic === true,
                status,
              },
            ],
            { session },
          );

            created = result;
          });
        } catch (error) {
          if (error.code !== 20) throw error;
          const fallback = await createAppointmentWithoutTransaction({
            patientId,
            doctorId,
            hospitalId,
            timeSlotId,
            slotStart,
            screeningSessionId,
            reason,
            consultationMode,
            patientName,
            patientPhone,
            appointmentModel,
          });
          created = [fallback.appointment];
          patientUserId = fallback.patientUserId;
        }

        await Promise.all([
          notificationService.createNotification({
            userId: doctorId,
            type: 'request',
            channel: 'in_app',
            metadata: { appointmentId: created[0]._id.toString(), patientId },
          }),
          notificationService.createNotification({
            userId: patientUserId,
            type: 'requested',
            channel: 'in_app',
            metadata: { appointmentId: created[0]._id.toString() },
          }),
        ]);
        return created[0];
      } finally {
        await session.endSession();
      }
    },

    async updateAppointmentStatus({ appointmentId, status, reason, doctorId, patientId }) {
      const ownerFilter = { _id: appointmentId, status: { $in: ['requested', 'accepted', 'confirmed'] } };
      if (doctorId) {
        ownerFilter.doctorId = doctorId;
        if (!['accepted', 'confirmed', 'declined', 'cancelled', 'completed', 'missed'].includes(status)) {
          throw new ApiError(403, 'APPOINTMENT_TRANSITION_FORBIDDEN', 'That status change is not allowed.');
        }
      } else if (patientId) {
        ownerFilter.patientId = patientId;
        if (status !== 'cancelled') {
          throw new ApiError(403, 'APPOINTMENT_TRANSITION_FORBIDDEN', 'Patients can only cancel their own appointment requests.');
        }
      } else {
        throw new ApiError(403, 'APPOINTMENT_ACCESS_FORBIDDEN', 'You cannot update this appointment.');
      }

      const session = await mongoose.startSession();
      let record;
      const update = {
        $set: {
          status,
          cancellationReason: reason,
          ...(status === 'confirmed' ? { confirmedAt: new Date() } : {}),
          ...(status === 'accepted' ? { acceptedAt: new Date() } : {}),
          ...(status === 'cancelled' ? { cancelledAt: new Date() } : {}),
        },
      };
      try {
        try {
          await session.withTransaction(async () => {
            record = await appointmentModel.findOneAndUpdate(ownerFilter, update, {
              new: true,
              session,
            });
            if (record && ['cancelled', 'declined', 'rescheduled'].includes(status)) {
              await TimeSlot.updateOne(
                { _id: record.timeSlotId, status: 'booked' },
                { $set: { status: 'available' } },
                { session },
              );
            }
          });
        } catch (error) {
          if (error.code !== 20) throw error;
          record = await appointmentModel.findOneAndUpdate(ownerFilter, update, { new: true });
          if (record && ['cancelled', 'declined', 'rescheduled'].includes(status)) {
            await TimeSlot.updateOne(
              { _id: record.timeSlotId, status: 'booked' },
              { $set: { status: 'available' } },
            );
          }
        }
      } finally {
        await session.endSession();
      }

      if (!record) {
        throw new ApiError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');
      }

      const patient = await Patient.findById(record.patientId).select('userId').lean();
      const userId = doctorId ? patient?.userId : record.doctorId;
      await notificationService.createNotification({
        userId,
        type: status,
        channel: 'in_app',
        metadata: { appointmentId: record._id.toString() },
      });

      return record;
    },

    async reschedulePatientAppointment({ appointmentId, patientId, timeSlotId, slotStart }) {
      const session = await mongoose.startSession();
      let record;
      try {
        await session.withTransaction(async () => {
          const current = await appointmentModel.findOne({
            _id: appointmentId,
            patientId,
            status: { $in: ['requested', 'accepted', 'confirmed'] },
          }).session(session);
          if (!current) {
            throw new ApiError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');
          }
          const nextStart = new Date(slotStart);
          const nextSlot = await TimeSlot.findOneAndUpdate(
            {
              _id: timeSlotId,
              doctorId: current.doctorId,
              hospitalId: current.hospitalId,
              startAt: nextStart,
              status: 'available',
            },
            { $set: { status: 'booked' } },
            { new: true, session },
          );
          if (!nextSlot) {
            throw new ApiError(409, 'TIME_SLOT_UNAVAILABLE', 'That appointment slot is no longer available.');
          }
          await TimeSlot.updateOne(
            { _id: current.timeSlotId, status: 'booked' },
            { $set: { status: 'available' } },
            { session },
          );
          record = await appointmentModel.findOneAndUpdate(
            { _id: current._id, status: { $in: ['requested', 'accepted', 'confirmed'] } },
            {
              $set: {
                timeSlotId: nextSlot._id,
                slotStart: nextStart,
                previousSlotStart: current.slotStart,
                rescheduledAt: new Date(),
                status: 'requested',
                acceptedAt: undefined,
                confirmedAt: undefined,
              },
            },
            { new: true, session },
          );
          if (!record) {
            throw new ApiError(409, 'APPOINTMENT_UPDATE_CONFLICT', 'The appointment changed. Refresh and try again.');
          }
        });
      } finally {
        await session.endSession();
      }
      if (!record) {
        throw new ApiError(409, 'APPOINTMENT_UPDATE_CONFLICT', 'The appointment changed. Refresh and try again.');
      }
      await notificationService.createNotification({
        userId: record.doctorId,
        type: 'request',
        channel: 'in_app',
        metadata: { appointmentId: record._id.toString(), patientId },
      });
      return record;
    },

    async createUrgentRequest({ patientId, hospitalId, reason, doctorIds = [], status = 'pending' }) {
      const [patient, hospital] = await Promise.all([
        Patient.findOne({ _id: patientId, active: true }).select('_id'),
        Hospital.findOne({ _id: hospitalId, status: 'active' }).select('_id'),
      ]);
      if (!patient || !hospital) {
        throw new ApiError(404, 'URGENT_REQUEST_TARGET_NOT_FOUND', 'That hospital option is not available.');
      }
      const requestedDoctorIds = [...new Set(doctorIds.map((id) => id.toString()))];
      const verifiedDoctors = requestedDoctorIds.length
        ? await DoctorProfile.find({
            userId: { $in: requestedDoctorIds },
            hospitalId,
            verificationStatus: 'verified',
          }).select('userId').lean()
        : [];
      const activeUsers = verifiedDoctors.length
        ? await User.find({
            _id: { $in: verifiedDoctors.map((doctor) => doctor.userId) },
            role: { $in: ['doctor', 'specialist'] },
            status: 'active',
          }).select('_id').lean()
        : [];
      if (activeUsers.length !== requestedDoctorIds.length) {
        throw new ApiError(400, 'URGENT_DOCTORS_INVALID', 'Choose available doctors at the selected hospital.');
      }
      const selectedDoctorIds = activeUsers.map((doctor) => doctor._id);
      const created = await urgentRequestModel.create({
        patientId,
        hospitalId,
        doctorIds: selectedDoctorIds,
        reason,
        status,
      });

      if (selectedDoctorIds.length > 0) {
        for (const doctorId of selectedDoctorIds) {
          await notificationService.createNotification({
            userId: doctorId,
            type: 'urgent_request',
            channel: 'in_app',
            metadata: { urgentRequestId: created._id.toString() },
          });
        }
      }

      return created;
    },

    async resolveUrgentRequest({ urgentRequestId, status, assignedTo, redirectedToHospitalId, notes }) {
      const record = await urgentRequestModel.findByIdAndUpdate(
        urgentRequestId,
        {
          $set: {
            status,
            assignedTo,
            redirectedToHospitalId,
            reviewedAt: new Date(),
            notes,
            ...(status === 'pending' ? { notifiedAt: new Date() } : {}),
          },
        },
        { new: true },
      );

      if (!record) {
        throw new Error('Urgent request not found.');
      }

      if (assignedTo) {
        await notificationService.createNotification({
          userId: assignedTo,
          type: 'urgent_response',
          channel: 'in_app',
          metadata: { urgentRequestId: record._id.toString(), status },
        });
      }

      return record;
    },

    async listOverdueUrgentRequests({ thresholdMinutes = 30 } = {}) {
      const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);
      return urgentRequestModel
        .find({
          status: 'pending',
          createdAt: { $lt: cutoff },
          notifiedAt: { $exists: false },
        })
        .lean();
    },

    async notifyOverdueUrgentRequests({ thresholdMinutes = 30 } = {}) {
      const overdue = await this.listOverdueUrgentRequests({ thresholdMinutes });

      for (const record of overdue) {
        await notificationService.createNotification({
          userId: record.patientId,
          type: 'urgent_request',
          channel: 'in_app',
          metadata: { urgentRequestId: record._id.toString(), overdue: true },
        });

        await urgentRequestModel.findByIdAndUpdate(record._id, {
          $set: { notifiedAt: new Date() },
        });
      }

      return overdue;
    },

    async createReminder({ userId, type = 'reminder', templateKey, metadata = {} }) {
      return notificationService.createNotification({
        userId,
        type,
        templateKey,
        channel: 'in_app',
        metadata,
      });
    },
  };
}

export const appointmentService = createAppointmentService();
