import { ApiError } from '../utils/apiError.js';
import { pipeline } from 'node:stream/promises';
import { validateObjectIdParam } from './userController.js';
import { auditFilterSchema, doctorDocumentTypeSchema } from '../validators/managementValidators.js';

function respond(res, code, message, details, status = 200) {
  res.status(status).json({ success: true, code, message, details });
}

export function createManagementController({ managementService }) {
  return {
    createHospital: async (req, res) =>
      respond(
        res,
        'HOSPITAL_CREATED',
        'The hospital and manager account were created. Save the initial password; it will not be shown again.',
        await managementService.createHospital(req.body, req),
        201,
      ),
    listHospitals: async (req, res) =>
      respond(
        res,
        'HOSPITALS',
        'Hospital records are ready.',
        await managementService.listHospitals(req),
      ),
    updateHospital: async (req, res) =>
      respond(
        res,
        'HOSPITAL_UPDATED',
        'The hospital profile was updated.',
        await managementService.updateHospital(req.params.hospitalId, req.body, req),
      ),
    listUsers: async (req, res) =>
      respond(res, 'USERS', 'User records are ready.', await managementService.listUsers(req)),
    updateUser: async (req, res) =>
      respond(
        res,
        'USER_UPDATED',
        'The user account was updated.',
        await managementService.setUser(req.params.userId, req.body, req),
      ),
    summary: async (req, res) =>
      respond(
        res,
        'PLATFORM_SUMMARY',
        'Platform totals are ready.',
        await managementService.getSummary(req),
      ),
    auditLogs: async (req, res) =>
      respond(
        res,
        'AUDIT_LOGS',
        'Audit records are ready.',
        await managementService.listAuditLogs(req.auditFilters, req),
      ),
    exportAuditLogs: async (req, res) => {
      const csv = await managementService.exportAuditLogs(req.auditFilters, req);
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="aarogya-audit-log.csv"');
      res.send(csv);
    },
    hospitalProfile: async (req, res) =>
      respond(
        res,
        'HOSPITAL_PROFILE',
        'Your hospital profile is ready.',
        await managementService.getHospitalProfile(req),
      ),
    updateHospitalProfile: async (req, res) =>
      respond(
        res,
        'HOSPITAL_UPDATED',
        'Your hospital profile was updated.',
        await managementService.updateHospitalProfile(req.body, req),
      ),
    hospitalOverview: async (req, res) =>
      respond(
        res,
        'HOSPITAL_OVERVIEW',
        'Hospital operational totals are ready.',
        await managementService.getHospitalOverview(req),
      ),
    listDoctors: async (req, res) =>
      respond(
        res,
        'DOCTORS',
        'Doctor profiles are ready.',
        await managementService.listDoctors(req),
      ),
    createDoctor: async (req, res) =>
      respond(
        res,
        'DOCTOR_CREATED',
        'The doctor account was created pending document verification. Save the initial password; it will not be shown again.',
        await managementService.createDoctor(req.body, req),
        201,
      ),
    updateDoctor: async (req, res) =>
      respond(
        res,
        'DOCTOR_UPDATED',
        'The doctor profile was updated.',
        await managementService.updateDoctor(req.params.doctorId, req.body, req),
      ),
    setDoctorStatus: async (req, res) =>
      respond(
        res,
        'DOCTOR_STATUS_UPDATED',
        'The doctor account status was updated.',
        await managementService.setDoctorStatus(req.params.doctorId, req.body.status, req),
      ),
    uploadDoctorFile: async (req, res) =>
      respond(
        res,
        'DOCTOR_FILE_UPLOADED',
        'The file was stored in private storage.',
        await managementService.uploadDoctorFile(
          req.params.doctorId,
          req.params.documentType,
          req.file,
          req,
        ),
        201,
      ),
    uploadDoctorPhoto: async (req, res) => {
      if (!req.file || !['image/jpeg', 'image/png'].includes(req.file.mimetype)) {
        throw new ApiError(
          400,
          'FILE_TYPE_INVALID',
          'Choose a JPEG or PNG doctor photo and try again.',
        );
      }
      respond(
        res,
        'DOCTOR_PHOTO_UPLOADED',
        'The photo was stored in private storage.',
        await managementService.uploadDoctorFile(req.params.doctorId, 'photo', req.file, req),
        201,
      );
    },
    readDoctorDocument: async (req, res) => {
      const file = await managementService.readDoctorFile(
        req.params.doctorId,
        req.params.documentId,
        req,
      );
      res.set('Content-Type', file.contentType);
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Cache-Control', 'private, no-store');
      await pipeline(file.body, res);
    },
    readDoctorPhoto: async (req, res) => {
      const file = await managementService.readDoctorFile(req.params.doctorId, null, req, true);
      res.set('Content-Type', file.contentType);
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Cache-Control', 'private, no-store');
      await pipeline(file.body, res);
    },
    reviewDoctorDocument: async (req, res) =>
      respond(
        res,
        'DOCTOR_DOCUMENT_REVIEWED',
        'The document review was saved.',
        await managementService.reviewDoctorDocument(
          req.params.doctorId,
          req.params.documentId,
          req.body.verificationStatus,
          req,
        ),
      ),
    verifyDoctor: async (req, res) =>
      respond(
        res,
        'DOCTOR_VERIFIED',
        'The doctor is verified and their account is enabled.',
        await managementService.verifyDoctor(req.params.doctorId, req),
      ),
  };
}

export function validateAuditFilters(req, res, next) {
  const parsed = auditFilterSchema.safeParse(req.query);
  if (!parsed.success) {
    return next(
      new ApiError(
        400,
        'VALIDATION_ERROR',
        'Audit filters are invalid. Check the dates and filters, then try again.',
        parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      ),
    );
  }
  req.auditFilters = parsed.data;
  return next();
}

export function validateDocumentTypeParam(req, res, next) {
  const parsed = doctorDocumentTypeSchema.safeParse(req.params.documentType);
  if (!parsed.success) {
    return next(
      new ApiError(400, 'VALIDATION_ERROR', 'Choose a valid document type and try again.'),
    );
  }
  return next();
}

export const validateManagementId = (parameter) => validateObjectIdParam(parameter);
