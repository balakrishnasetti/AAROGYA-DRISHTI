import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authorize } from '../middleware/authorize.js';
import { validateBody } from '../middleware/validate.js';
import { createAppointmentService } from '../services/appointmentService.js';
import {
  Appointment,
  CareAssignment,
  Consultation,
  DoctorProfile,
  Hospital,
  Patient,
  TimeSlot,
  User,
} from '../models/index.js';
import { ApiError } from '../utils/apiError.js';
import { validateObjectIdParam } from '../controllers/userController.js';
import { getAppointableDoctorFilter } from '../utils/providerEligibility.js';
import { createAppointmentReceipt } from '../services/appointmentReceiptService.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { writeAuditLog } from '../services/auditService.js';

const appointmentRequestSchema = z
  .object({
    doctorId: z.string().regex(/^[a-f\d]{24}$/i),
    hospitalId: z.string().regex(/^[a-f\d]{24}$/i),
    timeSlotId: z.string().regex(/^[a-f\d]{24}$/i),
    slotStart: z.coerce.date(),
    reason: z.string().trim().max(1000).optional(),
    screeningSessionId: z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .optional(),
    consultationMode: z.enum(['in_person']).default('in_person'),
    patientName: z.string().trim().min(1).max(120).optional(),
    patientPhone: z.string().trim().min(7).max(20).optional(),
  })
  .strict();

const appointmentStatusSchema = z
  .object({
    status: z.enum([
      'requested',
      'accepted',
      'confirmed',
      'declined',
      'cancelled',
      'completed',
      'missed',
      'rescheduled',
    ]),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

const urgentRequestSchema = z
  .object({
    hospitalId: z.string().regex(/^[a-f\d]{24}$/i),
    reason: z.string().trim().min(10).max(2000),
    doctorIds: z
      .array(z.string().regex(/^[a-f\d]{24}$/i))
      .max(20)
      .optional()
      .default([]),
  })
  .strict();

export function createAppointmentRoutes(environment) {
  const router = Router();
  const appointmentService = createAppointmentService();

  router.use(authenticate(environment));

  router.get('/options', asyncHandler(async (_req, res) => {
    res.json({
      success: true,
      details: {
        consultationModes: ['in_person'],
        paymentOptions: ['pay_at_hospital'],
      },
    });
  }));

  router.get(
    '/slots',
    authorize('patient'),
    asyncHandler(async (req, res) => {
      const filters = z
        .object({
          doctorId: z.string().regex(/^[a-f\d]{24}$/i),
          hospitalId: z.string().regex(/^[a-f\d]{24}$/i),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        })
        .safeParse(req.query);
      if (!filters.success) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Choose a hospital and doctor.',
          details: null,
        });
      }
      const doctor = await DoctorProfile.exists({
        userId: filters.data.doctorId,
        hospitalId: filters.data.hospitalId,
        $or: getAppointableDoctorFilter(),
      });
      if (!doctor) return res.json({ success: true, details: [] });
      const startAt = filters.data.date
        ? new Date(`${filters.data.date}T00:00:00.000+05:30`)
        : new Date();
      const endAt = filters.data.date
        ? new Date(`${filters.data.date}T23:59:59.999+05:30`)
        : undefined;
      const slots = await TimeSlot.find({
        doctorId: filters.data.doctorId,
        hospitalId: filters.data.hospitalId,
        status: 'available',
        startAt: { $gte: startAt, ...(endAt ? { $lte: endAt } : {}) },
      })
        .sort({ startAt: 1 })
        .limit(100)
        .select('_id doctorId hospitalId startAt endAt')
        .lean();
      res.json({ success: true, details: slots });
    }),
  );

  router.get(
    '/mine',
    authorize('patient', 'doctor', 'specialist'),
    asyncHandler(async (req, res) => {
      const patient =
        req.user.role === 'patient'
          ? await Patient.findOne({ userId: req.user.id, active: true }).select('_id').lean()
          : null;
      if (req.user.role === 'patient' && !patient) {
        throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient record not found.');
      }
      const filter =
        req.user.role === 'patient'
          ? { patientId: patient._id }
          : { doctorId: req.user.id, hospitalId: req.user.hospitalId };
      const appointments = await Appointment.find(filter).sort({ slotStart: -1 }).limit(50).lean();
      const doctorIds = [...new Set(appointments.map((item) => item.doctorId.toString()))];
      const hospitalIds = [...new Set(appointments.map((item) => item.hospitalId.toString()))];
      const [doctorUsers, hospitals] = await Promise.all([
        User.find({ _id: { $in: doctorIds } }).select('_id fullName').lean(),
        Hospital.find({ _id: { $in: hospitalIds } }).select('_id name').lean(),
      ]);
      const doctorNames = new Map(doctorUsers.map((item) => [item._id.toString(), item.fullName]));
      const hospitalNames = new Map(hospitals.map((item) => [item._id.toString(), item.name]));
      const patients =
        ['doctor', 'specialist'].includes(req.user.role) && appointments.length
          ? await Patient.find({ _id: { $in: appointments.map((item) => item.patientId) } })
              .select('_id userId')
              .lean()
          : [];
      const users = patients.length
        ? await User.find({ _id: { $in: patients.map((item) => item.userId) } })
            .select('_id fullName')
            .lean()
        : [];
      const userById = new Map(users.map((item) => [item._id.toString(), item.fullName]));
      const patientUserById = new Map(
        patients.map((item) => [
          item._id.toString(),
          userById.get(item.userId.toString()) || 'Patient',
        ]),
      );
      res.json({
        success: true,
        details: appointments.map((item) => ({
          ...item,
          doctorName: doctorNames.get(item.doctorId.toString()) ?? 'Doctor',
          hospitalName: hospitalNames.get(item.hospitalId.toString()) ?? 'Hospital',
          patientName:
            ['doctor', 'specialist'].includes(req.user.role)
              ? patientUserById.get(item.patientId.toString())
              : undefined,
        })),
      });
    }),
  );

  router.post(
    '/',
    authorize('patient'),
    validateBody(appointmentRequestSchema),
    asyncHandler(async (req, res) => {
      const patient = await Patient.findOne({ userId: req.user.id, active: true }).select('_id');
      if (!patient) {
        return res.status(404).json({
          success: false,
          code: 'PATIENT_NOT_FOUND',
          message: 'Patient record not found.',
          details: null,
        });
      }
      const patientUser = await User.findById(req.user.id).select('fullName phone').lean();
      const patientName = req.body.patientName || patientUser?.fullName;
      const patientPhone = req.body.patientPhone || patientUser?.phone;
      if (!patientName || !patientPhone) {
        throw new ApiError(400, 'PATIENT_CONTACT_REQUIRED', 'Add your name and contact phone before booking.');
      }
      const appointment = await appointmentService.createAppointmentRequest({
        patientId: patient._id,
        doctorId: req.body.doctorId,
        hospitalId: req.body.hospitalId,
        timeSlotId: req.body.timeSlotId,
        slotStart: req.body.slotStart,
        screeningSessionId: req.body.screeningSessionId,
        reason: req.body.reason,
        consultationMode: req.body.consultationMode,
        patientName,
        patientPhone,
      });

      res.status(201).json({
        success: true,
        code: 'APPOINTMENT_REQUESTED',
        message: 'Appointment request created.',
        details: appointment,
      });
    }),
  );

  router.post(
    '/:appointmentId/reschedule',
    validateObjectIdParam('appointmentId'),
    authorize('patient'),
    validateBody(
      z.object({
        timeSlotId: z.string().regex(/^[a-f\d]{24}$/i),
        slotStart: z.coerce.date(),
      }).strict(),
    ),
    asyncHandler(async (req, res) => {
      const patient = await Patient.findOne({ userId: req.user.id, active: true }).select('_id');
      if (!patient) throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient record not found.');
      const appointment = await appointmentService.reschedulePatientAppointment({
        appointmentId: req.params.appointmentId,
        patientId: patient._id,
        timeSlotId: req.body.timeSlotId,
        slotStart: req.body.slotStart,
      });
      res.json({
        success: true,
        code: 'APPOINTMENT_RESCHEDULED',
        message: 'Appointment time updated. The doctor will review the new request.',
        details: appointment,
      });
    }),
  );

  router.get(
    '/:appointmentId/receipt',
    validateObjectIdParam('appointmentId'),
    authorize('patient'),
    asyncHandler(async (req, res) => {
      const patient = await Patient.findOne({ userId: req.user.id, active: true }).select('_id userId');
      if (!patient) throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient record not found.');
      const appointment = await Appointment.findOne({
        _id: req.params.appointmentId,
        patientId: patient._id,
      }).lean();
      if (!appointment) throw new ApiError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');
      const [doctor, hospital] = await Promise.all([
        User.findById(appointment.doctorId).select('fullName').lean(),
        Hospital.findById(appointment.hospitalId).select('name').lean(),
      ]);
      const pdf = await createAppointmentReceipt(appointment, {
        patientName: appointment.patientNameAtBooking || req.user.fullName || 'Patient',
        doctorName: doctor?.fullName ?? 'Doctor',
        hospitalName: hospital?.name ?? 'Hospital',
        secret: environment.JWT_ACCESS_SECRET,
      });
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="appointment-${appointment._id}.pdf"`,
        'Cache-Control': 'private, no-store',
      });
      res.send(pdf);
    }),
  );

  router.post(
    '/checkin',
    authorize('doctor', 'specialist'),
    validateBody(z.object({ token: z.string().min(40).max(300) }).strict()),
    asyncHandler(async (req, res) => {
      const [prefix, appointmentId, signature] = req.body.token.split(':');
      if (prefix !== 'AAROGYA-CHECKIN' || !/^[a-f\d]{24}$/i.test(appointmentId ?? '') || !signature) {
        throw new ApiError(400, 'INVALID_CHECKIN_QR', 'This check-in code is invalid.');
      }
      const payload = `${prefix}:${appointmentId}`;
      const expected = createHmac('sha256', environment.JWT_ACCESS_SECRET).update(payload).digest('base64url');
      const actualBuffer = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expected);
      if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
        throw new ApiError(400, 'INVALID_CHECKIN_QR', 'This check-in code is invalid.');
      }
      const appointment = await Appointment.findOneAndUpdate(
        {
          _id: appointmentId,
          doctorId: req.user.id,
          hospitalId: req.user.hospitalId,
          status: { $in: ['accepted', 'confirmed'] },
          checkedInAt: { $exists: false },
          slotStart: {
            $gte: new Date(Date.now() - 2 * 60 * 60 * 1000),
            $lte: new Date(Date.now() + 2 * 60 * 60 * 1000),
          },
        },
        { $set: { checkedInAt: new Date() } },
        { new: true },
      ).select('_id slotStart status checkedInAt');
      if (!appointment) {
        throw new ApiError(404, 'CHECKIN_APPOINTMENT_UNAVAILABLE', 'No eligible appointment matches this check-in code.');
      }
      await writeAuditLog({
        actorId: req.user.id,
        action: 'check_in',
        resourceType: 'appointment',
        resourceId: appointment._id.toString(),
        hospitalId: req.user.hospitalId,
        requestId: req.id,
      });
      res.json({ success: true, code: 'APPOINTMENT_CHECKED_IN', details: appointment });
    }),
  );

  router.patch(
    '/:appointmentId/status',
    validateObjectIdParam('appointmentId'),
    authorize('patient', 'doctor', 'specialist'),
    validateBody(appointmentStatusSchema),
    asyncHandler(async (req, res) => {
      const patient =
        req.user.role === 'patient'
          ? await Patient.findOne({ userId: req.user.id, active: true }).select('_id')
          : null;
      if (req.user.role === 'patient' && !patient) {
        return res.status(404).json({
          success: false,
          code: 'PATIENT_NOT_FOUND',
          message: 'Patient record not found.',
          details: null,
        });
      }
      const appointment = await appointmentService.updateAppointmentStatus({
        appointmentId: req.params.appointmentId,
        status: req.body.status,
        reason: req.body.reason,
        doctorId: ['doctor', 'specialist'].includes(req.user.role) ? req.user._id : undefined,
        patientId: patient?._id,
      });
      if (['doctor', 'specialist'].includes(req.user.role) && req.body.status === 'confirmed') {
        await Promise.all([
          CareAssignment.findOneAndUpdate(
            {
              patientId: appointment.patientId,
              assignedTo: req.user.id,
              hospitalId: appointment.hospitalId,
              status: 'active',
            },
            { $setOnInsert: { assignedBy: req.user.id, assignedAt: new Date(), status: 'active' } },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          ),
          Consultation.findOneAndUpdate(
            { appointmentId: appointment._id },
            {
              $setOnInsert: {
                appointmentId: appointment._id,
                patientId: appointment.patientId,
                doctorId: appointment.doctorId,
                hospitalId: appointment.hospitalId,
                status: 'scheduled',
              },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          ),
        ]);
      }

      res.json({
        success: true,
        code: 'APPOINTMENT_STATUS_UPDATED',
        message: 'Appointment status updated.',
        details: appointment,
      });
    }),
  );

  router.post(
    '/urgent',
    authorize('patient'),
    validateBody(urgentRequestSchema),
    asyncHandler(async (req, res) => {
      const patient = await Patient.findOne({ userId: req.user.id, active: true }).select('_id');
      if (!patient) {
        return res.status(404).json({
          success: false,
          code: 'PATIENT_NOT_FOUND',
          message: 'Patient record not found.',
          details: null,
        });
      }
      const urgentRequest = await appointmentService.createUrgentRequest({
        patientId: patient._id,
        hospitalId: req.body.hospitalId,
        reason: req.body.reason,
        doctorIds: req.body.doctorIds,
      });

      res.status(201).json({
        success: true,
        code: 'URGENT_REQUEST_CREATED',
        message: 'Urgent care request created.',
        details: urgentRequest,
      });
    }),
  );

  return router;
}
