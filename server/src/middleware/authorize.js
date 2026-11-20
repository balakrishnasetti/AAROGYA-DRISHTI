import { ApiError } from '../utils/apiError.js';
import { writeAuditLog } from '../services/auditService.js';
import { roleHasPermission } from '../security/rolePermissions.js';

export function roleAllowed(user, roles) {
  return Boolean(user && roles.includes(user.role));
}

export function authorize(...roles) {
  return async (req, res, next) => {
    if (roleAllowed(req.user, roles)) return next();

    try {
      await writeAuditLog({
        actorId: req.user?.id,
        action: 'access_denied',
        resourceType: req.baseUrl + req.path,
        requestId: req.id,
        metadata: { requiredRoles: roles.join(','), actualRole: req.user?.role ?? 'anonymous' },
      });
    } catch (error) {
      return next(error);
    }
    return next(new ApiError(403, 'FORBIDDEN', 'You do not have permission to access this page.'));
  };
}

export function authorizePermission(permission, auditWriter = writeAuditLog) {
  return async (req, res, next) => {
    if (roleHasPermission(req.user?.role, permission)) return next();

    try {
      await auditWriter({
        actorId: req.user?.id,
        action: 'access_denied',
        resourceType: req.baseUrl + req.path,
        requestId: req.id,
        metadata: { requiredPermission: permission, actualRole: req.user?.role ?? 'anonymous' },
      });
    } catch (error) {
      return next(error);
    }
    return next(new ApiError(403, 'FORBIDDEN', 'You do not have permission to access this resource.'));
  };
}

function requestedHospitalIds(req) {
  return [req.params.hospitalId, req.query.hospitalId, req.body?.hospitalId].filter(Boolean);
}

export function scopeToHospital(req, res, next) {
  if (!req.user) {
    return next(new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to continue.'));
  }
  if (req.user.role === 'admin' || req.user.role === 'patient') return next();

  const authorizedHospitalId = req.user.hospitalId?.toString();
  if (!authorizedHospitalId) {
    return next(
      new ApiError(403, 'HOSPITAL_NOT_ASSIGNED', 'Your account is not assigned to a hospital.'),
    );
  }

  if (requestedHospitalIds(req).some((value) => value.toString() !== authorizedHospitalId)) {
    return next(
      new ApiError(
        403,
        'HOSPITAL_SCOPE_FORBIDDEN',
        'You can only access information for your assigned hospital.',
      ),
    );
  }

  req.hospitalId = authorizedHospitalId;
  req.hospitalFilter = { hospitalId: authorizedHospitalId };
  return next();
}
