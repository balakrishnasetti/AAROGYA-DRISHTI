import { createModel, createTimestampedSchema, objectId } from './shared.js';

const fieldRegistrationSchema = createTimestampedSchema(
  {
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    registeredBy: { type: objectId, ref: 'User', required: true, index: true },
    duplicateHash: { type: String, required: true, select: false, maxlength: 64 },
    clientOpId: { type: String, trim: true, maxlength: 128 },
    village: { type: String, required: true, trim: true, maxlength: 120 },
    mandal: { type: String, required: true, trim: true, maxlength: 120 },
    phc: { type: String, required: true, trim: true, maxlength: 120 },
    district: { type: String, required: true, trim: true, maxlength: 120 },
    encryptedHealthData: { type: String, required: true, select: false, maxlength: 20000 },
    consentIds: { type: [objectId], ref: 'Consent', required: true, default: [] },
    photos: {
      type: [
        {
          view: { type: String, enum: ['front', 'left_cheek', 'right_cheek', 'upper_gums', 'lower_gums'], required: true },
          storageKey: { type: String, required: true, maxlength: 512 },
          contentType: { type: String, enum: ['image/jpeg', 'image/png'], required: true },
          sizeBytes: { type: Number, min: 1, max: 10000000, required: true },
        },
      ],
      default: [],
    },
  },
  { collection: 'field_registrations' },
);
fieldRegistrationSchema.index({ duplicateHash: 1 }, { unique: true });
fieldRegistrationSchema.index({ registeredBy: 1, createdAt: -1 });
fieldRegistrationSchema.index({ district: 1, mandal: 1, phc: 1, village: 1 });
fieldRegistrationSchema.index({ clientOpId: 1 }, { unique: true, sparse: true });
export const FieldRegistration = createModel('FieldRegistration', fieldRegistrationSchema);

const investigationSchema = createTimestampedSchema(
  {
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    referralId: { type: objectId, ref: 'Referral' },
    hospitalId: { type: objectId, ref: 'Hospital' },
    village: { type: String, trim: true, maxlength: 120 },
    mandal: { type: String, trim: true, maxlength: 120 },
    phc: { type: String, trim: true, maxlength: 120 },
    district: { type: String, trim: true, maxlength: 120 },
    state: {
      type: String,
      enum: [
        'advised',
        'scheduled',
        'sample_collected',
        'report_pending',
        'report_received',
        'clinician_reviewed',
        'next_action',
      ],
      default: 'advised',
      required: true,
    },
    classification: { type: String, trim: true, maxlength: 120 },
    classificationSetBy: { type: objectId, ref: 'User' },
    classificationSetAt: Date,
    nextAction: { type: String, trim: true, maxlength: 1000 },
    dueAt: Date,
    escalatedAt: Date,
    createdBy: { type: objectId, ref: 'User', required: true },
  },
  { collection: 'investigations' },
);
investigationSchema.index({ state: 1, dueAt: 1, escalatedAt: 1 });
investigationSchema.index({ patientId: 1, createdAt: -1 });
export const Investigation = createModel('Investigation', investigationSchema);

const navigatorActivitySchema = createTimestampedSchema(
  {
    patientId: { type: objectId, ref: 'Patient', required: true, index: true },
    referralId: { type: objectId, ref: 'Referral' },
    investigationId: { type: objectId, ref: 'Investigation' },
    navigatorId: { type: objectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: ['contact_attempt', 'transport_request', 'missed_visit'],
      required: true,
    },
    outcome: { type: String, trim: true, maxlength: 80 },
    encryptedDetails: { type: String, trim: true, maxlength: 8000 },
  },
  { collection: 'navigator_activities' },
);
navigatorActivitySchema.index({ navigatorId:  1, createdAt: -1 });
export const NavigatorActivity = createModel('NavigatorActivity', navigatorActivitySchema);
