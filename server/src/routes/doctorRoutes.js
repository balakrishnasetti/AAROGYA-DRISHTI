import { Router } from 'express';
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { z } from 'zod';
import {
  AiReport,
  AiReportFeedback,
  Appointment,
  CareAssignment,
  ClinicianReviewTask,
  Consultation,
  Consent,
  FollowUp,
  MediaAsset,
  OutsideReport,
  Patient,
  QrAccessGrant,
  QrScanAudit,
  Referral,
  ScreeningSession,
  User,
  CARE_JOURNEY_STAGES,
} from '../models/index.js';
import { authenticate } from '../middleware/authenticate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authorize } from '../middleware/authorize.js';
import { validateBody } from '../middleware/validate.js';
import { createConsultationNoteVersion } from '../services/consultationNoteService.js';
import { writeAuditLog } from '../services/auditService.js';
import { createPrivateStorageService } from '../services/privateStorageService.js';
import { decryptField } from '../services/fieldEncryption.js';
import { ApiError } from '../utils/apiError.js';
import { createPatientJourneyService } from '../services/patientJourneyService.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const noteSchema = z
  .object({
    body: z.string().trim().min(1).max(20000),
    noteKey: z.string().trim().min(1).max(80).default('consultation'),
    releasedToPatient: z.boolean().default(false),
  })
  .strict();
const referralSchema = z
  .object({
    reason: z.string().trim().min(1).max(2000),
    urgency: z.enum(['routine', 'soon', 'urgent']),
    referredToHospitalId: objectId.optional(),
    destinationName: z.string().trim().max(160).optional(),
    specialty: z.string().trim().max(120).optional(),
    screeningSessionId: objectId.optional(),
  })
  .strict();
const followUpSchema = z
  .object({
    followUpDate: z.coerce.date(),
    instructions: z.string().trim().max(2000).optional(),
    consultationId: objectId.optional(),
  })
  .strict();
export const reportFeedbackSchema = z
  .object({
    agreesWithFinding: z.boolean(),
    correctedFinding: z.enum([
      'white_patch',
      'red_patch',
      'ulcer_like_area',
      'raised_area',
      'no_visible_finding',
      'uncertain',
    ]),
    note: z.string().trim().min(1).max(1000),
  })
  .strict();

export function isClinicianFeedbackConsistent(feedback, aiFinding) {
  if (!aiFinding) return !feedback.agreesWithFinding;
  return feedback.agreesWithFinding === (feedback.correctedFinding === aiFinding);
}
const qrScanSchema = z
  .object({
    qrPayload: z.string().trim().min(1).max(200),
  })
  .strict();
const careJourneyTransitionSchema = z
  .object({
    toStage: z.enum(CARE_JOURNEY_STAGES),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export function createDoctorRoutes(environment) {
  const router = Router();
  const storage = createPrivateStorageService(environment);
  const patientJourney = createPatientJourneyService();
  router.use(authenticate(environment), authorize('doctor', 'specialist'));

  router.get(
    '/cases/:patientId/care-journey',
    asyncHandler(async (req, res) => {
      if (!mongoose.isValidObjectId(req.params.patientId)) {
        throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient not found.');
      }
      const assignment = await CareAssignment.exists({
        patientId: req.params.patientId,
        assignedTo: req.user.id,
        hospitalId: req.user.hospitalId,
        status: 'active',
      });
      if (!assignment) {
        throw new ApiError(403, 'CARE_RELATIONSHIP_REQUIRED', 'You are not assigned to this patient.');
      }
      const details = await patientJourney.getPatientJourney(req.params.patientId);
      res.json({ success: true, code: 'PATIENT_CARE_JOURNEY', details });
    }),
  );

  router.patch(
    '/cases/:patientId/care-journey',
    validateBody(careJourneyTransitionSchema),
    asyncHandler(async (req, res) => {
      if (!mongoose.isValidObjectId(req.params.patientId)) {
        throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient not found.');
      }
      const assignment = await CareAssignment.exists({
        patientId: req.params.patientId,
        assignedTo: req.user.id,
        hospitalId: req.user.hospitalId,
        status: 'active',
      });
      if (!assignment) {
        throw new ApiError(403, 'CARE_RELATIONSHIP_REQUIRED', 'You are not assigned to this patient.');
      }
      const details = await patientJourney.transitionPatientJourney({
        patientId: req.params.patientId,
        toStage: req.body.toStage,
        actorId: req.user.id,
        reason: req.body.reason,
        requestId: req.id,
        hospitalId: req.user.hospitalId,
      });
      res.json({ success: true, code: 'PATIENT_CARE_JOURNEY_UPDATED', details });
    }),
  );

  router.get(
    '/screening-reviews',
    asyncHandler(async (req, res) => {
      const assignments = await CareAssignment.find({
        assignedTo: req.user.id,
        hospitalId: req.user.hospitalId,
        status: 'active',
      })
        .select('patientId')
        .lean();
      const patientIds = [...new Set(assignments.map((item) => item.patientId.toString()))];
      if (!patientIds.length) return res.json({ success: true, details: [] });

      const consents = await Consent.find({
        patientId: { $in: patientIds },
        consentType: 'data_sharing',
      })
        .sort({ recordedAt: -1 })
        .select('patientId granted withdrawnAt')
        .lean();
      const consentByPatient = new Map();
      for (const consent of consents) {
        const key = consent.patientId.toString();
        if (!consentByPatient.has(key)) consentByPatient.set(key, consent);
      }
      const shareablePatientIds = patientIds.filter((patientId) => {
        const consent = consentByPatient.get(patientId);
        return consent?.granted && !consent.withdrawnAt;
      });
      if (!shareablePatientIds.length) return res.json({ success: true, details: [] });

      const tasks = await ClinicianReviewTask.find({
        patientId: { $in: shareablePatientIds },
        status: { $in: ['pending', 'in_review'] },
      })
        .sort({ priority: 1, createdAt: 1 })
        .limit(50)
        .lean();
      if (!tasks.length) return res.json({ success: true, details: [] });
      const [reports, patients] = await Promise.all([
        AiReport.find({ _id: { $in: tasks.map((task) => task.reportId) } })
          .select('-heatmapStorageKey')
          .lean(),
        Patient.find({ _id: { $in: tasks.map((task) => task.patientId) }, active: true })
          .select('_id userId')
          .lean(),
      ]);
      const accounts = patients.length
        ? await User.find({ _id: { $in: patients.map((patient) => patient.userId) } })
            .select('_id fullName')
            .lean()
        : [];
      const reportById = new Map(reports.map((report) => [report._id.toString(), report]));
      const nameByPatientId = new Map(
        patients.map((patient) => [
          patient._id.toString(),
          accounts.find((account) => account._id.toString() === patient.userId.toString())
            ?.fullName || 'Patient',
        ]),
      );
      await writeAuditLog({
        actorId: req.user.id,
        action: 'read',
        resourceType: 'clinician_screening_review_queue',
        hospitalId: req.user.hospitalId,
        requestId: req.id,
        metadata: { taskCount: tasks.length },
      });
      res.json({
        success: true,
        details: tasks
          .map((task) => ({
            ...task,
            patientName: nameByPatientId.get(task.patientId.toString()) || 'Patient',
            report: reportById.get(task.reportId.toString()) || null,
          }))
          .filter((task) => task.report),
      });
    }),
  );

  router.patch(
    '/screening-reviews/:taskId/start',
    asyncHandler(async (req, res) => {
      if (!mongoose.isValidObjectId(req.params.taskId)) {
        throw new ApiError(404, 'REVIEW_TASK_NOT_FOUND', 'Clinician review task not found.');
      }
      const task = await ClinicianReviewTask.findById(req.params.taskId).lean();
      const assignment = task
        ? await CareAssignment.exists({
            patientId: task.patientId,
            assignedTo: req.user.id,
            hospitalId: req.user.hospitalId,
            status: 'active',
          })
        : null;
      const consent = task
        ? await Consent.findOne({
            patientId: task.patientId,
            consentType: 'data_sharing',
          })
            .sort({ recordedAt: -1 })
            .lean()
        : null;
      if (!task || !assignment) {
        throw new ApiError(404, 'REVIEW_TASK_NOT_FOUND', 'Clinician review task not found.');
      }
      if (!consent?.granted || consent.withdrawnAt) {
        throw new ApiError(403, 'CONSENT_REQUIRED', 'Active data-sharing consent is required.');
      }
      const updated = await ClinicianReviewTask.findOneAndUpdate(
        {
          _id: task._id,
          status: { $in: ['pending', 'in_review'] },
          $or: [{ assignedTo: req.user.id }, { assignedTo: { $exists: false } }],
        },
        { $set: { status: 'in_review', assignedTo: req.user.id } },
        { new: true },
      )
        .select('_id status')
        .lean();
      if (!updated) {
        throw new ApiError(
          409,
          'REVIEW_TASK_UNAVAILABLE',
          'This review task is no longer available.',
        );
      }
      await writeAuditLog({
        actorId: req.user.id,
        action: 'edit',
        resourceType: 'clinician_review_task',
        resourceId: task._id.toString(),
        hospitalId: req.user.hospitalId,
        requestId: req.id,
        metadata: { status: updated.status },
      });
      res.json({ success: true, details: updated });
    }),
  );

  router.post(
    '/qr/scan',
    validateBody(qrScanSchema),
    asyncHandler(async (req, res) => {
      const match = req.body.qrPayload.match(/^AAROGYA1:([A-Za-z0-9_-]{43})$/);
      const tokenHash = match ? createHash('sha256').update(match[1]).digest('hex') : null;
      const grant = tokenHash
        ? await QrAccessGrant.findOne({ tokenHash })
            .select('_id patientId expiresAt revokedAt consumedAt')
            .lean()
        : null;
      if (!grant || grant.revokedAt || grant.consumedAt || grant.expiresAt <= new Date()) {
        await QrScanAudit.create({
          scannerId: req.user.id,
          hospitalId: req.user.hospitalId,
          outcome: 'invalid_or_expired',
          requestId: req.id,
        });
        throw new ApiError(
          404,
          'QR_INVALID_OR_EXPIRED',
          'This patient QR is invalid, revoked, or expired.',
        );
      }

      const consent = await Consent.findOne({
        patientId: grant.patientId,
        consentType: 'data_sharing',
      })
        .sort({ recordedAt: -1 })
        .lean();
      if (!consent?.granted || consent.withdrawnAt) {
        await QrScanAudit.create({
          patientId: grant.patientId,
          grantId: grant._id,
          scannerId: req.user.id,
          hospitalId: req.user.hospitalId,
          outcome: 'consent_missing',
          requestId: req.id,
        });
        throw new ApiError(
          403,
          'CONSENT_REQUIRED',
          'Active patient data-sharing consent is required to view this summary.',
        );
      }

      const assignment = await CareAssignment.exists({
        patientId: grant.patientId,
        assignedTo: req.user.id,
        hospitalId: req.user.hospitalId,
        status: 'active',
      });
      if (!assignment) {
        await QrScanAudit.create({
          patientId: grant.patientId,
          grantId: grant._id,
          scannerId: req.user.id,
          hospitalId: req.user.hospitalId,
          outcome: 'care_relationship_missing',
          requestId: req.id,
        });
        throw new ApiError(
          403,
          'CARE_RELATIONSHIP_REQUIRED',
          'An active care assignment is required to view this patient summary.',
        );
      }

      const consumedAt = new Date();
      const consumedGrant = await QrAccessGrant.findOneAndUpdate(
        {
          _id: grant._id,
          revokedAt: { $exists: false },
          consumedAt: { $exists: false },
          expiresAt: { $gt: consumedAt },
        },
        { $set: { consumedAt } },
        { new: true },
      )
        .select('_id')
        .lean();
      if (!consumedGrant) {
        await QrScanAudit.create({
          patientId: grant.patientId,
          grantId: grant._id,
          scannerId: req.user.id,
          hospitalId: req.user.hospitalId,
          outcome: 'invalid_or_expired',
          requestId: req.id,
        });
        throw new ApiError(
          404,
          'QR_INVALID_OR_EXPIRED',
          'This patient QR is invalid, revoked, or expired.',
        );
      }

      const patient = await Patient.findOne({ _id: grant.patientId, active: true })
        .select('userId dateOfBirth')
        .lean();
      const account = patient
        ? await User.findById(patient.userId).select('fullName').lean()
        : null;
      if (!patient || !account) {
        await QrScanAudit.create({
          patientId: grant.patientId,
          grantId: grant._id,
          scannerId: req.user.id,
          hospitalId: req.user.hospitalId,
          outcome: 'invalid_or_expired',
          requestId: req.id,
        });
        throw new ApiError(
          404,
          'QR_INVALID_OR_EXPIRED',
          'This patient QR is invalid, revoked, or expired.',
        );
      }

      await QrScanAudit.create({
        patientId: patient._id,
        grantId: grant._id,
        scannerId: req.user.id,
        hospitalId: req.user.hospitalId,
        outcome: 'allowed',
        requestId: req.id,
      });

      const screeningIds = await ScreeningSession.find({ patientId: patient._id })
        .sort({ startedAt: -1 })
        .limit(10)
        .select('_id startedAt status')
        .lean();
      const ids = screeningIds.map((screening) => screening._id);
      const [reports, appointments, outsideReports] = await Promise.all([
        ids.length
          ? AiReport.find({ screeningSessionId: { $in: ids } })
              .sort({ generatedAt: -1 })
              .limit(10)
              .select('generatedAt region riskCategory finding confidence modelName modelVersion')
              .lean()
          : [],
        Appointment.find({ patientId: patient._id })
          .sort({ slotStart: -1 })
          .limit(10)
          .select('slotStart status hospitalId')
          .lean(),
        OutsideReport.find({ patientId: patient._id })
          .sort({ uploadedAt: -1 })
          .limit(10)
          .select('title documentType uploadedAt')
          .lean(),
      ]);

      const birthDateValue = decryptField(patient.dateOfBirth);
      const birthDate = birthDateValue ? new Date(birthDateValue) : null;
      const now = new Date();
      const age =
        birthDate && !Number.isNaN(birthDate.getTime())
          ? Math.max(
              0,
              now.getFullYear() -
                birthDate.getFullYear() -
                (now.getMonth() < birthDate.getMonth() ||
                (now.getMonth() === birthDate.getMonth() && now.getDate() < birthDate.getDate())
                  ? 1
                  : 0),
            )
          : null;

      res.json({
        success: true,
        details: {
          patient: {
            id: patient._id,
            name: account.fullName,
            age,
          },
          screenings: screeningIds.map((screening) => ({
            id: screening._id,
            startedAt: screening.startedAt,
            status: screening.status,
          })),
          latestScreeningResults: reports,
          appointments: appointments.map((appointment) => ({
            id: appointment._id,
            date: appointment.slotStart,
            status: appointment.status,
          })),
          reports: outsideReports,
          readOnly: true,
          disclaimer: 'Screening results are informational only and are not a diagnosis.',
        },
      });
    }),
  );

  router.get(
    '/cases',
    asyncHandler(async (req, res) => {
      const appointments = await Appointment.find({
        doctorId: req.user.id,
        hospitalId: req.user.hospitalId,
        status: { $in: ['requested', 'accepted', 'confirmed'] },
      })
        .sort({ slotStart: 1 })
        .limit(50)
        .lean();
      const patientIds = appointments.map((item) => item.patientId);
      const [patients, consultations] = await Promise.all([
        Patient.find({ _id: { $in: patientIds }, active: true })
          .select('_id userId')
          .lean(),
        Consultation.find({ appointmentId: { $in: appointments.map((item) => item._id) } })
          .select('_id appointmentId')
          .lean(),
      ]);
      const users = patients.length
        ? await User.find({ _id: { $in: patients.map((item) => item.userId) } })
            .select('_id fullName')
            .lean()
        : [];
      const nameByPatientId = new Map(
        patients.map((patient) => [
          patient._id.toString(),
          users.find((user) => user._id.toString() === patient.userId.toString())?.fullName ||
            'Patient',
        ]),
      );
      const consultationByAppointmentId = new Map(
        consultations.map((item) => [item.appointmentId.toString(), item._id.toString()]),
      );
      res.json({
        success: true,
        details: appointments.map((item) => ({
          id: item._id,
          patientId: item.patientId,
          patientName: nameByPatientId.get(item.patientId.toString()) || 'Patient',
          slotStart: item.slotStart,
          consultationMode: item.consultationMode,
          feeAmount: item.feeAmount,
          status: item.status,
          reason: item.reason || '',
          screeningSessionId: item.screeningSessionId || null,
          consultationId: consultationByAppointmentId.get(item._id.toString()) || null,
        })),
      });
    }),
  );

  router.get(
    '/cases/:patientId/reports',
    asyncHandler(async (req, res) => {
      if (!mongoose.isValidObjectId(req.params.patientId)) {
        throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient not found.');
      }
      const assignment = await CareAssignment.exists({
        patientId: req.params.patientId,
        assignedTo: req.user.id,
        hospitalId: req.user.hospitalId,
        status: 'active',
      });
      if (!assignment)
        throw new ApiError(
          403,
          'CARE_RELATIONSHIP_REQUIRED',
          'You are not assigned to this patient.',
        );
      const consent = await Consent.findOne({
        patientId: req.params.patientId,
        consentType: 'data_sharing',
      })
        .sort({ recordedAt: -1 })
        .lean();
      if (!consent?.granted || consent.withdrawnAt) {
        throw new ApiError(
          403,
          'CONSENT_REQUIRED',
          'Active data-sharing consent is required to view screening reports.',
        );
      }
      const screeningIds = await ScreeningSession.find({
        patientId: req.params.patientId,
      }).distinct('_id');
      const reports = await AiReport.find({ screeningSessionId: { $in: screeningIds } })
        .sort({ generatedAt: -1 })
        .limit(50)
        .select('-heatmapStorageKey')
        .lean();
      await writeAuditLog({
        actorId: req.user.id,
        action: 'read',
        resourceType: 'patient_ai_reports',
        resourceId: req.params.patientId,
        hospitalId: req.user.hospitalId,
        requestId: req.id,
      });
      res.json({ success: true, details: reports });
    }),
  );

  router.post(
    '/cases/:patientId/reports/:reportId/feedback',
    validateBody(reportFeedbackSchema),
    asyncHandler(async (req, res) => {
      if (
        !mongoose.isValidObjectId(req.params.patientId) ||
        !mongoose.isValidObjectId(req.params.reportId)
      ) {
        throw new ApiError(404, 'AI_REPORT_NOT_FOUND', 'Screening report not found.');
      }
      const assignment = await CareAssignment.exists({
        patientId: req.params.patientId,
        assignedTo: req.user.id,
        hospitalId: req.user.hospitalId,
        status: 'active',
      });
      if (!assignment) {
        throw new ApiError(
          403,
          'CARE_RELATIONSHIP_REQUIRED',
          'You are not assigned to this patient.',
        );
      }
      const consent = await Consent.findOne({
        patientId: req.params.patientId,
        consentType: 'data_sharing',
      })
        .sort({ recordedAt: -1 })
        .lean();
      if (!consent?.granted || consent.withdrawnAt) {
        throw new ApiError(
          403,
          'CONSENT_REQUIRED',
          'Active data-sharing consent is required to review screening reports.',
        );
      }
      const screeningIds = await ScreeningSession.find({
        patientId: req.params.patientId,
      }).distinct('_id');
      const report = await AiReport.findOne({
        _id: req.params.reportId,
        screeningSessionId: { $in: screeningIds },
      }).select('_id finding');
      if (!report) {
        throw new ApiError(404, 'AI_REPORT_NOT_FOUND', 'Screening report not found.');
      }
      if (!isClinicianFeedbackConsistent(req.body, report.finding)) {
        throw new ApiError(
          400,
          'AI_FEEDBACK_INCONSISTENT',
          'The agreement selection must match the clinician-reviewed finding.',
        );
      }

      const feedback = await AiReportFeedback.create({
        reportId: report._id,
        patientId: req.params.patientId,
        reviewerId: req.user.id,
        ...req.body,
      });
      const reviewTask = await ClinicianReviewTask.findOneAndUpdate(
        {
          reportId: report._id,
          patientId: req.params.patientId,
          status: { $in: ['pending', 'in_review'] },
        },
        {
          $set: {
            status: 'completed',
            reviewerId: req.user.id,
            reviewedAt: new Date(),
          },
        },
        { new: true },
      )
        .select('_id')
        .lean();
      await writeAuditLog({
        actorId: req.user.id,
        action: 'create',
        resourceType: 'ai_report_feedback',
        resourceId: feedback._id.toString(),
        hospitalId: req.user.hospitalId,
        requestId: req.id,
        metadata: {
          reportId: report._id.toString(),
          correctedFinding: feedback.correctedFinding,
          agreesWithFinding: feedback.agreesWithFinding,
        },
      });
      if (reviewTask) {
        await writeAuditLog({
          actorId: req.user.id,
          action: 'edit',
          resourceType: 'clinician_review_task',
          resourceId: reviewTask._id.toString(),
          hospitalId: req.user.hospitalId,
          requestId: req.id,
          metadata: { status: 'completed' },
        });
      }
      res.status(201).json({
        success: true,
        details: { id: feedback._id, createdAt: feedback.createdAt },
      });
    }),
  );

  router.get(
    '/cases/:patientId/media/:mediaAssetId',
    asyncHandler(async (req, res) => {
      if (
        !mongoose.isValidObjectId(req.params.patientId) ||
        !mongoose.isValidObjectId(req.params.mediaAssetId)
      ) {
        throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Image not found.');
      }
      const assignment = await CareAssignment.exists({
        patientId: req.params.patientId,
        assignedTo: req.user.id,
        hospitalId: req.user.hospitalId,
        status: 'active',
      });
      if (!assignment)
        throw new ApiError(
          403,
          'CARE_RELATIONSHIP_REQUIRED',
          'You are not assigned to this patient.',
        );
      const consent = await Consent.findOne({
        patientId: req.params.patientId,
        consentType: 'data_sharing',
      })
        .sort({ recordedAt: -1 })
        .lean();
      if (!consent?.granted || consent.withdrawnAt) {
        throw new ApiError(
          403,
          'CONSENT_REQUIRED',
          'Active data-sharing consent is required to view images.',
        );
      }
      const media = await MediaAsset.findOne({
        _id: req.params.mediaAssetId,
        patientId: req.params.patientId,
        deletedAt: { $exists: false },
      })
        .select('storageKey contentType')
        .lean();
      if (!media) throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Image not found.');
      const object = await storage.readObject(media.storageKey);
      res.set({
        'Content-Type': object.contentType || media.contentType,
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      object.body.on('error', () => res.destroy());
      object.body.pipe(res);
    }),
  );

  router.post(
    '/consultations/:consultationId/notes',
    validateBody(noteSchema),
    asyncHandler(async (req, res) => {
      if (!mongoose.isValidObjectId(req.params.consultationId)) {
        throw new ApiError(404, 'CONSULTATION_NOT_FOUND', 'Consultation not found.');
      }
      const consultation = await Consultation.findOne({
        _id: req.params.consultationId,
        doctorId: req.user.id,
        hospitalId: req.user.hospitalId,
      }).select('_id patientId');
      if (!consultation)
        throw new ApiError(404, 'CONSULTATION_NOT_FOUND', 'Consultation not found.');
      const assignment = await CareAssignment.exists({
        patientId: consultation.patientId,
        assignedTo: req.user.id,
        hospitalId: req.user.hospitalId,
        status: 'active',
      });
      if (!assignment)
        throw new ApiError(
          403,
          'CARE_RELATIONSHIP_REQUIRED',
          'You are not assigned to this patient.',
        );
      const note = await createConsultationNoteVersion({
        consultationId: consultation._id,
        noteKey: req.body.noteKey,
        doctorId: req.user.id,
        body: req.body.body,
        signedAt: new Date(),
        releasedToPatient: req.body.releasedToPatient,
        releasedAt: req.body.releasedToPatient ? new Date() : null,
      });
      await writeAuditLog({
        actorId: req.user.id,
        action: 'create',
        resourceType: 'consultation_note',
        resourceId: note._id.toString(),
        hospitalId: req.user.hospitalId,
        requestId: req.id,
        metadata: { version: note.version, releasedToPatient: note.releasedToPatient },
      });
      res.status(201).json({ success: true, details: note });
    }),
  );

  router.post(
    '/cases/:patientId/referrals',
    validateBody(referralSchema),
    asyncHandler(async (req, res) => {
      if (!mongoose.isValidObjectId(req.params.patientId)) {
        throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient not found.');
      }
      const assignment = await CareAssignment.exists({
        patientId: req.params.patientId,
        assignedTo: req.user.id,
        hospitalId: req.user.hospitalId,
        status: 'active',
      });
      if (!assignment)
        throw new ApiError(
          403,
          'CARE_RELATIONSHIP_REQUIRED',
          'You are not assigned to this patient.',
        );
      let screeningSessionId;
      if (req.body.screeningSessionId) {
        const screening = await ScreeningSession.exists({
          _id: req.body.screeningSessionId,
          patientId: req.params.patientId,
        });
        if (!screening)
          throw new ApiError(404, 'SCREENING_SESSION_NOT_FOUND', 'Screening session not found.');
        screeningSessionId = req.body.screeningSessionId;
      }
      const referral = await Referral.create({
        patientId: req.params.patientId,
        screeningSessionId,
        hospitalId: req.user.hospitalId,
        referredBy: req.user.id,
        referredToHospitalId: req.body.referredToHospitalId,
        destinationName: req.body.destinationName,
        specialty: req.body.specialty,
        reason: req.body.reason,
        urgency: req.body.urgency,
      });
      await writeAuditLog({
        actorId: req.user.id,
        action: 'create',
        resourceType: 'referral',
        resourceId: referral._id.toString(),
        hospitalId: req.user.hospitalId,
        requestId: req.id,
        metadata: { urgency: referral.urgency },
      });
      res.status(201).json({ success: true, details: referral });
    }),
  );

  router.post(
    '/cases/:patientId/follow-ups',
    validateBody(followUpSchema),
    asyncHandler(async (req, res) => {
      if (!mongoose.isValidObjectId(req.params.patientId)) {
        throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient not found.');
      }
      const assignment = await CareAssignment.exists({
        patientId: req.params.patientId,
        assignedTo: req.user.id,
        hospitalId: req.user.hospitalId,
        status: 'active',
      });
      if (!assignment)
        throw new ApiError(
          403,
          'CARE_RELATIONSHIP_REQUIRED',
          'You are not assigned to this patient.',
        );
      if (
        req.body.consultationId &&
        !(await Consultation.exists({
          _id: req.body.consultationId,
          patientId: req.params.patientId,
          doctorId: req.user.id,
        }))
      ) {
        throw new ApiError(404, 'CONSULTATION_NOT_FOUND', 'Consultation not found.');
      }
      const followUpDate = req.body.followUpDate;
      const followUp = await FollowUp.create({
        patientId: req.params.patientId,
        consultationId: req.body.consultationId,
        assignedTo: req.user.id,
        followUpDate,
        dueAt: followUpDate,
        instructions: req.body.instructions,
      });
      await writeAuditLog({
        actorId: req.user.id,
        action: 'create',
        resourceType: 'follow_up',
        resourceId: followUp._id.toString(),
        hospitalId: req.user.hospitalId,
        requestId: req.id,
      });
      res.status(201).json({ success: true, details: followUp });
    }),
  );

  return router;
}
