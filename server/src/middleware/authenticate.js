import { Hospital, User, Session } from '../models/index.js';
import { verifyAccessToken, verifyFlowToken } from '../services/tokenService.js';
import { HospitalManager, DoctorProfile } from '../models/index.js';
import { ApiError } from '../utils/apiError.js';
import { doctorCanAccessWorkspace } from '../utils/providerEligibility.js';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const ACTIVITY_WRITE_INTERVAL_MS = 60 * 1000;

function bearerToken(req) {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
}

function invalidToken(next) {
  next(
    new ApiError(
      401,
      'AUTHENTICATION_REQUIRED',
      'Your session is invalid or expired. Sign in again to continue.',
    ),
  );
}

export function authenticate(environment) {
  return async (req, res, next) => {
    const token = bearerToken(req);
    if (!token) return invalidToken(next);
    let payload;
    try {
      payload = verifyAccessToken(token, environment);
    } catch {
      return invalidToken(next);
    }

    try {
      const [session, user] = await Promise.all([
        Session.findOne({
          _id: payload.sid,
          userId: payload.sub,
          revokedAt: null,
          expiresAt: { $gt: new Date() },
        }).select('_id role lastUsedAt'),
        User.findOne({ _id: payload.sub, status: 'active' }).select(
          'fullName email phone role mustChangePassword isSynthetic district mandal phc assignedVillages',
        ),
      ]);

      if (
        !session ||
        !user ||
        user.mustChangePassword ||
        session.role !== user.role ||
        !session.lastUsedAt ||
        Date.now() - session.lastUsedAt.getTime() > IDLE_TIMEOUT_MS
      ) {
        if (session && session.lastUsedAt && Date.now() - session.lastUsedAt.getTime() > IDLE_TIMEOUT_MS) {
          await Session.updateOne(
            { _id: session._id, revokedAt: null },
            { $set: { revokedAt: new Date() } },
          );
        }
        return invalidToken(next);
      }

      const activityCutoff = new Date(Date.now() - ACTIVITY_WRITE_INTERVAL_MS);
      await Session.updateOne(
        { _id: session._id, revokedAt: null, lastUsedAt: { $lt: activityCutoff } },
        { $set: { lastUsedAt: new Date() } },
      );
      let hospitalId = null;
      if (user.role === 'hospital_manager') {
        const relation = await HospitalManager.findOne({
          managerId: user._id,
          active: true,
        }).select('hospitalId');
        if (!relation) {
          return next(
            new ApiError(
              403,
              'HOSPITAL_NOT_ASSIGNED',
              'Your account is not assigned to a hospital. Contact an administrator.',
            ),
          );
        }
        const hospital = await Hospital.findOne({
          _id: relation.hospitalId,
          status: 'active',
        }).select('_id');
        if (!hospital) {
          return next(
            new ApiError(
              403,
              'HOSPITAL_INACTIVE',
              'Your hospital is not active. Contact an administrator for help.',
            ),
          );
        }
        hospitalId = relation.hospitalId;
      } else if (['doctor', 'specialist'].includes(user.role)) {
        const profile = await DoctorProfile.findOne({ userId: user._id }).select(
          'hospitalId verificationStatus isSynthetic demoLoginEnabled',
        );
        if (!profile) {
          return next(
            new ApiError(
              403,
              'DOCTOR_NOT_VERIFIED',
              'Your profile is not verified yet. Contact your hospital manager.',
            ),
          );
        }
        const hospital = await Hospital.findOne({
          _id: profile.hospitalId,
          status: 'active',
        }).select('_id status isSynthetic');
        if (!hospital) {
          return next(
            new ApiError(
              403,
              'HOSPITAL_INACTIVE',
              'Your hospital is not active. Contact an administrator for help.',
            ),
          );
        }
        if (!doctorCanAccessWorkspace({ user, profile, hospital, environment })) {
          return next(
            new ApiError(
              403,
              'DOCTOR_NOT_VERIFIED',
              'Your profile is not verified yet. Contact your hospital manager.',
            ),
          );
        }
        hospitalId = profile.hospitalId;
      }

      req.user = {
        id: user._id,
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        hospitalId,
        district: user.district ?? null,
        mandal: user.mandal ?? null,
        phc: user.phc ?? null,
        assignedVillages: user.assignedVillages ?? [],
        sessionId: session._id.toString(),
      };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function authenticateFlow(purpose, environment) {
  return (req, res, next) => {
    const token = bearerToken(req);
    if (!token) return invalidToken(next);
    try {
      const payload = verifyFlowToken(token, purpose, environment);
      req.flow = { userId: payload.sub, purpose };
      return next();
    } catch {
      return invalidToken(next);
    }
  };
}
