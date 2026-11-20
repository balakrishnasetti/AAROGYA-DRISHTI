import mongoose from 'mongoose';
import { blockMutation, createModel, createTimestampedSchema, objectId } from './shared.js';

const aiChatMessageSchema = {
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true, trim: true, maxlength: 4000 },
  createdAt: { type: Date, required: true },
};

const aiChatSessionSchema = createTimestampedSchema(
  {
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    screeningSessionId: { type: objectId, ref: 'ScreeningSession' },
    messages: { type: [aiChatMessageSchema], default: [] },
    status: { type: String, enum: ['active', 'closed'], default: 'active', required: true },
    disclaimerShownAt: Date,
  },
  { collection: 'ai_chat_sessions' },
);
aiChatSessionSchema.index({ patientId: 1, updatedAt: -1 });
export const AiChatSession = createModel('AiChatSession', aiChatSessionSchema);

const aiAssistantSessionSchema = createTimestampedSchema(
  {
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    userId: { type: objectId, ref: 'User', required: true },
    language: {
      type: String,
      enum: ['en', 'hi', 'te', 'ta', 'kn', 'ml', 'bn', 'mr'],
      default: 'en',
      required: true,
    },
    status: { type: String, enum: ['active', 'ended'], default: 'active', required: true },
    state: { type: Object, default: {} },
    summary: { type: Object, default: {} },
    recentTurns: {
      type: [
        new mongoose.Schema(
          {
            role: { type: String, enum: ['user', 'assistant'], required: true },
            text: { type: String, required: true, trim: true, maxlength: 4000 },
            createdAt: { type: Date, default: Date.now },
          },
          { _id: false, strict: 'throw' },
        ),
      ],
      default: [],
    },
  },
  { collection: 'ai_assistant_sessions' },
);
aiAssistantSessionSchema.index({ patientId: 1, updatedAt: -1 });
export const AiAssistantSession = createModel('AiAssistantSession', aiAssistantSessionSchema);

const aiAssistantSettingsSchema = createTimestampedSchema(
  {
    provider: {
      type: String,
      enum: ['gemini', 'openai', 'custom'],
      default: 'gemini',
      required: true,
    },
    languages: { type: [String], default: ['en', 'te'] },
    safetyText: {
      type: String,
      default:
        'Emergency help: call 112 or go to the nearest emergency department if you have severe chest pain, breathing trouble, heavy bleeding, stroke signs, or thoughts of self-harm.',
      required: true,
    },
    avatarEnabled: { type: Boolean, default: true, required: true },
    avatarLabel: {
      type: String,
      default: 'AI Health Assistant - not a human doctor',
      required: true,
      maxlength: 200,
    },
    voiceEnabled: { type: Boolean, default: true, required: true },
  },
  { collection: 'ai_assistant_settings' },
);
aiAssistantSettingsSchema.index({ provider: 1 }, { unique: true, sparse: true });
export const AiAssistantSettings = createModel('AiAssistantSettings', aiAssistantSettingsSchema);

const breakGlassAccessSchema = createTimestampedSchema(
  {
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    doctorId: { type: objectId, ref: 'User', required: true, index: true },
    reason: { type: String, required: true, trim: true, minlength: 20, maxlength: 1600 },
    grantedAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    status: {
      type: String,
      enum: ['active', 'expired', 'revoked'],
      default: 'active',
      required: true,
    },
  },
  { collection: 'break_glass_access' },
);
breakGlassAccessSchema.index({ patientId: 1, doctorId: 1, status: 1, expiresAt: 1 });
export const BreakGlassAccess = createModel('BreakGlassAccess', breakGlassAccessSchema);

const governanceRequestSchema = createTimestampedSchema(
  {
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    requestedBy: { type: objectId, ref: 'User', required: true },
    requestType: { type: String, enum: ['correction', 'deletion'], required: true },
    reason: { type: String, required: true, trim: true, minlength: 10, maxlength: 3000 },
    requestedChanges: { type: Object, default: {} },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      required: true,
    },
    reviewedBy: { type: objectId, ref: 'User' },
    reviewedAt: Date,
    reviewNote: { type: String, trim: true, maxlength: 1000 },
  },
  { collection: 'governance_requests' },
);
governanceRequestSchema.index({ status: 1, createdAt: 1 });
governanceRequestSchema.index({ patientId: 1, createdAt: -1 });
export const GovernanceRequest = createModel('GovernanceRequest', governanceRequestSchema);

const staffAccessRequestSchema = createTimestampedSchema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    requestedRole: {
      type: String,
      enum: [
        'hospital_manager',
        'doctor',
        'specialist',
        'health_worker',
        'navigator',
        'district_officer',
      ],
      required: true,
    },
    district: { type: String, required: true, trim: true, maxlength: 120 },
    mandal: { type: String, trim: true, maxlength: 120 },
    phc: { type: String, trim: true, maxlength: 120 },
    assignedVillages: { type: [{ type: String, trim: true, maxlength: 120 }], default: [] },
    hospitalId: { type: objectId, ref: 'Hospital' },
    qualification: { type: String, trim: true, maxlength: 160 },
    registrationNumber: { type: String, trim: true, maxlength: 100 },
    specialty: { type: String, trim: true, maxlength: 120 },
    status: {
      type: String,
      enum: ['pending', 'provisioning', 'approved', 'rejected'],
      default: 'pending',
      required: true,
      index: true,
    },
    reviewedBy: { type: objectId, ref: 'User' },
    reviewedAt: Date,
    reviewNote: { type: String, trim: true, maxlength: 1000 },
    provisionedUserId: { type: objectId, ref: 'User' },
  },
  { collection: 'staff_access_requests' },
);
staffAccessRequestSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['pending', 'provisioning'] } } },
);
staffAccessRequestSchema.index({ status: 1, createdAt: 1 });
export const StaffAccessRequest = createModel('StaffAccessRequest', staffAccessRequestSchema);

const securityAlertSchema = createTimestampedSchema(
  {
    actorId: { type: objectId, ref: 'User', required: true, index: true },
    alertType: { type: String, enum: ['unusual_patient_record_access'], required: true },
    dedupeKey: { type: String, required: true, trim: true, maxlength: 160, unique: true },
    detectedAt: { type: Date, required: true, default: Date.now },
    metadata: { type: Object, default: {} },
  },
  { collection: 'security_alerts' },
);
securityAlertSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
export const SecurityAlert = createModel('SecurityAlert', securityAlertSchema);

const syncOperationSchema = createTimestampedSchema(
  {
    userId: { type: objectId, ref: 'User' },
    clientOpId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
      index: true,
      unique: true,
    },
    route: { type: String, required: true, trim: true, maxlength: 200 },
    method: {
      type: String,
      enum: ['POST', 'PATCH', 'PUT', 'DELETE'],
      default: 'POST',
      required: true,
    },
    payload: { type: Object, default: {} },
    kind: { type: String, default: 'generic', trim: true, maxlength: 80 },
    status: {
      type: String,
      enum: ['pending', 'sent', 'duplicate', 'failed'],
      default: 'pending',
      required: true,
    },
    retries: { type: Number, default: 0, min: 0, max: 20 },
    lastError: { type: String, trim: true, maxlength: 400 },
  },
  { collection: 'sync_operations' },
);
export const SyncOperation = createModel('SyncOperation', syncOperationSchema);

const notificationSchema = createTimestampedSchema(
  {
    userId: { type: objectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true, trim: true, maxlength: 80 },
    titleKey: { type: String, required: true, trim: true, maxlength: 120 },
    bodyKey: { type: String, required: true, trim: true, maxlength: 160 },
    channel: {
      type: String,
      enum: ['in_app', 'email', 'sms'],
      default: 'in_app',
      required: true,
    },
    templateKey: { type: String, trim: true, maxlength: 80 },
    resourceType: { type: String, trim: true, maxlength: 80 },
    resourceId: objectId,
    metadata: { type: Object, default: {} },
    readAt: Date,
    deliveryStatus: {
      type: String,
      enum: ['queued', 'sent', 'failed'],
      default: 'queued',
      required: true,
    },
  },
  { collection: 'notifications' },
);
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
notificationSchema.index(
  { type: 1, resourceId: 1 },
  { unique: true, partialFilterExpression: { type: 'investigation_escalation' } },
);
export const Notification = createModel('Notification', notificationSchema);

const pushSubscriptionSchema = createTimestampedSchema(
  {
    userId: { type: objectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, trim: true, maxlength: 2048 },
    expirationTime: { type: Date, default: null },
    keys: {
      p256dh: { type: String, required: true, maxlength: 256 },
      auth: { type: String, required: true, maxlength: 256 },
    },
    lastUsedAt: Date,
  },
  { collection: 'push_subscriptions' },
);
pushSubscriptionSchema.index({ endpoint: 1 }, { unique: true });
pushSubscriptionSchema.index({ userId: 1, createdAt: -1 });
export const PushSubscription = createModel('PushSubscription', pushSubscriptionSchema);

const careAssignmentSchema = createTimestampedSchema(
  {
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    hospitalId: { type: objectId, ref: 'Hospital', required: true, index: true },
    assignedTo: { type: objectId, ref: 'User', required: true },
    assignedBy: { type: objectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['active', 'completed', 'reassigned'],
      default: 'active',
      required: true,
    },
    assignedAt: { type: Date, required: true },
    endedAt: Date,
  },
  { collection: 'care_assignments' },
);
careAssignmentSchema.index({ hospitalId: 1, assignedTo: 1, status: 1 });
careAssignmentSchema.index({ patientId: 1, status: 1 });
export const CareAssignment = createModel('CareAssignment', careAssignmentSchema);

const auditLogSchema = createTimestampedSchema(
  {
    actorId: { type: objectId, ref: 'User' },
    action: {
      type: String,
      enum: [
        'login',
        'login_failure',
        'logout',
        'password_change',
        'role_change',
        'read',
        'create',
        'edit',
        'export',
        'delete',
        'access_denied',
        'break_glass',
      ],
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
      required: true,
    },
    resourceType: { type: String, required: true, trim: true, maxlength: 100 },
    resourceId: { type: String, trim: true, maxlength: 128 },
    hospitalId: { type: objectId, ref: 'Hospital', index: true },
    requestId: { type: String, trim: true, maxlength: 80 },
    occurredAt: { type: Date, required: true, default: Date.now, index: true },
    metadata: { type: Map, of: String, default: {} },
  },
  { collection: 'audit_logs' },
);
auditLogSchema.index({ actorId: 1, occurredAt: -1 });
auditLogSchema.index({ resourceType: 1, resourceId: 1, occurredAt: -1 });
blockMutation(auditLogSchema, 'AuditLog');
export const AuditLog = createModel('AuditLog', auditLogSchema);

const authAuditLogSchema = createTimestampedSchema(
  {
    userId: { type: objectId, ref: 'User', index: true },
    method: {
      type: String,
      enum: ['manual', 'mobile_otp', 'abha', 'aadhaar_qr'],
      required: true,
      index: true,
    },
    ip: { type: String, trim: true, maxlength: 64 },
    device: { type: String, trim: true, maxlength: 500 },
    result: { type: String, enum: ['success', 'failure', 'denied', 'challenge'], required: true },
    occurredAt: { type: Date, required: true, default: Date.now, index: true },
  },
  { collection: 'auth_audit_logs' },
);
authAuditLogSchema.index({ userId: 1, occurredAt: -1 });
authAuditLogSchema.index({ method: 1, result: 1, occurredAt: -1 });
blockMutation(authAuditLogSchema, 'AuthAuditLog');
export const AuthAuditLog = createModel('AuthAuditLog', authAuditLogSchema);

const qrAccessGrantSchema = createTimestampedSchema(
  {
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    tokenHash: { type: String, required: true, select: false, minlength: 64, maxlength: 64 },
    issuedAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    consumedAt: Date,
  },
  { collection: 'qr_access_grants' },
);
qrAccessGrantSchema.index({ tokenHash: 1 }, { unique: true });
qrAccessGrantSchema.index({ patientId: 1, expiresAt: -1 });
qrAccessGrantSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const QrAccessGrant = createModel('QrAccessGrant', qrAccessGrantSchema);

const qrScanAuditSchema = createTimestampedSchema(
  {
    patientId: { type: objectId, ref: 'Patient', index: true },
    grantId: { type: objectId, ref: 'QrAccessGrant' },
    scannerId: { type: objectId, ref: 'User', required: true, index: true },
    hospitalId: { type: objectId, ref: 'Hospital' },
    outcome: {
      type: String,
      enum: ['allowed', 'invalid_or_expired', 'consent_missing', 'care_relationship_missing'],
      required: true,
    },
    scannedAt: { type: Date, required: true, default: Date.now, index: true },
    requestId: { type: String, trim: true, maxlength: 80 },
  },
  { collection: 'qr_scan_audits' },
);
qrScanAuditSchema.index({ patientId: 1, scannedAt: -1 });
blockMutation(qrScanAuditSchema, 'QrScanAudit');
export const QrScanAudit = createModel('QrScanAudit', qrScanAuditSchema);

const otpRequestSchema = createTimestampedSchema(
  {
    userId: { type: objectId, ref: 'User', index: true },
    destinationHash: { type: String, required: true, trim: true, maxlength: 128 },
    codeHash: { type: String, required: true, select: false, minlength: 20 },
    purpose: { type: String, enum: ['login', 'verify_phone', 'reset_password'], required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0, min: 0, max: 5, required: true },
    consumedAt: Date,
  },
  { collection: 'otp_requests' },
);
otpRequestSchema.index({ destinationHash: 1, purpose: 1, createdAt: -1 });
otpRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const OtpRequest = createModel('OtpRequest', otpRequestSchema);

const otpLoginStateSchema = createTimestampedSchema(
  {
    destinationHash: { type: String, required: true, select: false, minlength: 64, maxlength: 64 },
    sendTimestamps: { type: [Date], default: [] },
    failedAttempts: { type: Number, default: 0, min: 0, max: 5, required: true },
    failureWindowStartedAt: Date,
    lockedUntil: Date,
  },
  { collection: 'otp_login_states' },
);
otpLoginStateSchema.index({ destinationHash: 1 }, { unique: true });
export const OtpLoginState = createModel('OtpLoginState', otpLoginStateSchema);

const abhaLoginChallengeSchema = createTimestampedSchema(
  {
    stateEncrypted: { type: String, required: true, select: false, maxlength: 12000 },
    expiresAt: { type: Date, required: true },
    consumedAt: Date,
  },
  { collection: 'abha_login_challenges' },
);
abhaLoginChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const AbhaLoginChallenge = createModel('AbhaLoginChallenge', abhaLoginChallengeSchema);

const sessionSchema = createTimestampedSchema(
  {
    userId: { type: objectId, ref: 'User', required: true, index: true },
    role: {
      type: String,
      enum: [
        'admin',
        'hospital_manager',
        'doctor',
        'patient',
        'health_worker',
        'navigator',
        'district_officer',
      ],
      required: true,
    },
    refreshTokenHash: { type: String, required: true, select: false, minlength: 20 },
    userAgent: { type: String, trim: true, maxlength: 500 },
    ipHash: { type: String, trim: true, maxlength: 128 },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    lastUsedAt: Date,
  },
  { collection: 'sessions' },
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ userId: 1, revokedAt: 1 });
sessionSchema.index({ refreshTokenHash: 1 }, { unique: true });
export const Session = createModel('Session', sessionSchema);

const passwordResetTokenSchema = createTimestampedSchema(
  {
    userId: { type: objectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, select: false, minlength: 32 },
    expiresAt: { type: Date, required: true },
    consumedAt: Date,
  },
  { collection: 'password_reset_tokens' },
);
passwordResetTokenSchema.index({ tokenHash: 1 }, { unique: true });
passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const PasswordResetToken = createModel('PasswordResetToken', passwordResetTokenSchema);

const patientPasswordActivationSchema = createTimestampedSchema(
  {
    userId: { type: objectId, ref: 'User', required: true, index: true },
    issuedBy: { type: objectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, select: false, minlength: 64, maxlength: 64 },
    expiresAt: { type: Date, required: true },
    consumedAt: Date,
  },
  { collection: 'patient_password_activations' },
);
patientPasswordActivationSchema.index({ tokenHash: 1 }, { unique: true });
patientPasswordActivationSchema.index({ userId: 1, consumedAt: 1 });
patientPasswordActivationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const PatientPasswordActivation = createModel(
  'PatientPasswordActivation',
  patientPasswordActivationSchema,
);

const patientRegistrationChallengeSchema = createTimestampedSchema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 120, select: false },
    phone: { type: String, required: true, trim: true, maxlength: 20, select: false },
    email: { type: String, trim: true, lowercase: true, maxlength: 254, select: false },
    passwordHash: { type: String, required: true, select: false, minlength: 20 },
    destinationHash: { type: String, required: true, select: false, minlength: 64, maxlength: 64 },
    codeHash: { type: String, required: true, select: false, minlength: 64, maxlength: 64 },
    attempts: { type: Number, default: 0, min: 0, max: 5, required: true },
    expiresAt: { type: Date, required: true },
    consumedAt: Date,
  },
  { collection: 'patient_registration_challenges' },
);
patientRegistrationChallengeSchema.index({ destinationHash: 1, consumedAt: 1, createdAt: -1 });
patientRegistrationChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const PatientRegistrationChallenge = createModel(
  'PatientRegistrationChallenge',
  patientRegistrationChallengeSchema,
);
