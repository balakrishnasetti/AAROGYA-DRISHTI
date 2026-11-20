import mongoose from 'mongoose';
import { blockMutation, createModel, createTimestampedSchema, objectId } from './shared.js';

const consentSchema = createTimestampedSchema(
  {
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    screeningSessionId: { type: objectId, ref: 'ScreeningSession' },
    consentType: {
      type: String,
      enum: ['screening', 'imaging', 'ai_processing', 'teleconsultation', 'data_sharing'],
      required: true,
    },
    consentVersion: { type: String, required: true, trim: true, maxlength: 40 },
    textVersion: { type: String, required: true, trim: true, maxlength: 80 },
    language: { type: String, enum: ['en', 'te'], required: true },
    granted: { type: Boolean, required: true },
    recordedAt: { type: Date, required: true },
    withdrawnAt: Date,
    recordedBy: { type: objectId, ref: 'User' },
  },
  { collection: 'consents' },
);
consentSchema.index({ patientId: 1, consentType: 1, recordedAt: -1 });
export const Consent = createModel('Consent', consentSchema);

const screeningSessionSchema = createTimestampedSchema(
  {
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    hospitalId: { type: objectId, ref: 'Hospital', index: true },
    createdBy: { type: objectId, ref: 'User', required: true },
    consentId: { type: objectId, ref: 'Consent', required: true },
    status: {
      type: String,
      enum: ['started', 'in_progress', 'completed', 'cancelled'],
      default: 'started',
      required: true,
    },
    startedAt: { type: Date, required: true },
    questionnaireVersion: { type: String, required: true, trim: true, maxlength: 40 },
    completedAt: Date,
  },
  { collection: 'screening_sessions' },
);
screeningSessionSchema.index({ hospitalId: 1, createdAt: -1 });
screeningSessionSchema.index({ patientId: 1, createdAt: -1 });
export const ScreeningSession = createModel('ScreeningSession', screeningSessionSchema);

const answerSchema = new mongoose.Schema(
  {
    questionKey: { type: String, required: true, trim: true, maxlength: 100 },
    answer: { type: mongoose.Schema.Types.Mixed },
    skipped: { type: Boolean, default: false, required: true },
  },
  { _id: false, strict: 'throw' },
);

const questionnaireResponseSchema = createTimestampedSchema(
  {
    screeningSessionId: { type: objectId, ref: 'ScreeningSession', required: true },
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    questionnaireVersion: { type: String, required: true, trim: true, maxlength: 40 },
    answers: {
      type: [answerSchema],
      required: true,
      default: [],
    },
    completedAt: Date,
  },
  { collection: 'questionnaire_responses' },
);
questionnaireResponseSchema.index({ screeningSessionId: 1 }, { unique: true });
export const QuestionnaireResponse = createModel(
  'QuestionnaireResponse',
  questionnaireResponseSchema,
);

const questionnaireOptionSchema = new mongoose.Schema(
  {
    value: { type: String, required: true, trim: true, maxlength: 100 },
    labelKey: { type: String, required: true, trim: true, maxlength: 160 },
  },
  { _id: false, strict: 'throw' },
);

const questionnaireQuestionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 100 },
    section: { type: String, required: true, trim: true, maxlength: 60 },
    input: {
      type: String,
      enum: ['number', 'select', 'multi_select', 'text', 'textarea', 'boolean'],
      required: true,
    },
    labelKey: { type: String, required: true, trim: true, maxlength: 160 },
    helpKey: { type: String, trim: true, maxlength: 160 },
    sensitive: { type: Boolean, default: false, required: true },
    reasonKey: { type: String, trim: true, maxlength: 160 },
    allowsSkip: { type: Boolean, default: true, required: true, immutable: true },
    min: Number,
    max: Number,
    options: { type: [questionnaireOptionSchema], default: [] },
  },
  { _id: false, strict: 'throw' },
);

const questionnaireVersionSchema = new mongoose.Schema(
  {
    version: { type: String, required: true, trim: true, maxlength: 40 },
    questions: {
      type: [questionnaireQuestionSchema],
      required: true,
      validate: [(questions) => questions.length > 0, 'Add at least one question.'],
    },
    createdAt: { type: Date, required: true, default: Date.now },
    createdBy: { type: objectId, ref: 'User' },
  },
  { _id: false, strict: 'throw' },
);

const questionnaireSchema = createTimestampedSchema(
  {
    key: { type: String, required: true, unique: true, trim: true, maxlength: 80 },
    activeVersion: { type: String, required: true, trim: true, maxlength: 40 },
    versions: {
      type: [questionnaireVersionSchema],
      required: true,
      validate: [(versions) => versions.length > 0, 'Keep at least one questionnaire version.'],
    },
  },
  { collection: 'questionnaires' },
);
export const Questionnaire = createModel('Questionnaire', questionnaireSchema);

const mediaAssetSchema = createTimestampedSchema(
  {
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    screeningSessionId: { type: objectId, ref: 'ScreeningSession', required: true, index: true },
    uploadedBy: { type: objectId, ref: 'User', required: true },
    region: {
      type: String,
      enum: [
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
      ],
      required: true,
    },
    storageKey: { type: String, required: true, trim: true, maxlength: 512 },
    contentType: { type: String, required: true, enum: ['image/jpeg', 'image/png', 'image/webp'] },
    sizeBytes: { type: Number, required: true, min: 1, max: 25000000 },
    imageQuality: {
      type: String,
      enum: ['adequate', 'inadequate', 'uncertain'],
      default: 'adequate',
    },
    qualityReasons: {
      type: [String],
      enum: ['resolution', 'blur', 'too_dark', 'glare', 'not_oral'],
      default: [],
    },
    checksum: { type: String, trim: true, maxlength: 128 },
    capturedAt: Date,
    retentionExpiresAt: Date,
    deletedAt: Date,
  },
  { collection: 'media_assets' },
);
mediaAssetSchema.index({ storageKey: 1 }, { unique: true });
mediaAssetSchema.index({ screeningSessionId: 1, createdAt: -1 });
export const MediaAsset = createModel('MediaAsset', mediaAssetSchema);

const aiReportSchema = createTimestampedSchema(
  {
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    screeningSessionId: { type: objectId, ref: 'ScreeningSession', required: true, index: true },
    mediaAssetId: { type: objectId, ref: 'MediaAsset', required: true },
    modelName: { type: String, required: true, trim: true, maxlength: 120 },
    modelVersion: { type: String, required: true, trim: true, maxlength: 80 },
    analysisStatus: {
      type: String,
      enum: [
        'completed',
        'inconclusive',
        'unavailable',
        'consent_not_granted',
        'quality_not_adequate',
        'not_configured',
        'pending',
        'unclear',
      ],
    },
    predictedClass: {
      type: String,
      enum: ['benign', 'malignant', 'healthy', 'opmd', 'suspicious_oral_lesion'],
    },
    finding: {
      type: String,
      enum: ['white_patch', 'red_patch', 'ulcer_like_area', 'raised_area', 'no_visible_finding'],
    },
    confidence: { type: Number, min: 0, max: 1 },
    confidenceCalibrated: { type: Boolean, required: true, default: false },
    modelValidated: { type: Boolean, required: true, default: false, immutable: true },
    classProbabilities: { type: Map, of: Number },
    combinedRiskScore: { type: Number, min: 0, max: 100 },
    questionnaireRiskPoints: { type: Number, min: 0, max: 50 },
    riskFactors: { type: [String], default: [] },
    scoringVersion: { type: String, trim: true, maxlength: 80 },
    heatmapStorageKey: { type: String, trim: true, maxlength: 512 },
    imageQuality: { type: String, enum: ['adequate', 'inadequate', 'uncertain'], required: true },
    analysisReasons: { type: [String], default: [] },
    observations: { type: [String], required: true, default: [] },
    observedFeatures: { type: [String], default: [] },
    reportedSymptoms: { type: [String], default: [] },
    lifestyleFactors: { type: [String], default: [] },
    region: { type: String, required: true, trim: true, maxlength: 120 },
    riskCategory: {
      type: String,
      enum: ['low', 'moderate', 'high', 'urgent_evaluation', 'unclear'],
      required: true,
    },
    urgency: {
      type: String,
      enum: ['routine', 'soon', 'urgent'],
      default: 'routine',
      required: true,
    },
    explanation: { type: String, required: true, trim: true, maxlength: 3000 },
    explanationTe: { type: String, trim: true, maxlength: 3000 },
    recommendedNextSteps: { type: [String], required: true, default: [] },
    limitations: { type: [String], required: true, default: [] },
    notForClinicalUse: {
      type: Boolean,
      required: true,
      default: true,
      immutable: true,
      validate: (value) => value === true,
    },
    generatedAt: { type: Date, required: true },
  },
  { collection: 'ai_reports' },
);
aiReportSchema.index({ screeningSessionId: 1, createdAt: -1 });
blockMutation(aiReportSchema, 'AiReport', { allowSyntheticDelete: true });
export const AiReport = createModel('AiReport', aiReportSchema);

const aiReportFeedbackSchema = createTimestampedSchema(
  {
    reportId: { type: objectId, ref: 'AiReport', required: true, index: true },
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    reviewerId: { type: objectId, ref: 'User', required: true },
    agreesWithFinding: { type: Boolean, required: true },
    correctedFinding: {
      type: String,
      enum: [
        'white_patch',
        'red_patch',
        'ulcer_like_area',
        'raised_area',
        'no_visible_finding',
        'uncertain',
      ],
      required: true,
    },
    note: { type: String, required: true, trim: true, minlength: 1, maxlength: 1000 },
  },
  { collection: 'ai_report_feedback' },
);
aiReportFeedbackSchema.index({ reportId: 1, reviewerId: 1, createdAt: -1 });
blockMutation(aiReportFeedbackSchema, 'AiReportFeedback');
export const AiReportFeedback = createModel('AiReportFeedback', aiReportFeedbackSchema);

const clinicianReviewTaskSchema = createTimestampedSchema(
  {
    reportId: { type: objectId, ref: 'AiReport', required: true, unique: true },
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    screeningSessionId: { type: objectId, ref: 'ScreeningSession', required: true, index: true },
    priority: { type: String, enum: ['high', 'unclear'], required: true },
    status: {
      type: String,
      enum: ['pending', 'in_review', 'completed'],
      default: 'pending',
      required: true,
    },
    assignedTo: { type: objectId, ref: 'User', index: true },
    hospitalId: { type: objectId, ref: 'Hospital', index: true },
    reviewerId: { type: objectId, ref: 'User' },
    reviewedAt: Date,
  },
  { collection: 'clinician_review_tasks' },
);
clinicianReviewTaskSchema.index({ assignedTo: 1, status: 1, createdAt: 1 });
export const ClinicianReviewTask = createModel('ClinicianReviewTask', clinicianReviewTaskSchema);

const outsideReportSchema = createTimestampedSchema(
  {
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    uploadedBy: { type: objectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    source: {
      type: String,
      enum: ['clinic', 'patient', 'external'],
      default: 'patient',
      required: true,
    },
    documentType: {
      type: String,
      enum: ['report', 'lab', 'imaging', 'note', 'other'],
      default: 'report',
      required: true,
    },
    storageKey: { type: String, required: true, trim: true, maxlength: 512 },
    contentType: {
      type: String,
      required: true,
      enum: ['application/pdf', 'image/jpeg', 'image/png'],
    },
    sizeBytes: { type: Number, required: true, min: 1, max: 25000000 },
    description: { type: String, trim: true, maxlength: 1500 },
    isInformational: { type: Boolean, default: true, required: true },
    notForDiagnosis: { type: Boolean, default: true, required: true },
    disclaimer: {
      type: String,
      default: 'Informational only. This document is not a diagnosis or treatment recommendation.',
      trim: true,
      maxlength: 300,
    },
    uploadedAt: { type: Date, required: true, default: Date.now },
  },
  { collection: 'outside_reports' },
);
outsideReportSchema.index({ patientId: 1, uploadedAt: -1 });
export const OutsideReport = createModel('OutsideReport', outsideReportSchema);
