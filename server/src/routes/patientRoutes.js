import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import multer from 'multer';
import QRCode from 'qrcode';
import { z } from 'zod';
import {
  AiReport,
  CareAssignment,
  ClinicianReviewTask,
  Consent,
  MediaAsset,
  OutsideReport,
  Patient,
  Questionnaire,
  QuestionnaireResponse,
  QrAccessGrant,
  ScreeningSession,
} from '../models/index.js';
import { authenticate } from '../middleware/authenticate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authorize, scopeToHospital } from '../middleware/authorize.js';
import { assertPatientAccess } from '../middleware/patientAccess.js';
import { careRelationship } from '../middleware/careRelationship.js';
import { requireConsent } from '../middleware/consent.js';
import { validateBody } from '../middleware/validate.js';
import { ApiError } from '../utils/apiError.js';
import { validateObjectIdParam } from '../controllers/userController.js';
import { assessImageQuality } from '../services/imageQualityService.js';
import { createOralScreeningModelProvider } from '../services/oralScreeningModelService.js';
import { createPrivateStorageService } from '../services/privateStorageService.js';
import { writeAuditLog } from '../services/auditService.js';
import { createPatientJourneyService } from '../services/patientJourneyService.js';
import { decryptField } from '../services/fieldEncryption.js';
import {
  exportOralScreeningPdf,
  exportOralScreeningPhotoRecordPdf,
} from '../services/reportExportService.js';
import {
  createConsent,
  createQuestionnaireResponse,
  getPatient,
  getQuestionnaire,
  listPatientConsents,
  updateConsent,
  updatePatient,
  withdrawConsent,
} from '../controllers/patientController.js';

const patientPatchSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  dateOfBirth: z.coerce.date().optional(),
  sexAtBirth: z.enum(['female', 'male', 'intersex', 'undisclosed']).optional(),
  district: z.string().trim().max(100).optional(),
  preferredLanguage: z.enum(['en', 'te']).optional(),
});

const consentWriteSchema = z.object({
  consentType: z.enum([
    'screening',
    'imaging',
    'ai_processing',
    'teleconsultation',
    'data_sharing',
  ]),
  textVersion: z.string().trim().min(1).max(80),
  language: z.enum(['en', 'te']),
  granted: z.boolean().default(true),
  recordedAt: z.coerce.date().optional(),
  screeningSessionId: z.string().trim().optional(),
});

const consentUpdateSchema = consentWriteSchema.partial();
const screeningImageSchema = z
  .object({
    region: z.enum([
      'tongue',
      'inner_cheeks',
      'gums',
      'lips',
      'floor_of_mouth',
      'roof_of_mouth',
      'upper_palate',
      'lower_mouth',
      'left_cheek',
      'right_cheek',
      'tongue_top',
      'tongue_underside',
      'other',
    ]),
    captureConsent: z.literal('true'),
    mouthVisible: z.literal('true'),
  })
  .strict();
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1_000_000, files: 1 },
}).single('file');
const QR_GRANT_TTL_MS = 5 * 60 * 1000;

function hashQrToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function activeConsent(patientId, consentType) {
  const consent = await Consent.findOne({ patientId, consentType }).sort({ recordedAt: -1 }).lean();
  return consent?.granted && !consent.withdrawnAt ? consent : null;
}

function decodeQuestionnaireAnswers(response) {
  return (response?.answers || []).map((answer) => ({
    ...answer,
    answer:
      typeof answer.answer === 'string' && answer.answer.startsWith('enc:v1:')
        ? JSON.parse(decryptField(answer.answer))
        : answer.answer,
  }));
}

function serializeAiReport(report) {
  if (!report) return null;
  return {
    id: report._id,
    patientId: report.patientId,
    screeningSessionId: report.screeningSessionId,
    mediaAssetId: report.mediaAssetId,
    modelName: report.modelName,
    modelVersion: report.modelVersion,
    analysisStatus: report.analysisStatus,
    predictedClass: report.predictedClass,
    finding: report.finding,
    confidence: report.confidence,
    confidenceCalibrated: report.confidenceCalibrated === true,
    modelValidated: report.modelValidated === true,
    classProbabilities:
      report.classProbabilities instanceof Map
        ? Object.fromEntries(report.classProbabilities)
        : report.classProbabilities,
    combinedRiskScore: report.combinedRiskScore,
    questionnaireRiskPoints: report.questionnaireRiskPoints,
    riskFactors: report.riskFactors || [],
    scoringVersion: report.scoringVersion,
    hasHeatmap: Boolean(report.heatmapStorageKey),
    imageQuality: report.imageQuality,
    analysisReasons: report.analysisReasons || [],
    observedFeatures: report.observedFeatures,
    region: report.region,
    riskCategory: report.riskCategory,
    explanation: report.explanation,
    explanationTe: report.explanationTe,
    reportedSymptoms: report.reportedSymptoms,
    lifestyleFactors: report.lifestyleFactors,
    recommendedNextSteps: report.recommendedNextSteps,
    urgency: report.urgency,
    limitations: report.limitations,
    notForClinicalUse: true,
    generatedAt: report.generatedAt,
  };
}

async function readObjectBuffer(object, maxBytes) {
  const chunks = [];
  let length = 0;
  for await (const chunk of object.body) {
    length += chunk.length;
    if (length > maxBytes) {
      throw new ApiError(
        413,
        'REPORT_IMAGE_TOO_LARGE',
        'A report image exceeds the safe size limit.',
      );
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}

export function createPatientRoutes(environment) {
  const router = Router();
  const checkDoctorAssignment = careRelationship();
  const patientJourney = createPatientJourneyService();
  const storage = createPrivateStorageService(environment);
  const oralScreeningModelProvider = createOralScreeningModelProvider(environment);
  router.use(authenticate(environment));

  router.get(
    '/me',
    authorize('patient'),
    asyncHandler(async (req, res) => {
      const patient = await Patient.findOne({ userId: req.user.id, active: true });
      if (!patient) {
        res.status(404).json({
          success: false,
          code: 'PATIENT_NOT_FOUND',
          message: 'That patient record was not found.',
          details: null,
        });
        return;
      }
      req.params.patientId = patient._id.toString();
      req.authorizedPatient = patient;
      await getPatient(req, res);
    }),
  );

  router.get(
    '/me/care-journey',
    authorize('patient'),
    asyncHandler(async (req, res) => {
      const patient = await Patient.findOne({ userId: req.user.id, active: true })
        .select('_id')
        .lean();
      if (!patient) throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient record not found.');
      const details = await patientJourney.getPatientJourney(patient._id);
      res.json({ success: true, code: 'PATIENT_CARE_JOURNEY', details });
    }),
  );

  router.post(
    '/me/qr',
    authorize('patient'),
    asyncHandler(async (req, res) => {
      const patient = await Patient.findOne({ userId: req.user.id, active: true })
        .select('_id')
        .lean();
      if (!patient) throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient record not found.');

      const now = new Date();
      await QrAccessGrant.updateMany(
        { patientId: patient._id, revokedAt: { $exists: false } },
        { $set: { revokedAt: now } },
      );
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now.getTime() + QR_GRANT_TTL_MS);
      const grant = await QrAccessGrant.create({
        patientId: patient._id,
        tokenHash: hashQrToken(token),
        issuedAt: now,
        expiresAt,
      });
      const qrDataUrl = await QRCode.toDataURL(`AAROGYA1:${token}`, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 360,
      });
      await writeAuditLog({
        actorId: req.user.id,
        action: 'create',
        resourceType: 'patient_qr_access_grant',
        resourceId: grant._id.toString(),
        requestId: req.id,
        metadata: { expiresAt: expiresAt.toISOString() },
      });
      res.status(201).json({
        success: true,
        details: { qrDataUrl, expiresAt, expiresInSeconds: QR_GRANT_TTL_MS / 1000 },
      });
    }),
  );

  router.delete(
    '/me/qr',
    authorize('patient'),
    asyncHandler(async (req, res) => {
      const patient = await Patient.findOne({ userId: req.user.id, active: true })
        .select('_id')
        .lean();
      if (!patient) throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient record not found.');
      const revokedAt = new Date();
      const result = await QrAccessGrant.updateMany(
        {
          patientId: patient._id,
          revokedAt: { $exists: false },
          expiresAt: { $gt: revokedAt },
        },
        { $set: { revokedAt } },
      );
      await writeAuditLog({
        actorId: req.user.id,
        action: 'delete',
        resourceType: 'patient_qr_access_grant',
        resourceId: patient._id.toString(),
        requestId: req.id,
        metadata: { revokedCount: result.modifiedCount },
      });
      res.json({ success: true, details: { revokedCount: result.modifiedCount } });
    }),
  );

  router.patch(
    '/me',
    authorize('patient'),
    validateBody(patientPatchSchema),
    asyncHandler(async (req, res) => {
      const patient = await Patient.findOne({ userId: req.user.id, active: true });
      if (!patient) {
        res.status(404).json({
          success: false,
          code: 'PATIENT_NOT_FOUND',
          message: 'That patient record was not found.',
          details: null,
        });
        return;
      }
      req.params.patientId = patient._id.toString();
      req.authorizedPatient = patient;
      await updatePatient(req, res);
    }),
  );

  router.post(
    '/me/screenings',
    authorize('patient'),
    asyncHandler(async (req, res) => {
      const patient = await Patient.findOne({ userId: req.user.id, active: true })
        .select('_id')
        .lean();
      if (!patient) throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient record not found.');
      const consent = await activeConsent(patient._id, 'screening');
      if (!consent)
        throw new ApiError(
          403,
          'CONSENT_REQUIRED',
          'Active screening consent is required to begin.',
        );
      const questionnaire = await Questionnaire.findOne({ key: 'oral-screening' }).lean();
      if (!questionnaire)
        throw new ApiError(
          503,
          'QUESTIONNAIRE_UNAVAILABLE',
          'The screening questionnaire is not configured.',
        );
      const session = await ScreeningSession.create({
        patientId: patient._id,
        hospitalId: req.user.hospitalId || null,
        createdBy: req.user.id,
        consentId: consent._id,
        status: 'in_progress',
        startedAt: new Date(),
        questionnaireVersion: questionnaire.activeVersion,
      });
      await writeAuditLog({
        actorId: req.user.id,
        action: 'create',
        resourceType: 'screening_session',
        resourceId: session._id.toString(),
        requestId: req.id,
      });
      res.status(201).json({
        success: true,
        details: {
          id: session._id,
          status: session.status,
          questionnaireVersion: session.questionnaireVersion,
        },
      });
    }),
  );

  router.get(
    '/me/screenings/:screeningSessionId',
    authorize('patient'),
    validateObjectIdParam('screeningSessionId'),
    asyncHandler(async (req, res) => {
      const patient = await Patient.findOne({ userId: req.user.id, active: true })
        .select('_id')
        .lean();
      if (!patient) throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient record not found.');
      const session = await ScreeningSession.findOne({
        _id: req.params.screeningSessionId,
        patientId: patient._id,
      }).lean();
      if (!session)
        throw new ApiError(404, 'SCREENING_SESSION_NOT_FOUND', 'Screening session not found.');
      const [response, reports] = await Promise.all([
        QuestionnaireResponse.findOne({ screeningSessionId: session._id }).lean(),
        AiReport.find({ screeningSessionId: session._id })
          .sort({ generatedAt: -1 })
          .limit(10)
          .lean(),
      ]);
      res.json({
        success: true,
        details: {
          session,
          answers: decodeQuestionnaireAnswers(response),
          reports: reports.map(serializeAiReport),
        },
      });
    }),
  );

  router.post(
    '/me/screenings/:screeningSessionId/complete',
    authorize('patient'),
    validateObjectIdParam('screeningSessionId'),
    asyncHandler(async (req, res) => {
      const patient = await Patient.findOne({ userId: req.user.id, active: true })
        .select('_id')
        .lean();
      if (!patient) throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient record not found.');
      if (!(await activeConsent(patient._id, 'screening'))) {
        throw new ApiError(
          403,
          'CONSENT_REQUIRED',
          'Active screening consent is required to complete this session.',
        );
      }
      const response = await QuestionnaireResponse.exists({
        screeningSessionId: req.params.screeningSessionId,
        patientId: patient._id,
      });
      if (!response)
        throw new ApiError(
          409,
          'QUESTIONNAIRE_REQUIRED',
          'Save the screening answers before completing this session.',
        );
      const session = await ScreeningSession.findOneAndUpdate(
        {
          _id: req.params.screeningSessionId,
          patientId: patient._id,
          status: { $in: ['started', 'in_progress'] },
        },
        { $set: { status: 'completed', completedAt: new Date() } },
        { new: true },
      );
      if (!session)
        throw new ApiError(
          404,
          'SCREENING_SESSION_NOT_FOUND',
          'The screening session is no longer active.',
        );
      await writeAuditLog({
        actorId: req.user.id,
        action: 'edit',
        resourceType: 'screening_session',
        resourceId: session._id.toString(),
        requestId: req.id,
        metadata: { status: 'completed' },
      });
      await patientJourney.transitionPatientJourney({
        patientId: patient._id,
        toStage: 'screening_completed',
        actorId: req.user.id,
        reason: 'Patient completed an oral screening session.',
        requestId: req.id,
        hospitalId: session.hospitalId,
        ignoreAlreadyAdvanced: true,
      });
      res.json({
        success: true,
        details: { id: session._id, status: session.status, completedAt: session.completedAt },
      });
    }),
  );

  router.post(
    '/me/screenings/:screeningSessionId/photos',
    authorize('patient'),
    validateObjectIdParam('screeningSessionId'),
    (req, res, next) => imageUpload(req, res, next),
    asyncHandler(async (req, res) => {
      const patient = await Patient.findOne({ userId: req.user.id, active: true })
        .select('_id')
        .lean();
      if (!patient) throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient record not found.');
      const parsed = screeningImageSchema.safeParse(req.body);
      if (!parsed.success) {
        const validFields = ['region', 'captureConsent', 'mouthVisible', 'file'];
        const invalidFields = [
          ...new Set(
            parsed.error.issues
              .flatMap((issue) => (issue.code === 'unrecognized_keys' ? issue.keys : issue.path))
              .filter((field) => validFields.includes(field)),
          ),
        ];
        if (invalidFields.length === 0) {
          invalidFields.push('region', 'captureConsent', 'mouthVisible');
        }
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          'Confirm capture consent and mouth visibility, then choose a valid photo angle.',
          { invalidFields },
        );
      }
      const session = await ScreeningSession.findOne({
        _id: req.params.screeningSessionId,
        patientId: patient._id,
        status: { $in: ['started', 'in_progress'] },
      }).lean();
      if (!session)
        throw new ApiError(
          404,
          'SCREENING_SESSION_NOT_FOUND',
          'The screening session is no longer active.',
        );
      const [screeningConsent, imagingConsent, aiConsent] = await Promise.all([
        activeConsent(patient._id, 'screening'),
        activeConsent(patient._id, 'imaging'),
        activeConsent(patient._id, 'ai_processing'),
      ]);
      if (!screeningConsent)
        throw new ApiError(403, 'CONSENT_REQUIRED', 'Active screening consent is required.');
      if (!imagingConsent)
        throw new ApiError(403, 'CONSENT_REQUIRED', 'Active photo consent is required.');
      let quality;
      try {
        quality = await assessImageQuality({
          buffer: req.file?.buffer,
          mimetype: req.file?.mimetype,
        });
      } catch (qualityError) {
        if (qualityError instanceof ApiError) throw qualityError;
        req.log?.warn(
          { requestId: req.id, errorName: qualityError.name },
          'Screening photo quality validation failed',
        );
        throw new ApiError(
          400,
          'IMAGE_INVALID',
          'The photo could not be checked safely. Choose a valid JPEG, PNG, or WebP image.',
        );
      }
      const response = await QuestionnaireResponse.findOne({
        screeningSessionId: session._id,
      }).lean();
      const answers = decodeQuestionnaireAnswers(response);
      let stored;
      try {
        stored = await storage.storeScreeningPhoto({
          patientId: patient._id,
          screeningSessionId: session._id,
          region: parsed.data.region,
          file: req.file,
        });
      } catch (storageError) {
        if (storageError instanceof ApiError) throw storageError;
        req.log?.error(
          { requestId: req.id, errorName: storageError.name },
          'Screening photo could not be stored in private storage',
        );
        throw new ApiError(
          503,
          'PRIVATE_STORAGE_UNAVAILABLE',
          'The private photo store is unavailable. Your photo was not saved; try again later.',
        );
      }
      let media;
      try {
        media = await MediaAsset.create({
          patientId: patient._id,
          screeningSessionId: session._id,
          uploadedBy: req.user.id,
          region: parsed.data.region,
          storageKey: stored.storageKey,
          contentType: stored.contentType,
          sizeBytes: stored.sizeBytes,
          imageQuality: quality.imageQuality,
          qualityReasons: quality.reasons || [],
          capturedAt: new Date(),
        });
      } catch (persistenceError) {
        try {
          await storage.deleteObject(stored.storageKey);
        } catch (cleanupError) {
          req.log?.error(
            { requestId: req.id, errorCode: cleanupError.code },
            'Could not remove a screening photo after its record failed to save',
          );
        }
        req.log?.error(
          { requestId: req.id, errorName: persistenceError.name },
          'Screening photo record could not be saved',
        );
        throw new ApiError(
          503,
          'SCREENING_PHOTO_RECORD_UNAVAILABLE',
          'The private photo was stored, but its record could not be saved. Contact support before retrying.',
        );
      }
      await writeAuditLog({
        actorId: req.user.id,
        action: 'create',
        resourceType: 'media_asset',
        resourceId: media._id.toString(),
        requestId: req.id,
        metadata: {
          screeningSessionId: session._id.toString(),
          region: parsed.data.region,
          captureConsent: parsed.data.captureConsent,
          mouthVisible: parsed.data.mouthVisible,
        },
      });
      let result = null;
      let analysisStatus = 'unavailable';
      if (quality.imageQuality !== 'adequate') {
        analysisStatus = 'inconclusive';
      } else if (!aiConsent) {
        analysisStatus = 'consent_not_granted';
      } else if (oralScreeningModelProvider.configured) {
        try {
          const modelStatus = await oralScreeningModelProvider.getStatus();
          if (modelStatus.status === 'ready') {
            result = await oralScreeningModelProvider.predict({
              imageBuffer: stored.buffer,
              mimeType: stored.contentType,
              region: parsed.data.region,
            });
            analysisStatus = result?.status === 'classified' ? 'completed' : 'inconclusive';
          } else {
            analysisStatus = 'unavailable';
          }
        } catch (analysisError) {
          req.log?.error(
            { requestId: req.id, errorName: analysisError.name },
            'Oral screening model prediction failed',
          );
          analysisStatus = 'unavailable';
        }
      } else {
        analysisStatus = 'unavailable';
      }

      const predictionAvailable = analysisStatus === 'completed' && result;
      const reportRisk = predictionAvailable ? result.riskLevel : 'unclear';
      const reportQuality =
        result?.imageQuality === 'inadequate' ? 'inadequate' : quality.imageQuality;
      const nextSteps =
        analysisStatus === 'completed'
          ? reportRisk === 'low'
            ? [
                'This screening aid does not rule out a condition. Consult a doctor if a mouth change persists or worsens.',
              ]
            : [
                'Please arrange a review with a doctor or oral health specialist soon.',
                'Use the appointment or call-request options to arrange professional care.',
              ]
          : analysisStatus === 'inconclusive'
            ? [
                'Retake the photo in focus with bright, even lighting.',
                'Consult a qualified doctor if you have a persistent or concerning mouth change.',
              ]
            : [
                'AI analysis is not available yet. No AI prediction was generated.',
                'Please consult a qualified doctor or oral health specialist about any concern.',
              ];
      let report;
      try {
        report = await AiReport.create({
          patientId: patient._id,
          screeningSessionId: session._id,
          mediaAssetId: media._id,
          modelName: 'Aarogya Drishti EfficientNetB0 oral image classifier',
          modelVersion: result?.modelVersion || 'unavailable',
          analysisStatus,
          predictedClass: predictionAvailable ? result.predictedClass : undefined,
          confidence: predictionAvailable ? result.confidence : undefined,
          confidenceCalibrated: false,
          modelValidated: false,
          classProbabilities: predictionAvailable ? result.classProbabilities : undefined,
          imageQuality: reportQuality,
          analysisReasons: result?.reasons || quality.reasons || [],
          observations: [],
          observedFeatures: [],
          reportedSymptoms: answers
            .filter((answer) => answer.questionKey === 'symptoms' && !answer.skipped)
            .flatMap((answer) => (Array.isArray(answer.answer) ? answer.answer : [])),
          region: parsed.data.region,
          riskCategory: reportRisk,
          explanation:
            analysisStatus === 'completed'
              ? `The model assigned this photo to the dataset's "${result.predictedClass}" image category. It was trained only on benign and malignant lesion photos and cannot identify healthy/normal mouths. This is not a diagnosis; please consult a qualified doctor.`
              : analysisStatus === 'inconclusive'
                ? 'The image quality or model confidence was insufficient to provide a result. Please retake the photo or consult a doctor.'
                : analysisStatus === 'consent_not_granted'
                  ? 'No AI analysis was performed because separate AI-processing consent was not granted.'
                  : 'AI analysis is not available yet. No AI prediction was generated. Please consult a qualified doctor.',
          explanationTe:
            analysisStatus === 'completed'
              ? result.predictedClass === 'malignant'
                ? 'మోడల్ ఈ ఫోటోను డేటాసెట్‌లోని “మాలిగ్నెంట్ గాయం” చిత్ర వర్గానికి కేటాయించింది. ఇది నిర్ధారణ కాదు; అర్హత కలిగిన వైద్యుడిని త్వరగా సంప్రదించండి. ఈ మోడల్ సాధారణ నోటిని గుర్తించదు.'
                : 'మోడల్ ఈ ఫోటోను డేటాసెట్‌లోని “నిరపాయ గాయం” చిత్ర వర్గానికి కేటాయించింది. ఇది నిర్ధారణ కాదు; సమస్య కొనసాగితే వైద్యుడిని సంప్రదించండి. ఈ మోడల్ సాధారణ నోటిని గుర్తించదు.'
              : analysisStatus === 'inconclusive'
                ? 'ఫోటో నాణ్యత లేదా మోడల్ నమ్మక స్థాయి సరిపోక ఫలితం ఇవ్వలేదు. దయచేసి ఫోటోను మళ్లీ తీయండి లేదా వైద్యుడిని సంప్రదించండి.'
                : analysisStatus === 'consent_not_granted'
                  ? 'AI ప్రాసెసింగ్‌కు ప్రత్యేక సమ్మతి ఇవ్వనందున విశ్లేషణ జరగలేదు.'
                  : 'AI విశ్లేషణ ఇంకా అందుబాటులో లేదు. AI అంచనా రూపొందించలేదు. దయచేసి అర్హత కలిగిన వైద్యుడిని సంప్రదించండి.',
          recommendedNextSteps: nextSteps,
          urgency: analysisStatus === 'completed' && reportRisk === 'low' ? 'routine' : 'soon',
          limitations: [
            'This is an AI screening aid and not a medical diagnosis. Please consult a qualified doctor.',
            'This research model is not clinically validated. Confidence is not the probability that a condition is present.',
            'The model was trained on only benign and malignant lesion images; it has no healthy/normal class and cannot reliably reject lesion-free or non-oral images.',
          ],
          notForClinicalUse: true,
          generatedAt: new Date(),
        });
      } catch (persistenceError) {
        req.log?.error(
          { requestId: req.id, errorName: persistenceError.name },
          'Screening report could not be saved',
        );
        throw new ApiError(
          503,
          'SCREENING_REPORT_UNAVAILABLE',
          'The photo was saved, but its report could not be stored. Contact support before retrying.',
        );
      }
      await writeAuditLog({
        actorId: req.user.id,
        action: 'create',
        resourceType: 'oral_ai_prediction',
        resourceId: report._id.toString(),
        requestId: req.id,
        metadata: {
          status: analysisStatus,
          modelVersion: report.modelVersion,
          region: parsed.data.region,
        },
      });
      if (reportRisk === 'high') {
        const careAssignment = await CareAssignment.findOne({
          patientId: patient._id,
          status: 'active',
        })
          .select('assignedTo hospitalId')
          .lean();
        const reviewTask = await ClinicianReviewTask.create({
          reportId: report._id,
          patientId: patient._id,
          screeningSessionId: session._id,
          priority: 'high',
          assignedTo: careAssignment?.assignedTo,
          hospitalId: careAssignment?.hospitalId || session.hospitalId,
        });
        await writeAuditLog({
          actorId: req.user.id,
          action: 'create',
          resourceType: 'clinician_review_task',
          resourceId: reviewTask._id.toString(),
          requestId: req.id,
          metadata: { priority: reviewTask.priority },
        });
      }
      res.status(201).json({
        success: true,
        details: {
          report: serializeAiReport(report),
          analysisStatus,
          photo: { id: media._id, region: media.region, sizeBytes: media.sizeBytes },
          quality,
        },
      });
    }),
  );

  router.get(
    '/me/screenings/:screeningSessionId/photos',
    authorize('patient'),
    validateObjectIdParam('screeningSessionId'),
    asyncHandler(async (req, res) => {
      const patient = await Patient.findOne({ userId: req.user.id, active: true })
        .select('_id')
        .lean();
      if (!patient) throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient record not found.');
      const session = await ScreeningSession.findOne({
        _id: req.params.screeningSessionId,
        patientId: patient._id,
      })
        .select('_id')
        .lean();
      if (!session)
        throw new ApiError(404, 'SCREENING_SESSION_NOT_FOUND', 'Screening session not found.');
      const photos = await MediaAsset.find({
        patientId: patient._id,
        screeningSessionId: session._id,
        deletedAt: { $exists: false },
      })
        .select('_id region sizeBytes imageQuality qualityReasons createdAt')
        .sort({ createdAt: 1 })
        .lean();
      res.json({
        success: true,
        details: photos.map((photo) => ({
          _id: photo._id,
          region: photo.region,
          sizeBytes: photo.sizeBytes,
          imageQuality: photo.imageQuality,
          qualityReasons: photo.qualityReasons || [],
          createdAt: photo.createdAt,
        })),
      });
    }),
  );

  router.get(
    '/me/screenings/:screeningSessionId/photos/:mediaAssetId/image',
    authorize('patient'),
    validateObjectIdParam('screeningSessionId'),
    validateObjectIdParam('mediaAssetId'),
    asyncHandler(async (req, res) => {
      const patient = await Patient.findOne({ userId: req.user.id, active: true })
        .select('_id')
        .lean();
      const media = patient
        ? await MediaAsset.findOne({
            _id: req.params.mediaAssetId,
            screeningSessionId: req.params.screeningSessionId,
            patientId: patient._id,
            deletedAt: { $exists: false },
          })
            .select('storageKey contentType')
            .lean()
        : null;
      if (!media) throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Screening photo not found.');
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

  router.get(
    '/me/screenings/:screeningSessionId/reports/:reportId/heatmap',
    authorize('patient'),
    validateObjectIdParam('screeningSessionId'),
    validateObjectIdParam('reportId'),
    asyncHandler(async (req, res) => {
      const patient = await Patient.findOne({ userId: req.user.id, active: true })
        .select('_id')
        .lean();
      const report = patient
        ? await AiReport.findOne({
            _id: req.params.reportId,
            screeningSessionId: req.params.screeningSessionId,
          }).lean()
        : null;
      if (!report?.heatmapStorageKey) {
        throw new ApiError(404, 'HEATMAP_NOT_FOUND', 'Screening heatmap not found.');
      }
      const session = await ScreeningSession.exists({
        _id: req.params.screeningSessionId,
        patientId: patient._id,
      });
      if (!session) throw new ApiError(404, 'HEATMAP_NOT_FOUND', 'Screening heatmap not found.');
      const sourcePhoto = await MediaAsset.exists({
        _id: report.mediaAssetId,
        patientId: patient._id,
        deletedAt: { $exists: false },
      });
      if (!sourcePhoto)
        throw new ApiError(404, 'HEATMAP_NOT_FOUND', 'Screening heatmap not found.');
      const object = await storage.readObject(report.heatmapStorageKey);
      res.set({
        'Content-Type': 'image/png',
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      object.body.on('error', () => res.destroy());
      object.body.pipe(res);
    }),
  );

  router.get(
    '/me/screenings/:screeningSessionId/reports/:reportId.pdf',
    authorize('patient'),
    validateObjectIdParam('screeningSessionId'),
    validateObjectIdParam('reportId'),
    asyncHandler(async (req, res) => {
      const patient = await Patient.findOne({ userId: req.user.id, active: true })
        .select('_id')
        .lean();
      const report = patient
        ? await AiReport.findOne({
            _id: req.params.reportId,
            screeningSessionId: req.params.screeningSessionId,
          }).lean()
        : null;
      const session = report
        ? await ScreeningSession.exists({
            _id: req.params.screeningSessionId,
            patientId: patient._id,
          })
        : null;
      if (!report || !session) {
        throw new ApiError(404, 'AI_REPORT_NOT_FOUND', 'Screening report not found.');
      }

      const questionnaireResponse = await QuestionnaireResponse.findOne({
        screeningSessionId: session._id,
        patientId: patient._id,
      }).lean();
      const questionnaireAnswers = decodeQuestionnaireAnswers(questionnaireResponse);
      const photo = await MediaAsset.findOne({
        _id: report.mediaAssetId,
        patientId: patient._id,
        deletedAt: { $exists: false },
      })
        .select('storageKey')
        .lean();
      const photoBuffer = photo
        ? await readObjectBuffer(await storage.readObject(photo.storageKey), 1_000_000)
        : null;
      const heatmapBuffer =
        photo && report.heatmapStorageKey
          ? await readObjectBuffer(await storage.readObject(report.heatmapStorageKey), 2_000_000)
          : null;
      const pdf = await exportOralScreeningPdf({
        report,
        photoBuffer,
        heatmapBuffer,
        questionnaireAnswers,
      });
      await writeAuditLog({
        actorId: req.user.id,
        action: 'read',
        resourceType: 'oral_ai_report_pdf',
        resourceId: report._id.toString(),
        requestId: req.id,
        metadata: { modelVersion: report.modelVersion },
      });
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="screening-report-${report._id}.pdf"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.send(pdf);
    }),
  );

  router.get(
    '/me/screenings/:screeningSessionId/photo-record.pdf',
    authorize('patient'),
    validateObjectIdParam('screeningSessionId'),
    asyncHandler(async (req, res) => {
      const patient = await Patient.findOne({ userId: req.user.id, active: true })
        .select('_id')
        .lean();
      const session = patient
        ? await ScreeningSession.findOne({
            _id: req.params.screeningSessionId,
            patientId: patient._id,
          })
            .select('_id startedAt')
            .lean()
        : null;
      if (!session) {
        throw new ApiError(404, 'SCREENING_SESSION_NOT_FOUND', 'Screening session not found.');
      }

      const storedPhotos = await MediaAsset.find({
        patientId: patient._id,
        screeningSessionId: session._id,
        deletedAt: { $exists: false },
      })
        .select('storageKey region imageQuality qualityReasons createdAt')
        .sort({ createdAt: 1 })
        .lean();
      if (!storedPhotos.length) {
        throw new ApiError(
          404,
          'SCREENING_PHOTOS_NOT_FOUND',
          'No saved screening photos were found.',
        );
      }

      const photos = await Promise.all(
        storedPhotos.map(async (photo) => ({
          ...photo,
          buffer: await readObjectBuffer(await storage.readObject(photo.storageKey), 1_000_000),
        })),
      );
      const pdf = await exportOralScreeningPhotoRecordPdf({
        screeningSession: session,
        photos,
      });
      await writeAuditLog({
        actorId: req.user.id,
        action: 'read',
        resourceType: 'oral_screening_photo_record_pdf',
        resourceId: session._id.toString(),
        requestId: req.id,
        metadata: { photoCount: photos.length },
      });
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="screening-photo-record-${session._id}.pdf"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.send(pdf);
    }),
  );

  router.delete(
    '/me/screenings/:screeningSessionId/photos/:mediaAssetId',
    authorize('patient'),
    validateObjectIdParam('screeningSessionId'),
    validateObjectIdParam('mediaAssetId'),
    asyncHandler(async (req, res) => {
      const patient = await Patient.findOne({ userId: req.user.id, active: true })
        .select('_id')
        .lean();
      if (!patient) throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient record not found.');
      const photo = await MediaAsset.findOne({
        _id: req.params.mediaAssetId,
        screeningSessionId: req.params.screeningSessionId,
        patientId: patient._id,
        deletedAt: { $exists: false },
      });
      if (!photo) throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Photo not found.');
      await storage.deleteObject(photo.storageKey);
      const relatedReports = await AiReport.find({
        mediaAssetId: photo._id,
        heatmapStorageKey: { $exists: true, $ne: '' },
      })
        .select('heatmapStorageKey')
        .lean();
      for (const relatedReport of relatedReports) {
        await storage.deleteObject(relatedReport.heatmapStorageKey);
      }
      photo.deletedAt = new Date();
      await photo.save();
      await writeAuditLog({
        actorId: req.user.id,
        action: 'delete',
        resourceType: 'media_asset',
        resourceId: photo._id.toString(),
        requestId: req.id,
        metadata: { screeningSessionId: photo.screeningSessionId.toString() },
      });
      res.json({ success: true, details: { id: photo._id, deletedAt: photo.deletedAt } });
    }),
  );

  router.get(
    '/me/screenings',
    authorize('patient'),
    asyncHandler(async (req, res) => {
      const patient = await Patient.findOne({ userId: req.user.id, active: true })
        .select('_id')
        .lean();
      if (!patient) throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient record not found.');
      const sessions = await ScreeningSession.find({ patientId: patient._id })
        .sort({ startedAt: -1 })
        .limit(50)
        .lean();
      const reports = sessions.length
        ? await AiReport.find({ screeningSessionId: { $in: sessions.map((item) => item._id) } })
            .sort({ generatedAt: -1 })
            .limit(50)
            .lean()
        : [];
      res.json({
        success: true,
        details: sessions.map((session) => ({
          ...session,
          reports: reports
            .filter((report) => report.screeningSessionId.toString() === session._id.toString())
            .map(serializeAiReport),
        })),
      });
    }),
  );

  router.get(
    '/:patientId',
    validateObjectIdParam('patientId'),
    authorize('admin', 'hospital_manager', 'doctor', 'patient'),
    scopeToHospital,
    (req, res, next) => {
      if (['doctor', 'specialist'].includes(req.user.role))
        return checkDoctorAssignment(req, res, next);
      return next();
    },
    asyncHandler(assertPatientAccess),
    asyncHandler(getPatient),
  );

  router.patch(
    '/:patientId',
    validateObjectIdParam('patientId'),
    authorize('admin', 'hospital_manager', 'doctor', 'patient'),
    scopeToHospital,
    (req, res, next) => {
      if (['doctor', 'specialist'].includes(req.user.role))
        return checkDoctorAssignment(req, res, next);
      return next();
    },
    asyncHandler(assertPatientAccess),
    validateBody(patientPatchSchema),
    asyncHandler(updatePatient),
  );

  router.get(
    '/:patientId/consents',
    validateObjectIdParam('patientId'),
    authorize('admin', 'hospital_manager', 'doctor', 'patient'),
    scopeToHospital,
    (req, res, next) => {
      if (['doctor', 'specialist'].includes(req.user.role))
        return checkDoctorAssignment(req, res, next);
      return next();
    },
    asyncHandler(assertPatientAccess),
    asyncHandler(listPatientConsents),
  );

  router.post(
    '/:patientId/consents',
    validateObjectIdParam('patientId'),
    authorize('admin', 'hospital_manager', 'doctor', 'patient'),
    scopeToHospital,
    (req, res, next) => {
      if (['doctor', 'specialist'].includes(req.user.role))
        return checkDoctorAssignment(req, res, next);
      return next();
    },
    asyncHandler(assertPatientAccess),
    validateBody(consentWriteSchema),
    asyncHandler(createConsent),
  );

  router.patch(
    '/:patientId/consents/:consentId',
    validateObjectIdParam('patientId'),
    validateObjectIdParam('consentId'),
    authorize('admin', 'hospital_manager', 'doctor', 'patient'),
    scopeToHospital,
    (req, res, next) => {
      if (['doctor', 'specialist'].includes(req.user.role))
        return checkDoctorAssignment(req, res, next);
      return next();
    },
    asyncHandler(assertPatientAccess),
    validateBody(consentUpdateSchema),
    asyncHandler(updateConsent),
  );

  router.delete(
    '/:patientId/consents/:consentId',
    validateObjectIdParam('patientId'),
    validateObjectIdParam('consentId'),
    authorize('admin', 'hospital_manager', 'doctor', 'patient'),
    scopeToHospital,
    (req, res, next) => {
      if (['doctor', 'specialist'].includes(req.user.role))
        return checkDoctorAssignment(req, res, next);
      return next();
    },
    asyncHandler(assertPatientAccess),
    asyncHandler(withdrawConsent),
  );

  router.get(
    '/:patientId/questionnaire',
    validateObjectIdParam('patientId'),
    authorize('admin', 'hospital_manager', 'doctor', 'patient'),
    scopeToHospital,
    (req, res, next) => {
      if (['doctor', 'specialist'].includes(req.user.role))
        return checkDoctorAssignment(req, res, next);
      return next();
    },
    asyncHandler(assertPatientAccess),
    asyncHandler(getQuestionnaire),
  );

  router.post(
    '/:patientId/questionnaire',
    validateObjectIdParam('patientId'),
    authorize('admin', 'hospital_manager', 'doctor', 'patient'),
    scopeToHospital,
    (req, res, next) => {
      if (['doctor', 'specialist'].includes(req.user.role))
        return checkDoctorAssignment(req, res, next);
      return next();
    },
    asyncHandler(assertPatientAccess),
    (req, res, next) => requireConsent('screening')(req, res, next),
    validateBody(
      z.object({
        questionnaireVersion: z.string().trim().min(1).max(40).optional(),
        screeningSessionId: z.string().trim().optional(),
        answers: z
          .array(
            z.object({
              questionKey: z.string().trim().min(1).max(100),
              answer: z.any(),
              skipped: z.boolean().default(false),
            }),
          )
          .default([]),
      }),
    ),
    asyncHandler(createQuestionnaireResponse),
  );

  router.post(
    '/:patientId/questionnaire/responses',
    validateObjectIdParam('patientId'),
    authorize('admin', 'hospital_manager', 'doctor', 'patient'),
    scopeToHospital,
    (req, res, next) => {
      if (['doctor', 'specialist'].includes(req.user.role))
        return checkDoctorAssignment(req, res, next);
      return next();
    },
    asyncHandler(assertPatientAccess),
    (req, res, next) => requireConsent('screening')(req, res, next),
    validateBody(
      z.object({
        questionnaireVersion: z.string().trim().min(1).max(40).optional(),
        screeningSessionId: z.string().trim().optional(),
        answers: z
          .array(
            z.object({
              questionKey: z.string().trim().min(1).max(100),
              answer: z.any(),
              skipped: z.boolean().default(false),
            }),
          )
          .default([]),
      }),
    ),
    asyncHandler(createQuestionnaireResponse),
  );

  router.get(
    '/:patientId/consent/:consentType/check',
    validateObjectIdParam('patientId'),
    authorize('admin', 'hospital_manager', 'doctor', 'patient'),
    scopeToHospital,
    (req, res, next) => {
      if (['doctor', 'specialist'].includes(req.user.role))
        return checkDoctorAssignment(req, res, next);
      return next();
    },
    asyncHandler(assertPatientAccess),
    asyncHandler(async (req, res, next) => {
      const consentType = req.params.consentType;
      if (
        !['screening', 'imaging', 'ai_processing', 'teleconsultation', 'data_sharing'].includes(
          consentType,
        )
      ) {
        return next(
          new ApiError(400, 'INVALID_CONSENT_TYPE', 'That consent type is not supported.'),
        );
      }
      return requireConsent(consentType)(req, res, next);
    }),
  );

  router.get(
    '/:patientId/history',
    validateObjectIdParam('patientId'),
    authorize('patient', 'doctor', 'admin', 'hospital_manager'),
    scopeToHospital,
    (req, res, next) => {
      if (['doctor', 'specialist'].includes(req.user.role))
        return checkDoctorAssignment(req, res, next);
      return next();
    },
    asyncHandler(assertPatientAccess),
    (req, res, next) =>
      ['doctor', 'specialist'].includes(req.user.role)
        ? requireConsent('data_sharing')(req, res, next)
        : next(),
    asyncHandler(async (req, res) => {
      const { buildPatientHistory } = await import('../services/historyService.js');
      const history = await buildPatientHistory({
        patientId: req.params.patientId,
        viewerRole: req.user.role,
        viewerId: req.user._id,
        hospitalId: req.user.hospitalId,
      });

      res.json({
        success: true,
        code: 'PATIENT_HISTORY',
        message: 'Patient history is ready.',
        details: history,
      });
    }),
  );

  router.post(
    '/:patientId/outside-reports',
    validateObjectIdParam('patientId'),
    authorize('patient', 'doctor'),
    scopeToHospital,
    (req, res, next) => {
      if (['doctor', 'specialist'].includes(req.user.role))
        return checkDoctorAssignment(req, res, next);
      return next();
    },
    asyncHandler(assertPatientAccess),
    validateBody(
      z.object({
        title: z.string().trim().min(1).max(160),
        source: z.enum(['clinic', 'patient', 'external']).optional(),
        documentType: z.enum(['report', 'lab', 'imaging', 'note', 'other']).optional(),
        storageKey: z.string().trim().min(1).max(512),
        contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
        sizeBytes: z.number().int().min(1).max(25000000),
        description: z.string().trim().max(1500).optional(),
        disclaimer: z.string().trim().max(300).optional(),
      }),
    ),
    asyncHandler(async (req, res) => {
      const payload = await OutsideReport.create({
        patientId: req.params.patientId,
        uploadedBy: req.user._id,
        title: req.body.title,
        source: req.body.source ?? 'patient',
        documentType: req.body.documentType ?? 'report',
        storageKey: req.body.storageKey,
        contentType: req.body.contentType,
        sizeBytes: req.body.sizeBytes,
        description: req.body.description,
        isInformational: true,
        notForDiagnosis: true,
        disclaimer:
          req.body.disclaimer ??
          'Informational only. This document is not a diagnosis or treatment recommendation.',
      });

      res.status(201).json({
        success: true,
        code: 'OUTSIDE_REPORT_SAVED',
        message: 'Outside report saved.',
        details: payload,
      });
    }),
  );

  return router;
}
