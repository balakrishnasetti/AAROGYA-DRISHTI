import mongoose from 'mongoose';
import { BreakGlassAccess, CareAssignment, Patient } from '../models/index.js';
import { writeAuditLog } from '../services/auditService.js';
import { ApiError } from '../utils/apiError.js';

export function careRelationship({
  patientParam = 'patientId',
  CareAssignmentModel = CareAssignment,
  PatientModel = Patient,
  BreakGlassAccessModel = BreakGlassAccess,
  auditWriter = writeAuditLog,
} = {}) {
  return async (req, res, next) => {
    try {
      if (!req.user || !['doctor', 'specialist'].includes(req.user.role)) {
        await auditWriter({
          actorId: req.user?.id,
          action: 'access_denied',
          resourceType: 'patient',
          resourceId: req.params[patientParam],
          hospitalId: req.user?.hospitalId,
          requestId: req.id,
          metadata: { reason: 'clinician_role_required', method: req.method },
        });
        return next(
          new ApiError(
            403,
            'FORBIDDEN',
            'Only an assigned doctor or specialist can access this patient record.',
          ),
        );
      }

      const patientId = req.params[patientParam];
      if (!mongoose.isValidObjectId(patientId)) {
        return next(new ApiError(404, 'PATIENT_NOT_FOUND', 'That patient record was not found.'));
      }

      const assignment = await CareAssignmentModel.findOne({
        patientId,
        assignedTo: req.user.id,
        hospitalId: req.user.hospitalId,
        status: 'active',
      }).select('_id');
      if (!assignment) {
        const access = req.method === 'GET'
          ? await BreakGlassAccessModel.findOne({
              patientId,
              doctorId: req.user.id,
              status: 'active',
              revokedAt: null,
              expiresAt: { $gt: new Date() },
            }).select('_id reason expiresAt')
          : null;

        if (!access) {
          await auditWriter({
            actorId: req.user.id,
            action: 'access_denied',
            resourceType: 'patient',
            resourceId: patientId,
            hospitalId: req.user.hospitalId,
            requestId: req.id,
            metadata: { reason: 'care_assignment_missing', method: req.method },
          });
          return next(
            new ApiError(403, 'CARE_RELATIONSHIP_REQUIRED', 'You are not assigned to this patient.'),
          );
        }

        req.breakGlass = true;
        req.breakGlassAccessId = access._id;
        await auditWriter({
          actorId: req.user.id,
          action: 'break_glass',
          resourceType: 'patient',
          resourceId: patientId,
          hospitalId: req.user.hospitalId,
          requestId: req.id,
          metadata: { accessId: access._id, expiresAt: access.expiresAt, reasonRecorded: true },
        });
      }

      const patient = await PatientModel.findOne({ _id: patientId, active: true }).select('_id');
      if (!patient)
        return next(new ApiError(404, 'PATIENT_NOT_FOUND', 'That patient record was not found.'));

      req.authorizedPatientId = patient._id;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
