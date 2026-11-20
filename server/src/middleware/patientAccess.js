import { CareAssignment, Patient } from '../models/index.js';
import { ApiError } from '../utils/apiError.js';
import { writeAuditLog } from '../services/auditService.js';
import { monitorPatientAccess } from '../services/securityMonitoringService.js';

export function assertPatientAccessWith({
  PatientModel = Patient,
  CareAssignmentModel = CareAssignment,
  auditWriter = writeAuditLog,
  anomalyMonitor = monitorPatientAccess,
} = {}) {
  return async function assertAccess(req, res, next) {
    try {
      const patient = await PatientModel.findOne({
        _id: req.params.patientId,
        active: true,
      }).select('userId');
      if (!patient)
        return next(new ApiError(404, 'PATIENT_NOT_FOUND', 'That patient record was not found.'));

      let denialReason = null;
      if (req.user.role === 'patient') {
        if (patient.userId.toString() !== req.user.id.toString()) denialReason = 'patient_owner_mismatch';
      } else if (
        ['doctor', 'specialist'].includes(req.user.role) &&
        !(req.breakGlass && req.method === 'GET')
      ) {
        const assignment = await CareAssignmentModel.exists({
          patientId: patient._id,
          assignedTo: req.user.id,
          hospitalId: req.user.hospitalId,
          status: 'active',
        });
        if (!assignment) denialReason = 'doctor_assignment_missing';
      } else if (!['doctor', 'specialist'].includes(req.user.role)) {
        denialReason = 'role_not_permitted';
      }

      if (denialReason) {
        await auditWriter({
          actorId: req.user.id,
          action: 'access_denied',
          resourceType: 'patient',
          resourceId: patient._id.toString(),
          hospitalId: req.user.hospitalId,
          requestId: req.id,
          metadata: { reason: denialReason, route: req.path },
        });
        const code = denialReason.includes('assignment') ? 'CARE_RELATIONSHIP_REQUIRED' : 'FORBIDDEN';
        const message = denialReason.includes('assignment')
          ? 'You are not assigned to this patient.'
          : 'You can only access your own patient record.';
        return next(new ApiError(403, code, message));
      }

      await auditWriter({
        actorId: req.user.id,
        action: req.method === 'GET' ? 'read' : req.method === 'POST' ? 'create' : 'edit',
        resourceType: 'patient',
        resourceId: patient._id.toString(),
        hospitalId: req.user.hospitalId,
        requestId: req.id,
        metadata: { method: req.method, route: req.path },
      });
      if (req.method === 'GET') {
        await anomalyMonitor({ actorId: req.user.id, requestId: req.id });
      }
      req.authorizedPatient = patient;
      req.authorizedPatientId = patient._id;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export const assertPatientAccess = assertPatientAccessWith();
