import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authorize, scopeToHospital } from '../middleware/authorize.js';
import { validateBody } from '../middleware/validate.js';
import { AiAssistantSettings } from '../models/index.js';
import { readAiSettings } from '../services/aiAssistantService.js';
import {
  createManagementController,
  validateAuditFilters,
  validateDocumentTypeParam,
  validateManagementId,
} from '../controllers/managementController.js';
import { createPrivateStorageService } from '../services/privateStorageService.js';
import { createManagementService } from '../services/managementService.js';
import { writeAuditLog } from '../services/auditService.js';
import { DoctorProfile, Hospital, TimeSlot, User } from '../models/index.js';
import { getAppointableDoctorFilter } from '../utils/providerEligibility.js';
import { ApiError } from '../utils/apiError.js';
import {
  createDoctorSchema,
  createHospitalSchema,
  doctorStatusSchema,
  documentReviewSchema,
  updateDoctorSchema,
  updateHospitalSchema,
  updateManagerHospitalSchema,
  userUpdateSchema,
} from '../validators/managementValidators.js';

const receiveFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
}).single('file');

export function createAdminRoutes(environment) {
  const router = Router();
  const managementService = createManagementService({
    privateStorage: createPrivateStorageService(environment),
  });
  const controller = createManagementController({ managementService });

  router.use(authenticate(environment), authorize('admin'));
  router.get('/summary', asyncHandler(controller.summary));
  router.get('/appointments/directory', asyncHandler(async (_req, res) => {
    const profiles = await DoctorProfile.find({ $or: getAppointableDoctorFilter() })
      .populate({ path: 'userId', select: 'fullName status isSynthetic' })
      .populate({ path: 'hospitalId', select: 'name city status isSynthetic' })
      .sort({ specialty: 1, createdAt: 1 })
      .limit(200)
      .lean();
    const details = profiles
      .filter((profile) => profile.userId?.status === 'active' && profile.hospitalId?.status === 'active')
      .map((profile) => ({
        doctorId: profile.userId._id,
        doctorName: profile.userId.fullName,
        hospitalId: profile.hospitalId._id,
        hospitalName: profile.hospitalId.name,
        city: profile.hospitalId.city,
        specialty: profile.specialty,
        consultationFee: profile.consultationFee ?? 0,
        languages: profile.languages ?? [],
        isSynthetic: profile.isSynthetic === true,
      }));
    res.json({ success: true, code: 'APPOINTMENT_DIRECTORY', details });
  }));
  router.patch(
    '/appointments/doctors/:doctorId',
    validateManagementId('doctorId'),
    validateBody(z.object({
      specialty: z.string().trim().min(1).max(120).optional(),
      consultationFee: z.number().min(0).max(1000000).optional(),
      languages: z.array(z.enum(['en', 'hi', 'te', 'ta', 'kn', 'ml', 'bn', 'mr'])).max(8).optional(),
    }).strict().refine((value) => Object.keys(value).length > 0, 'Provide a doctor field to update.')),
    asyncHandler(async (req, res) => {
      const profile = await DoctorProfile.findOneAndUpdate(
        { userId: req.params.doctorId, $or: getAppointableDoctorFilter() },
        { $set: req.body },
        { new: true, runValidators: true },
      );
      if (!profile) throw new ApiError(404, 'DOCTOR_NOT_FOUND', 'Appointable doctor not found.');
      await writeAuditLog({
        actorId: req.user.id,
        action: 'edit',
        resourceType: 'doctor_appointment_profile',
        resourceId: req.params.doctorId,
        hospitalId: profile.hospitalId,
        requestId: req.id,
        metadata: { fields: Object.keys(req.body) },
      });
      res.json({ success: true, code: 'DOCTOR_APPOINTMENT_PROFILE_UPDATED', details: profile });
    }),
  );
  router.get('/appointments/slots', asyncHandler(async (req, res) => {
    const doctorId = z.string().regex(/^[a-f\d]{24}$/i).safeParse(req.query.doctorId);
    if (!doctorId.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Choose a doctor.');
    const slots = await TimeSlot.find({
      doctorId: doctorId.data,
      startAt: { $gte: new Date() },
    }).sort({ startAt: 1 }).limit(200).lean();
    await writeAuditLog({
      actorId: req.user.id,
      action: 'read',
      resourceType: 'appointment_slots',
      requestId: req.id,
      metadata: { doctorId: doctorId.data },
    });
    res.json({ success: true, code: 'APPOINTMENT_SLOTS', details: slots });
  }));
  router.post(
    '/appointments/slots',
    validateBody(z.object({
      doctorId: z.string().regex(/^[a-f\d]{24}$/i),
      hospitalId: z.string().regex(/^[a-f\d]{24}$/i),
      startAt: z.coerce.date(),
      endAt: z.coerce.date(),
    }).strict().refine((value) => value.endAt > value.startAt, {
      message: 'Slot end must be after its start.',
      path: ['endAt'],
    })),
    asyncHandler(async (req, res) => {
      const { doctorId, hospitalId, startAt, endAt } = req.body;
      if (startAt <= new Date() || endAt.getTime() - startAt.getTime() < 15 * 60_000 || endAt.getTime() - startAt.getTime() > 180 * 60_000) {
        throw new ApiError(400, 'INVALID_SLOT_RANGE', 'Choose a future slot between 15 minutes and 3 hours long.');
      }
      const [doctor, hospital] = await Promise.all([
        DoctorProfile.findOne({ userId: doctorId, hospitalId, $or: getAppointableDoctorFilter() }).select('_id').lean(),
        Hospital.findOne({ _id: hospitalId, status: 'active' }).select('_id').lean(),
      ]);
      const activeUser = await User.exists({
        _id: doctorId,
        role: { $in: ['doctor', 'specialist'] },
        status: 'active',
      });
      if (!doctor || !hospital || !activeUser) {
        throw new ApiError(404, 'APPOINTMENT_TARGET_NOT_FOUND', 'That doctor or hospital is not available.');
      }
      let slot;
      try {
        [slot] = await TimeSlot.create([{ doctorId, hospitalId, startAt, endAt, status: 'available' }]);
      } catch (error) {
        if (error.code === 11000) {
          throw new ApiError(409, 'TIME_SLOT_EXISTS', 'A slot already exists for that doctor and time.');
        }
        throw error;
      }
      await writeAuditLog({
        actorId: req.user.id,
        action: 'create',
        resourceType: 'appointment_slot',
        resourceId: slot._id.toString(),
        hospitalId,
        requestId: req.id,
      });
      res.status(201).json({ success: true, code: 'APPOINTMENT_SLOT_CREATED', details: slot });
    }),
  );
  router.patch(
    '/appointments/slots/:slotId',
    validateManagementId('slotId'),
    validateBody(z.object({ status: z.enum(['available', 'unavailable']) }).strict()),
    asyncHandler(async (req, res) => {
      const slot = await TimeSlot.findOneAndUpdate(
        { _id: req.params.slotId, status: { $in: ['available', 'unavailable'] } },
        { $set: { status: req.body.status } },
        { new: true },
      );
      if (!slot) throw new ApiError(404, 'SLOT_NOT_FOUND_OR_BOOKED', 'Only unbooked slots can be changed.');
      await writeAuditLog({
        actorId: req.user.id,
        action: 'edit',
        resourceType: 'appointment_slot',
        resourceId: slot._id.toString(),
        hospitalId: slot.hospitalId,
        requestId: req.id,
        metadata: { status: req.body.status },
      });
      res.json({ success: true, code: 'APPOINTMENT_SLOT_UPDATED', details: slot });
    }),
  );
  router.get('/hospitals', asyncHandler(controller.listHospitals));
  router.post(
    '/hospitals',
    validateBody(createHospitalSchema),
    asyncHandler(controller.createHospital),
  );
  router.patch(
    '/hospitals/:hospitalId',
    validateManagementId('hospitalId'),
    validateBody(updateHospitalSchema),
    asyncHandler(controller.updateHospital),
  );
  router.get('/users', asyncHandler(controller.listUsers));
  router.patch(
    '/users/:userId',
    validateManagementId('userId'),
    validateBody(userUpdateSchema),
    asyncHandler(controller.updateUser),
  );
  router.get('/audit-logs/export', validateAuditFilters, asyncHandler(controller.exportAuditLogs));
  router.get('/audit-logs', validateAuditFilters, asyncHandler(controller.auditLogs));
  router.get(
    '/ai-settings',
    asyncHandler(async (_req, res) => {
      const settings = await readAiSettings(AiAssistantSettings);
      return res.json({ success: true, data: settings });
    }),
  );
  router.patch(
    '/ai-settings',
    validateBody(
      z.object({
        provider: z.enum(['gemini', 'openai', 'custom']).optional(),
        languages: z.array(z.enum(['en', 'te'])).optional(),
        safetyText: z.string().trim().min(1).max(2000).optional(),
        avatarEnabled: z.boolean().optional(),
        avatarLabel: z.string().trim().min(1).max(200).optional(),
        voiceEnabled: z.boolean().optional(),
      }),
    ),
    asyncHandler(async (req, res) => {
      const settings = await AiAssistantSettings.findOneAndUpdate({}, { $set: req.body }, { new: true, upsert: true, setDefaultsOnInsert: true });
      return res.json({ success: true, data: settings });
    }),
  );
  return router;
}

export function createHospitalManagerRoutes(environment) {
  const router = Router();
  const managementService = createManagementService({
    privateStorage: createPrivateStorageService(environment),
  });
  const controller = createManagementController({ managementService });

  router.use(authenticate(environment), authorize('hospital_manager'), scopeToHospital);
  router.get('/hospital', asyncHandler(controller.hospitalProfile));
  router.patch(
    '/hospital',
    validateBody(updateManagerHospitalSchema),
    asyncHandler(controller.updateHospitalProfile),
  );
  router.get('/overview', asyncHandler(controller.hospitalOverview));
  router.get('/appointments/summary', asyncHandler(controller.hospitalOverview));
  router.get('/doctors', asyncHandler(controller.listDoctors));
  router.post('/doctors', validateBody(createDoctorSchema), asyncHandler(controller.createDoctor));
  router.patch(
    '/doctors/:doctorId',
    validateManagementId('doctorId'),
    validateBody(updateDoctorSchema),
    asyncHandler(controller.updateDoctor),
  );
  router.patch(
    '/doctors/:doctorId/status',
    validateManagementId('doctorId'),
    validateBody(doctorStatusSchema),
    asyncHandler(controller.setDoctorStatus),
  );
  router.post(
    '/doctors/:doctorId/documents/:documentType',
    validateManagementId('doctorId'),
    validateDocumentTypeParam,
    receiveFile,
    asyncHandler(controller.uploadDoctorFile),
  );
  router.post(
    '/doctors/:doctorId/photo',
    validateManagementId('doctorId'),
    receiveFile,
    asyncHandler(controller.uploadDoctorPhoto),
  );
  router.get(
    '/doctors/:doctorId/photo',
    validateManagementId('doctorId'),
    asyncHandler(controller.readDoctorPhoto),
  );
  router.get(
    '/doctors/:doctorId/documents/:documentId/content',
    validateManagementId('doctorId'),
    validateManagementId('documentId'),
    asyncHandler(controller.readDoctorDocument),
  );
  router.patch(
    '/doctors/:doctorId/documents/:documentId/review',
    validateManagementId('doctorId'),
    validateManagementId('documentId'),
    validateBody(documentReviewSchema),
    asyncHandler(controller.reviewDoctorDocument),
  );
  router.post(
    '/doctors/:doctorId/verify',
    validateManagementId('doctorId'),
    asyncHandler(controller.verifyDoctor),
  );
  return router;
}
