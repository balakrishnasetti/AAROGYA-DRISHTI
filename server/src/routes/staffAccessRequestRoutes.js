import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validateBody } from '../middleware/validate.js';
import {
  DoctorProfile,
  Hospital,
  HospitalManager,
  StaffAccessRequest,
  User,
} from '../models/index.js';
import { writeAuditLog } from '../services/auditService.js';
import { ApiError } from '../utils/apiError.js';
import {
  staffAccessRequestSchema,
  staffAccessReviewSchema,
} from '../validators/staffAccessRequestValidators.js';

const rolePrefixes = {
  hospital_manager: 'HMAN',
  doctor: 'DOC',
  specialist: 'SPEC',
  health_worker: 'HWRK',
  navigator: 'NAV',
  district_officer: 'DIST',
};

function initialPassword() {
  return `A${randomBytes(18).toString('hex')}a1!`;
}

function staffId(prefix) {
  return `${prefix}-${randomBytes(5).toString('hex').toUpperCase()}`;
}

function requestResponse(res) {
  res.status(202).json({
    success: true,
    code: 'STAFF_ACCESS_REQUEST_RECEIVED',
    message: 'Your request was received and will remain pending until an administrator reviews it.',
    details: null,
  });
}

export function createStaffAccessRequestRoutes(environment) {
  const router = Router();

  router.post(
    '/',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 5,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {
        success: false,
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please wait a few minutes and try again.',
        details: null,
      },
    }),
    validateBody(staffAccessRequestSchema),
    asyncHandler(async (req, res) => {
      const { email, hospitalId, requestedRole, ...details } = req.body;
      if (await User.exists({ email })) return requestResponse(res);
      if (
        await StaffAccessRequest.exists({ email, status: { $in: ['pending', 'provisioning'] } })
      ) {
        return requestResponse(res);
      }

      const requiresHospital = ['hospital_manager', 'doctor', 'specialist'].includes(requestedRole);
      const hospital = requiresHospital
        ? await Hospital.findOne({
            _id: hospitalId,
            status: 'active',
            ...(environment.SEED_DEMO ? {} : { isSynthetic: { $ne: true } }),
          }).select('_id district')
        : null;
      if (requiresHospital && !hospital) {
        throw new ApiError(400, 'HOSPITAL_NOT_FOUND', 'Choose an active hospital or clinic.');
      }
      if (hospital && hospital.district && details.district !== hospital.district) {
        throw new ApiError(
          400,
          'HOSPITAL_DISTRICT_MISMATCH',
          'The district must match the selected hospital or clinic.',
        );
      }

      try {
        await StaffAccessRequest.create({
          ...details,
          email,
          requestedRole,
          ...(hospital
            ? { hospitalId: hospital._id, district: hospital.district ?? details.district }
            : {}),
        });
      } catch (error) {
        if (error.code === 11000) return requestResponse(res);
        throw error;
      }
      return requestResponse(res);
    }),
  );

  router.get(
    '/',
    authenticate(environment),
    authorize('admin'),
    asyncHandler(async (_req, res) => {
      const requests = await StaffAccessRequest.find({ status: 'pending' })
        .populate({ path: 'hospitalId', select: 'name code district' })
        .sort({ createdAt: 1 })
        .limit(100)
        .lean();
      res.json({ success: true, code: 'STAFF_ACCESS_REQUESTS', details: requests });
    }),
  );

  router.patch(
    '/:requestId/review',
    authenticate(environment),
    authorize('admin'),
    validateBody(staffAccessReviewSchema),
    asyncHandler(async (req, res) => {
      if (!/^[a-f\d]{24}$/i.test(req.params.requestId)) {
        throw new ApiError(
          404,
          'STAFF_ACCESS_REQUEST_NOT_FOUND',
          'Staff access request not found.',
        );
      }
      const request = await StaffAccessRequest.findOneAndUpdate(
        { _id: req.params.requestId, status: 'pending' },
        {
          $set: {
            status: 'provisioning',
            reviewedBy: req.user.id,
            reviewNote: req.body.reviewNote,
          },
        },
        { new: true },
      );
      if (!request) {
        throw new ApiError(
          404,
          'STAFF_ACCESS_REQUEST_NOT_FOUND',
          'This request was already reviewed or could not be found.',
        );
      }

      if (req.body.status === 'rejected') {
        request.status = 'rejected';
        request.reviewedAt = new Date();
        await request.save();
        await writeAuditLog({
          actorId: req.user.id,
          action: 'edit',
          resourceType: 'staff_access_request',
          resourceId: request._id.toString(),
          requestId: req.id,
          metadata: { decision: 'rejected', role: request.requestedRole },
        });
        return res.json({ success: true, code: 'STAFF_ACCESS_REQUEST_REJECTED', details: null });
      }

      let user;
      let profile;
      let assignment;
      const password = initialPassword();
      try {
        const hospital = request.hospitalId
          ? await Hospital.findOne({ _id: request.hospitalId, status: 'active' }).select(
              '_id district',
            )
          : null;
        if (['hospital_manager', 'doctor', 'specialist'].includes(request.requestedRole) && !hospital) {
          throw new ApiError(
            409,
            'HOSPITAL_NOT_FOUND',
            'The selected facility is no longer active.',
          );
        }
        user = await User.create({
          fullName: request.fullName,
          email: request.email,
          phone: request.phone,
          staffId: staffId(rolePrefixes[request.requestedRole]),
          role: request.requestedRole,
          status: 'active',
          district: hospital?.district ?? request.district,
          ...(request.mandal ? { mandal: request.mandal } : {}),
          ...(request.phc ? { phc: request.phc } : {}),
          assignedVillages: request.assignedVillages,
          passwordHash: await bcrypt.hash(password, 12),
          mustChangePassword: true,
        });
        if (request.requestedRole === 'hospital_manager') {
          assignment = await HospitalManager.create({
            hospitalId: hospital._id,
            managerId: user._id,
            assignedBy: req.user.id,
            active: true,
          });
        }
        if (['doctor', 'specialist'].includes(request.requestedRole)) {
          profile = await DoctorProfile.create({
            userId: user._id,
            hospitalId: hospital._id,
            qualification: request.qualification,
            registrationNumber: request.registrationNumber,
            specialty: request.specialty,
            verificationStatus: 'pending',
          });
        }
        request.status = 'approved';
        request.reviewedAt = new Date();
        request.provisionedUserId = user._id;
        await request.save();
      } catch (error) {
        const cleanup = await Promise.allSettled([
          ...(profile ? [DoctorProfile.deleteOne({ _id: profile._id })] : []),
          ...(assignment ? [HospitalManager.deleteOne({ _id: assignment._id })] : []),
          ...(user ? [User.deleteOne({ _id: user._id })] : []),
          StaffAccessRequest.updateOne(
            { _id: request._id, status: 'provisioning' },
            { $set: { status: 'pending' } },
          ),
        ]);
        const cleanupFailure = cleanup.find((result) => result.status === 'rejected');
        if (cleanupFailure) {
          throw new AggregateError(
            [error, cleanupFailure.reason],
            'Staff account creation failed and cleanup was incomplete.',
          );
        }
        throw error;
      }

      await writeAuditLog({
        actorId: req.user.id,
        action: 'create',
        resourceType: 'staff_account',
        resourceId: user._id.toString(),
        hospitalId: request.hospitalId,
        requestId: req.id,
        metadata: { role: request.requestedRole, requestId: request._id.toString() },
      });
      res.json({
        success: true,
        code: 'STAFF_ACCESS_REQUEST_APPROVED',
        details: {
          staffId: user.staffId,
          initialPassword: password,
          role: user.role,
          doctorVerificationStatus: profile?.verificationStatus ?? null,
        },
      });
    }),
  );

  return router;
}
