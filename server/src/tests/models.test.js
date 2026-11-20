import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  AiReport,
  AiReportFeedback,
  QrAccessGrant,
  QrScanAudit,
  Appointment,
  AuditLog,
  AuthAuditLog,
  AuthIdentity,
  AbhaLoginChallenge,
  OtpLoginState,
  PatientPasswordActivation,
  PatientRegistrationChallenge,
  Patient,
  ConsultationNote,
  ConsultationRequest,
  Consultation,
  TeleconsultationNote,
  PushSubscription,
  DoctorProfile,
  Hospital,
  HospitalManager,
  MediaAsset,
  BreakGlassAccess,
  GovernanceRequest,
  SecurityAlert,
  SyncOperation,
  User,
} from '../models/index.js';
import { hospitalScopedFilter } from '../utils/hospitalScope.js';

test('all requested model schemas register with Mongoose', () => {
  const expected = [
    'User',
    'AuthIdentity',
    'AbhaLoginChallenge',
    'Hospital',
    'HospitalManager',
    'DoctorProfile',
    'Patient',
    'Consent',
    'ScreeningSession',
    'QuestionnaireResponse',
    'MediaAsset',
    'AiReport',
    'AiReportFeedback',
    'QrAccessGrant',
    'QrScanAudit',
    'Appointment',
    'TimeSlot',
    'Consultation',
    'ConsultationNote',
    'VideoSession',
    'ConsultationRequest',
    'TeleconsultationNote',
    'PushSubscription',
    'Referral',
    'FollowUp',
    'AiChatSession',
    'Notification',
    'CareAssignment',
    'AuditLog',
    'AuthAuditLog',
    'OtpRequest',
    'OtpLoginState',
    'Session',
    'PasswordResetToken',
    'PatientPasswordActivation',
    'PatientRegistrationChallenge',
    'AiAssistantSession',
    'AiAssistantSettings',
    'SyncOperation',
    'BreakGlassAccess',
    'GovernanceRequest',
    'SecurityAlert',
    'FieldRegistration',
    'Investigation',
    'NavigatorActivity',
  ];

  for (const name of expected) assert.ok(mongoose.models[name], `${name} should be registered`);
});

test('auth identities and auth audit records enforce provider and result fields', () => {
  const userId = new mongoose.Types.ObjectId();
  const identity = new AuthIdentity({
    userId,
    provider: 'abha',
    identityType: 'provider_subject',
    providerUserId: 'a'.repeat(64),
    verifiedAt: new Date(),
  });
  assert.equal(identity.validateSync(), undefined);
  assert.ok(
    new AuthIdentity({
      userId,
      provider: 'unknown',
      identityType: 'provider_subject',
      providerUserId: 'a'.repeat(64),
    }).validateSync().errors.provider,
  );

  const authAudit = new AuthAuditLog({
    userId,
    method: 'mobile_otp',
    ip: '127.0.0.1',
    device: 'test client',
    result: 'success',
  });
  assert.equal(authAudit.validateSync(), undefined);
  assert.ok(
    new AuthAuditLog({
      method: 'manual',
      result: 'unknown',
    }).validateSync().errors.result,
  );

  assert.ok(
    AuthIdentity.schema
      .indexes()
      .some(
        ([fields, options]) =>
          fields.provider === 1 && fields.providerUserId === 1 && options.unique === true,
      ),
  );
});

test('patient password activation tokens are hashed, scoped, and expiring', () => {
  const activation = new PatientPasswordActivation({
    userId: new mongoose.Types.ObjectId(),
    issuedBy: new mongoose.Types.ObjectId(),
    tokenHash: 'a'.repeat(64),
    expiresAt: new Date(Date.now() + 60_000),
  });
  assert.equal(activation.validateSync(), undefined);
  assert.equal(PatientPasswordActivation.schema.path('tokenHash').options.select, false);
  assert.ok(
    PatientPasswordActivation.schema
      .indexes()
      .some(([keys, options]) => keys.expiresAt === 1 && options.expireAfterSeconds === 0),
  );
});

test('patient registration challenges hide pending credentials and expire automatically', () => {
  const challenge = new PatientRegistrationChallenge({
    fullName: 'Patient Example',
    phone: '+919876543210',
    passwordHash: 'b'.repeat(60),
    destinationHash: 'a'.repeat(64),
    codeHash: 'c'.repeat(64),
    expiresAt: new Date(Date.now() + 5 * 60_000),
  });
  assert.equal(challenge.validateSync(), undefined);
  for (const field of [
    'fullName',
    'phone',
    'email',
    'passwordHash',
    'destinationHash',
    'codeHash',
  ]) {
    assert.equal(PatientRegistrationChallenge.schema.path(field).options.select, false);
  }
  assert.ok(
    PatientRegistrationChallenge.schema
      .indexes()
      .some(([keys, options]) => keys.expiresAt === 1 && options.expireAfterSeconds === 0),
  );
});

test('OTP login state stores a unique HMAC destination key and bounded failure fields', () => {
  const state = new OtpLoginState({
    destinationHash: 'a'.repeat(64),
    sendTimestamps: [new Date()],
    failedAttempts: 5,
    lockedUntil: new Date(Date.now() + 60_000),
  });
  assert.equal(state.validateSync(), undefined);
  assert.ok(
    OtpLoginState.schema
      .indexes()
      .some(([fields, options]) => fields.destinationHash === 1 && options.unique === true),
  );
  assert.ok(state.toObject().destinationHash);
});

test('ABHA challenge state is encrypted and expires automatically', () => {
  const challenge = new AbhaLoginChallenge({
    stateEncrypted: 'ciphertext',
    expiresAt: new Date(Date.now() + 60_000),
  });
  assert.equal(challenge.validateSync(), undefined);
  assert.ok(
    AbhaLoginChallenge.schema
      .indexes()
      .some(([fields, options]) => fields.expiresAt === 1 && options.expireAfterSeconds === 0),
  );
  assert.ok(Patient.schema.path('yearOfBirth'));
});

test('call requests require consent and keep recording disabled by default', () => {
  const patientId = new mongoose.Types.ObjectId();
  const doctorId = new mongoose.Types.ObjectId();
  const hospitalId = new mongoose.Types.ObjectId();
  const callRequestId = new mongoose.Types.ObjectId();
  const request = new ConsultationRequest({
    patientId,
    doctorId,
    hospitalId,
    reason: 'follow_up',
    teleconsultationConsentVersion: 'video-call-v1',
    teleconsultationConsentedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  });
  assert.equal(request.validateSync(), undefined);
  assert.equal(request.status, 'pending');
  assert.equal(request.recordingEnabled, false);

  const appointmentConsultation = new Consultation({
    appointmentId: new mongoose.Types.ObjectId(),
    patientId,
    doctorId,
    hospitalId,
  });
  assert.equal(appointmentConsultation.validateSync(), undefined);

  const missingParent = new Consultation({ patientId, doctorId, hospitalId });
  assert.ok(missingParent.validateSync().errors.appointmentId);
  const invalidRequest = new ConsultationRequest({
    patientId,
    doctorId,
    hospitalId,
    reason: 'diagnosis',
    teleconsultationConsentVersion: 'video-call-v1',
    teleconsultationConsentedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  });
  assert.ok(invalidRequest.validateSync().errors.reason);

  const callNote = new TeleconsultationNote({
    callRequestId,
    patientId,
    doctorId,
    version: 1,
    body: 'Follow up with your clinician.',
    signedAt: new Date(),
    releasedAt: new Date(),
  });
  assert.equal(callNote.validateSync(), undefined);
});

test('browser push subscriptions are scoped to a user and require encryption keys', () => {
  assert.ok(PushSubscription.schema.path('userId'));
  assert.ok(PushSubscription.schema.path('endpoint'));
  assert.ok(PushSubscription.schema.path('keys.p256dh'));
  assert.ok(PushSubscription.schema.path('keys.auth'));
  const invalid = new PushSubscription({
    userId: new mongoose.Types.ObjectId(),
    endpoint: 'https://fcm.googleapis.com/push',
  });
  assert.ok(invalid.validateSync().errors['keys.p256dh']);
  assert.ok(invalid.validateSync().errors['keys.auth']);
});

test('hospital directory fields validate types, ownership, hours, and optional rating', () => {
  assert.ok(Hospital.schema.path('centerType'));
  assert.ok(Hospital.schema.path('ownership'));
  assert.ok(Hospital.schema.path('specialties'));
  assert.ok(Hospital.schema.path('rating'));
  assert.ok(Hospital.schema.path('location.coordinates'));
  const invalid = new Hospital({
    name: 'Test center',
    code: 'TEST-CENTER',
    address: 'Test road',
    city: 'Test city',
    state: 'Andhra Pradesh',
    postalCode: '000000',
    ownership: 'unverified',
  });
  assert.ok(invalid.validateSync().errors.ownership);
});

test('schemas use timestamps, strict validation, and synthetic markers', () => {
  for (const model of Object.values(mongoose.models)) {
    if (!model.schema.path('isSynthetic')) continue;
    assert.equal(model.schema.options.timestamps, true, `${model.modelName} timestamps`);
    assert.equal(
      model.schema.path('isSynthetic').defaultValue,
      false,
      `${model.modelName} synthetic default`,
    );
    assert.equal(model.schema.options.strict, 'throw', `${model.modelName} strict mode`);
  }

  const invalidUser = new User({ fullName: 'Synthetic User', role: 'unexpected' });
  assert.ok(invalidUser.validateSync().errors.role);
  for (const role of ['health_worker', 'navigator', 'district_officer']) {
    assert.equal(new User({ fullName: 'Field role', role }).validateSync(), undefined);
  }
});

test('AI reports enforce the allowed categories and not-for-clinical-use marker', () => {
  const report = new AiReport({
    patientId: new mongoose.Types.ObjectId(),
    screeningSessionId: new mongoose.Types.ObjectId(),
    mediaAssetId: new mongoose.Types.ObjectId(),
    modelName: 'synthetic-model',
    modelVersion: '1',
    imageQuality: 'adequate',
    observations: [],
    region: 'unspecified',
    riskCategory: 'diagnosis',
    explanation: 'Synthetic only.',
    recommendedNextSteps: [],
    limitations: [],
    notForClinicalUse: false,
    generatedAt: new Date(),
  });

  const errors = report.validateSync().errors;
  assert.ok(errors.riskCategory);
  assert.ok(errors.notForClinicalUse);
});

test('clinician feedback requires a reason and remains linked to the immutable AI report', () => {
  const feedback = new AiReportFeedback({
    reportId: new mongoose.Types.ObjectId(),
    patientId: new mongoose.Types.ObjectId(),
    reviewerId: new mongoose.Types.ObjectId(),
    agreesWithFinding: false,
    correctedFinding: 'uncertain',
  });
  assert.ok(feedback.validateSync().errors.note);

  feedback.note = 'The image is unclear; request a clinician examination.';
  assert.equal(feedback.validateSync(), undefined);
  assert.ok(feedback.reportId);
});

test('AI reports validate classifier metadata, scores, and the optional heatmap key', () => {
  const report = new AiReport({
    patientId: new mongoose.Types.ObjectId(),
    screeningSessionId: new mongoose.Types.ObjectId(),
    mediaAssetId: new mongoose.Types.ObjectId(),
    modelName: 'torchvision-resnet18',
    modelVersion: 'validated-artifact-v1',
    finding: 'white_patch',
    confidence: 0.82,
    classProbabilities: { white_patch: 0.82, no_visible_finding: 0.18 },
    combinedRiskScore: 52,
    questionnaireRiskPoints: 50,
    riskFactors: ['tobacco_reported'],
    scoringVersion: 'prototype-v1',
    heatmapStorageKey: 'patients/private/heatmap.png',
    imageQuality: 'adequate',
    observations: ['white_patch'],
    region: 'tongue',
    riskCategory: 'moderate',
    explanation: 'Experimental screening result.',
    recommendedNextSteps: ['Arrange clinician review.'],
    limitations: ['Not for clinical use.'],
    notForClinicalUse: true,
    generatedAt: new Date(),
  });

  test('QR grants store hashed expiring tokens and QR scan audits are append-only', async () => {
    const patientId = new mongoose.Types.ObjectId();
    const scannerId = new mongoose.Types.ObjectId();
    const grant = new QrAccessGrant({
      patientId,
      tokenHash: 'a'.repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: new Date(),
    });
    assert.equal(grant.validateSync(), undefined);
    assert.equal(QrAccessGrant.schema.path('tokenHash').options.select, false);
    assert.ok(QrAccessGrant.schema.path('consumedAt'));
    assert.ok(
      QrAccessGrant.schema.indexes().some(([, options]) => options.expireAfterSeconds === 0),
    );

    const audit = new QrScanAudit({
      patientId,
      grantId: new mongoose.Types.ObjectId(),
      scannerId,
      outcome: 'allowed',
      scannedAt: new Date(),
    });
    assert.equal(audit.validateSync(), undefined);
    await assert.rejects(
      QrScanAudit.updateOne({}, { $set: { outcome: 'allowed' } }).exec(),
      /QrScanAudit records are immutable/,
    );
  });

  assert.equal(report.validateSync(), undefined);
  assert.equal(report.modelValidated, false);
  assert.equal(report.confidenceCalibrated, false);
  assert.equal(AiReportFeedback.schema.options.timestamps, true);
});

test('media assets reject public URLs and accept storage keys', () => {
  assert.throws(
    () =>
      new MediaAsset({
        patientId: new mongoose.Types.ObjectId(),
        screeningSessionId: new mongoose.Types.ObjectId(),
        uploadedBy: new mongoose.Types.ObjectId(),
        storageKey: 'synthetic/image.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 100,
        publicUrl: 'https://example.test/image.jpg',
      }),
    /publicUrl/,
  );
});

test('media assets accept each guided oral photo angle and track deletion', () => {
  const media = new MediaAsset({
    patientId: new mongoose.Types.ObjectId(),
    screeningSessionId: new mongoose.Types.ObjectId(),
    uploadedBy: new mongoose.Types.ObjectId(),
    region: 'tongue_underside',
    storageKey: 'patients/private/screenings/tongue_underside/image.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 900_000,
    imageQuality: 'inadequate',
    qualityReasons: ['blur', 'too_dark'],
    deletedAt: new Date(),
  });
  assert.equal(media.validateSync(), undefined);
  assert.equal(media.imageQuality, 'inadequate');
  assert.deepEqual(media.qualityReasons, ['blur', 'too_dark']);
});

test('appointment and doctor indexes enforce hospital and booking constraints', () => {
  const activeAppointmentIndex = Appointment.schema
    .indexes()
    .find(([keys]) => keys.doctorId === 1 && keys.slotStart === 1);
  assert.equal(activeAppointmentIndex?.[1].unique, true);
  assert.deepEqual(activeAppointmentIndex?.[1].partialFilterExpression, {
    status: { $in: ['requested', 'accepted', 'confirmed'] },
  });
  assert.ok(Appointment.schema.path('consultationMode'));
  assert.ok(Appointment.schema.path('paymentOption'));
  assert.ok(Appointment.schema.path('feeAmount'));
  assert.ok(Appointment.schema.path('checkedInAt'));
  assert.ok(DoctorProfile.schema.indexes().some(([keys]) => keys.hospitalId === 1));
  assert.ok(Appointment.schema.path('emergencyRequestedAt'));
  assert.ok(Hospital.schema.path('workingHours'));
  assert.ok(
    HospitalManager.schema
      .indexes()
      .some(
        ([keys, options]) =>
          keys.managerId === 1 &&
          options.unique === true &&
          options.partialFilterExpression?.active === true,
      ),
  );
  assert.ok(DoctorProfile.schema.path('experienceYears'));
  assert.ok(DoctorProfile.schema.path('photoStorageKey'));
});

test('note versions are uniquely indexed and hospital scope cannot be overridden', () => {
  assert.ok(
    ConsultationNote.schema
      .indexes()
      .some(
        ([keys, options]) =>
          keys.consultationId === 1 &&
          keys.noteKey === 1 &&
          keys.version === 1 &&
          options.unique === true,
      ),
  );

  const hospitalId = new mongoose.Types.ObjectId();
  const anotherHospitalId = new mongoose.Types.ObjectId();
  const filter = hospitalScopedFilter(hospitalId, {
    hospitalId: anotherHospitalId,
    status: 'active',
  });

  assert.equal(filter.hospitalId.toString(), hospitalId.toString());
  assert.equal(filter.status, 'active');
  assert.throws(() => hospitalScopedFilter('invalid'), /valid hospitalId/);
});

test('audit log records are configured as append-only', () => {
  assert.equal(AuditLog.schema.options.timestamps, true);
  assert.ok(AuditLog.schema.path('occurredAt'));
  assert.equal(AuditLog.schema.path('isSynthetic').defaultValue, false);
  assert.ok(AuditLog.schema.path('severity'));
  assert.ok(BreakGlassAccess.schema.path('expiresAt'));
  assert.ok(GovernanceRequest.schema.path('reviewedBy'));
  assert.ok(
    SecurityAlert.schema.indexes().some(([, options]) => options.expireAfterSeconds === 7776000),
  );
  assert.ok(
    SyncOperation.schema
      .indexes()
      .some(([keys, options]) => keys.clientOpId === 1 && options.unique === true),
  );
  assert.ok(
    mongoose.models.Notification.schema
      .indexes()
      .some(
        ([keys, options]) =>
          keys.type === 1 &&
          keys.resourceId === 1 &&
          options.unique === true &&
          options.partialFilterExpression?.type === 'investigation_escalation',
      ),
  );
  for (const role of ['health_worker', 'navigator', 'district_officer']) {
    assert.equal(mongoose.models.Session.schema.path('role').enumValues.includes(role), true);
  }
});

test('AI reports, consultation notes, and audit logs block mutation queries', async () => {
  await assert.rejects(
    AiReport.updateOne({}, { $set: { riskCategory: 'low' } }).exec(),
    /AiReport records are immutable/,
  );
  await assert.rejects(
    ConsultationNote.updateOne({}, { $set: { body: 'replacement' } }).exec(),
    /Consultation notes are versioned/,
  );
  await assert.rejects(AuditLog.deleteMany({}).exec(), /AuditLog records are immutable/);
});
