import { Router } from 'express';
import { z } from 'zod';
import { Appointment, Patient, User } from '../models/index.js';
import { authenticate } from '../middleware/authenticate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authorize } from '../middleware/authorize.js';
import { validateBody } from '../middleware/validate.js';
import { createVideoSessionService } from '../services/videoSessionService.js';
import { ApiError } from '../utils/apiError.js';

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
const createVideoSessionSchema = z.object({
  appointmentId: objectIdSchema,
  provider: z.enum(['jitsi', 'livekit', 'daily', 'twilio', 'webrtc']).optional(),
}).strict();

const joinVideoSessionSchema = z.object({
  videoSessionId: objectIdSchema,
  token: z.string().min(1).max(4096),
}).strict();

export function createVideoRoutes(environment) {
  const router = Router();
  const videoSessionService = createVideoSessionService({
    jwtSecret: environment.JWT_ACCESS_SECRET,
  });

  router.use(authenticate(environment));

  router.post(
    '/sessions',
    authorize('patient', 'doctor', 'specialist'),
    validateBody(createVideoSessionSchema),
    asyncHandler(async (req, res) => {
      const appointment = await Appointment.findOne({
        _id: req.body.appointmentId,
        status: 'confirmed',
      }).select('patientId doctorId hospitalId slotStart').lean();
      if (!appointment) {
        return res.status(404).json({
          success: false,
          code: 'CONFIRMED_APPOINTMENT_NOT_FOUND',
          message: 'A confirmed appointment is required to create a video session.',
          details: null,
        });
      }
      if (new Date(appointment.slotStart).getTime() + 30 * 60 * 1000 <= Date.now()) {
        return res.status(409).json({
          success: false,
          code: 'APPOINTMENT_VIDEO_WINDOW_EXPIRED',
          message: 'The appointment video window has ended.',
          details: null,
        });
      }

      const patient = await Patient.findOne({
        _id: appointment.patientId,
        active: true,
      }).select('_id userId').lean();
      if (!patient) {
        return res.status(404).json({
          success: false,
          code: 'PATIENT_NOT_FOUND',
          message: 'The appointment patient is not available.',
          details: null,
        });
      }

      const requesterId = req.user.id.toString();
      const isPatient = req.user.role === 'patient' && patient.userId.toString() === requesterId;
      const isDoctor =
        ['doctor', 'specialist'].includes(req.user.role) &&
        appointment.doctorId.toString() === requesterId;
      if (!isPatient && !isDoctor) {
        return res.status(403).json({
          success: false,
          code: 'VIDEO_APPOINTMENT_ACCESS_DENIED',
          message: 'You are not a participant in this appointment.',
          details: null,
        });
      }

      const clinician = await User.findById(appointment.doctorId).select('role').lean();
      if (!clinician || !['doctor', 'specialist'].includes(clinician.role)) {
        throw new ApiError(404, 'VIDEO_PROVIDER_NOT_AVAILABLE', 'That clinician is not available.');
      }
      const result = await videoSessionService.createSession({
        appointmentId: appointment._id,
        patientId: patient._id,
        patientUserId: patient.userId,
        doctorId: appointment.doctorId,
        clinicianRole: clinician.role,
        hospitalId: appointment.hospitalId,
        slotStart: appointment.slotStart,
        provider: req.body.provider,
      });

      res.status(201).json({
        success: true,
        code: 'VIDEO_SESSION_CREATED',
        message: 'Video session is ready.',
        details: {
          session: {
            id: result.session._id,
            appointmentId: result.session.appointmentId,
            roomName: result.session.roomName,
            provider: result.session.provider,
            status: result.session.status,
            slotStart: result.session.slotStart,
            joinTokenExpiresAt: result.session.joinTokenExpiresAt,
            recordingEnabled: result.session.recordingEnabled,
          },
          joinToken: result.tokens[requesterId],
        },
      });
    }),
  );

  router.post(
    '/sessions/join',
    authorize('patient', 'doctor', 'specialist'),
    validateBody(joinVideoSessionSchema),
    asyncHandler(async (req, res) => {
      const allowed = await videoSessionService.validateJoinToken({
        videoSessionId: req.body.videoSessionId,
        userId: req.user.id,
        token: req.body.token,
      });

      res.json({
        success: true,
        code: allowed ? 'VIDEO_JOIN_ALLOWED' : 'VIDEO_JOIN_DENIED',
        message: allowed ? 'You can join this session.' : 'You are not permitted to join this session.',
        details: { allowed },
      });
    }),
  );

  return router;
}
