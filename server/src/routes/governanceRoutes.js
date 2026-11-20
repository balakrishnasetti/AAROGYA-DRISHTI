import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authorize } from '../middleware/authorize.js';
import { validateBody } from '../middleware/validate.js';
import {
  AuditLog,
  BreakGlassAccess,
  CareAssignment,
  GovernanceRequest,
  Notification,
  Patient,
  Session,
  User,
} from '../models/index.js';
import { writeAuditLog } from '../services/auditService.js';
import { decryptField, encryptField } from '../services/fieldEncryption.js';
import { ApiError } from '../utils/apiError.js';

const requestSchema = z.object({
  requestType: z.enum(['correction', 'deletion']),
  reason: z.string().trim().min(10).max(2000),
  requestedChanges: z.object({
    fullName: z.string().trim().min(1).max(120).optional(),
    dateOfBirth: z.coerce.date().optional(),
    sexAtBirth: z.enum(['female', 'male', 'intersex', 'undisclosed']).optional(),
    district: z.string().trim().max(100).optional(),
    preferredLanguage: z.enum(['en', 'te']).optional(),
  }).strict().default({}),
}).strict();

const reviewSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reviewNote: z.string().trim().max(1000).optional(),
}).strict();

const breakGlassSchema = z.object({
  reason: z.string().trim().min(20).max(1000),
}).strict();

async function getOwnPatient(userId) {
  const patient = await Patient.findOne({ userId, active: true });
  if (!patient) throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient record not found.');
  return patient;
}

function encryptChanges(changes) {
  return Object.fromEntries(
    Object.entries(changes).map(([key, value]) => [
      key,
      encryptField(value instanceof Date ? value.toISOString() : value),
    ]),
  );
}

function decryptChanges(changes = {}) {
  return Object.fromEntries(
    Object.entries(changes).map(([key, value]) => {
      const plain = decryptField(value);
      return [key, key === 'dateOfBirth' && plain ? new Date(plain) : plain];
    }),
  );
}

export function createGovernanceRoutes(environment) {
  const router = Router();
  router.use(authenticate(environment));

  router.post(
    '/break-glass/:patientId',
    authorize('doctor', 'specialist'),
    validateBody(breakGlassSchema),
    asyncHandler(async (req, res) => {
      if (!mongoose.isValidObjectId(req.params.patientId)) {
        throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient record not found.');
      }
      const { reason } = req.body;
      const patient = await Patient.findOne({ _id: req.params.patientId, active: true }).select('_id');
      if (!patient) throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient record not found.');

      const assignment = await CareAssignment.exists({
        patientId: patient._id,
        assignedTo: req.user.id,
        hospitalId: req.user.hospitalId,
        status: 'active',
      });
      if (assignment) {
        throw new ApiError(409, 'BREAK_GLASS_NOT_REQUIRED', 'You already have an active care assignment.');
      }

      const activeGrant = await BreakGlassAccess.exists({
        patientId: patient._id,
        doctorId: req.user.id,
        status: 'active',
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      });
      if (activeGrant) throw new ApiError(409, 'BREAK_GLASS_ALREADY_ACTIVE', 'An emergency access grant is already active.');

      const [admins, primaryAssignment] = await Promise.all([
        User.find({ role: 'admin', status: 'active' }).select('_id').limit(50).lean(),
        CareAssignment.findOne({ patientId: patient._id, status: 'active' })
          .select('assignedTo')
          .lean(),
      ]);
      if (!admins.length) {
        throw new ApiError(503, 'BREAK_GLASS_ALERTS_UNAVAILABLE', 'Emergency access alerts are unavailable. Contact the platform administrator.');
      }

      const grantedAt = new Date();
      const expiresAt = new Date(grantedAt.getTime() + 30 * 60 * 1000);
      const access = await BreakGlassAccess.create({
        patientId: patient._id,
        doctorId: req.user.id,
        reason: encryptField(reason),
        grantedAt,
        expiresAt,
        status: 'active',
      });

      const recipientIds = new Set(admins.map((admin) => admin._id.toString()));
      if (primaryAssignment?.assignedTo) recipientIds.add(primaryAssignment.assignedTo.toString());
      try {
        await Notification.insertMany(
          [...recipientIds].map((userId) => ({
            userId,
            type: 'break_glass_alert',
            titleKey: 'notification.breakGlass.title',
            bodyKey: 'notification.breakGlass.body',
            channel: 'in_app',
            templateKey: 'break_glass_alert',
            resourceType: 'patient',
            resourceId: patient._id,
            metadata: { accessId: access._id.toString() },
            deliveryStatus: 'queued',
          })),
        );
        await writeAuditLog({
          actorId: req.user.id,
          action: 'break_glass',
          severity: 'high',
          resourceType: 'patient',
          resourceId: patient._id.toString(),
          hospitalId: req.user.hospitalId,
          requestId: req.id,
          metadata: { accessId: access._id, expiresAt, reasonRecorded: true },
        });
      } catch (error) {
        await BreakGlassAccess.updateOne(
          { _id: access._id, status: 'active' },
          { $set: { status: 'revoked', revokedAt: new Date() } },
        );
        throw error;
      }

      return res.status(201).json({
        success: true,
        code: 'BREAK_GLASS_GRANTED',
        message: 'Read-only emergency access is active for 30 minutes. This access is audited and alerts have been sent.',
        details: { id: access._id, expiresAt, readOnly: true },
      });
    }),
  );

  router.delete(
    '/break-glass/:accessId',
    authorize('doctor', 'admin'),
    asyncHandler(async (req, res) => {
      if (!mongoose.isValidObjectId(req.params.accessId)) {
        throw new ApiError(404, 'BREAK_GLASS_NOT_FOUND', 'Emergency access record not found.');
      }
      const filter = { _id: req.params.accessId, status: 'active', expiresAt: { $gt: new Date() } };
      if (['doctor', 'specialist'].includes(req.user.role)) filter.doctorId = req.user.id;
      const access = await BreakGlassAccess.findOneAndUpdate(
        filter,
        { $set: { status: 'revoked', revokedAt: new Date() } },
        { new: true },
      );
      if (!access) throw new ApiError(404, 'BREAK_GLASS_NOT_FOUND', 'Active emergency access record not found.');
      await writeAuditLog({
        actorId: req.user.id,
        action: 'break_glass',
        severity: 'high',
        resourceType: 'patient',
        resourceId: access.patientId.toString(),
        hospitalId: req.user.hospitalId,
        requestId: req.id,
        metadata: { accessId: access._id, operation: 'revoke' },
      });
      return res.json({ success: true, data: { revoked: true } });
    }),
  );

  router.post(
    '/requests',
    authorize('patient'),
    validateBody(requestSchema),
    asyncHandler(async (req, res) => {
      const payload = req.body;
      if (payload.requestType === 'correction' && Object.keys(payload.requestedChanges).length === 0) {
        throw new ApiError(400, 'CORRECTION_FIELDS_REQUIRED', 'Provide at least one field to correct.');
      }
      if (payload.requestType === 'deletion' && Object.keys(payload.requestedChanges).length > 0) {
        throw new ApiError(400, 'INVALID_REQUEST', 'Deletion requests cannot include profile changes.');
      }
      const patient = await getOwnPatient(req.user.id);
      const request = await GovernanceRequest.create({
        patientId: patient._id,
        requestedBy: req.user.id,
        requestType: payload.requestType,
        reason: encryptField(payload.reason),
        requestedChanges: encryptChanges(payload.requestedChanges),
      });
      await writeAuditLog({
        actorId: req.user.id,
        action: 'create',
        resourceType: 'governance_request',
        resourceId: request._id.toString(),
        requestId: req.id,
        metadata: { requestType: request.requestType },
      });
      return res.status(201).json({
        success: true,
        data: { ...request.toObject(), reason: payload.reason, requestedChanges: payload.requestedChanges },
      });
    }),
  );

  router.get(
    '/requests/mine',
    authorize('patient'),
    asyncHandler(async (req, res) => {
      const patient = await getOwnPatient(req.user.id);
      const requests = await GovernanceRequest.find({ patientId: patient._id })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();
      return res.json({
        success: true,
        data: requests.map((request) => ({
          ...request,
          reason: decryptField(request.reason),
          requestedChanges: decryptChanges(request.requestedChanges),
        })),
      });
    }),
  );

  router.get(
    '/requests',
    authorize('admin'),
    asyncHandler(async (_req, res) => {
      const requests = await GovernanceRequest.find({ status: 'pending' })
        .sort({ createdAt: 1 })
        .limit(50)
        .lean();
      return res.json({
        success: true,
        data: requests.map((request) => ({
          ...request,
          reason: decryptField(request.reason),
          requestedChanges: decryptChanges(request.requestedChanges),
        })),
      });
    }),
  );

  router.patch(
    '/requests/:requestId',
    authorize('admin'),
    validateBody(reviewSchema),
    asyncHandler(async (req, res) => {
      if (!mongoose.isValidObjectId(req.params.requestId)) {
        throw new ApiError(404, 'GOVERNANCE_REQUEST_NOT_FOUND', 'Request not found.');
      }
      const { status, reviewNote } = req.body;
      const request = await GovernanceRequest.findOneAndUpdate(
        { _id: req.params.requestId, status: 'pending' },
        { $set: { status, reviewNote, reviewedBy: req.user.id, reviewedAt: new Date() } },
        { new: true, runValidators: true },
      );
      if (!request) throw new ApiError(404, 'GOVERNANCE_REQUEST_NOT_FOUND', 'Pending request not found.');

      if (status === 'approved' && request.requestType === 'correction') {
        const changes = decryptChanges(request.requestedChanges || {});
        const { fullName, ...patientChanges } = changes;
        if (patientChanges.dateOfBirth) patientChanges.dateOfBirth = encryptField(patientChanges.dateOfBirth.toISOString());
        if (patientChanges.sexAtBirth) patientChanges.sexAtBirth = encryptField(patientChanges.sexAtBirth);
        if (patientChanges.district) patientChanges.district = encryptField(patientChanges.district);
        if (Object.keys(patientChanges).length > 0) {
          await Patient.updateOne({ _id: request.patientId, active: true }, { $set: patientChanges });
        }
        if (fullName) {
          const patient = await Patient.findById(request.patientId).select('userId');
          if (patient) await User.updateOne({ _id: patient.userId }, { $set: { fullName } });
        }
      } else if (status === 'approved' && request.requestType === 'deletion') {
        const patient = await Patient.findByIdAndUpdate(
          request.patientId,
          { $set: { active: false } },
          { new: true },
        ).select('userId');
        if (patient) {
          await User.updateOne({ _id: patient.userId }, { $set: { status: 'disabled' } });
          await Session.updateMany(
            { userId: patient.userId, revokedAt: null },
            { $set: { revokedAt: new Date() } },
          );
        }
      }

      await writeAuditLog({
        actorId: req.user.id,
        action: status === 'approved' ? 'edit' : 'access_denied',
        resourceType: 'governance_request',
        resourceId: request._id.toString(),
        requestId: req.id,
        metadata: { status, requestType: request.requestType },
      });
      return res.json({ success: true, data: request });
    }),
  );

  router.get(
    '/patients/:patientId/access-history',
    authorize('patient'),
    asyncHandler(async (req, res) => {
      const patient = await getOwnPatient(req.user.id);
      if (patient._id.toString() !== req.params.patientId) {
        throw new ApiError(403, 'FORBIDDEN', 'You can only view access history for your own records.');
      }
      const history = await AuditLog.find({
        resourceType: 'patient',
        resourceId: patient._id.toString(),
      })
        .sort({ occurredAt: -1 })
        .limit(50)
        .select('actorId action severity occurredAt metadata')
        .populate({ path: 'actorId', select: 'fullName role' })
        .lean();
      return res.json({ success: true, data: history });
    }),
  );

  return router;
}
