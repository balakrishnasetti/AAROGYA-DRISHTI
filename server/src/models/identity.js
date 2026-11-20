import mongoose from 'mongoose';
import { createModel, createTimestampedSchema, objectId } from './shared.js';
import { careJourneySchema } from './careJourney.js';

const userSchema = createTimestampedSchema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    emailVerified: { type: Boolean, default: false, required: true },
    phone: { type: String, trim: true, maxlength: 20 },
    staffId: { type: String, trim: true, uppercase: true, maxlength: 40 },
    district: { type: String, trim: true, maxlength: 120 },
    mandal: { type: String, trim: true, maxlength: 120 },
    phc: { type: String, trim: true, maxlength: 120 },
    assignedVillages: {
      type: [{ type: String, trim: true, maxlength: 120 }],
      default: [],
    },
    role: {
      type: String,
      enum: [
        'admin',
        'hospital_manager',
        'doctor',
        'specialist',
        'patient',
        'health_worker',
        'navigator',
        'district_officer',
      ],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'pending', 'suspended', 'disabled'],
      default: 'pending',
      required: true,
    },
    passwordHash: { type: String, select: false, minlength: 20 },
    mustChangePassword: { type: Boolean, default: false, required: true },
    failedLoginAttempts: { type: Number, default: 0, min: 0, max: 5, required: true },
    lockedUntil: Date,
    lastLoginAt: Date,
  },
  { collection: 'users' },
);
userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
);
userSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: 'string' } } },
);
userSchema.index(
  { staffId: 1 },
  { unique: true, partialFilterExpression: { staffId: { $type: 'string' } } },
);
export const User = createModel('User', userSchema);

const authIdentitySchema = createTimestampedSchema(
  {
    userId: { type: objectId, ref: 'User', required: true, index: true },
    provider: {
      type: String,
      enum: ['manual', 'mobile_otp', 'abha', 'aadhaar_qr'],
      required: true,
    },
    identityType: {
      type: String,
      enum: ['staff_id', 'email', 'phone', 'provider_subject'],
      required: true,
    },
    providerUserId: { type: String, required: true, select: false, minlength: 64, maxlength: 64 },
    verifiedAt: Date,
    migrationId: { type: String, trim: true, maxlength: 80 },
  },
  { collection: 'auth_identities' },
);
authIdentitySchema.index({ provider: 1, providerUserId: 1 }, { unique: true });
authIdentitySchema.index({ userId: 1, provider: 1, createdAt: -1 });
export const AuthIdentity = createModel('AuthIdentity', authIdentitySchema);

const hospitalSchema = createTimestampedSchema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 32 },
    facilityType: {
      type: String,
      enum: ['hospital', 'phc'],
      default: 'hospital',
      required: true,
      index: true,
    },
    centerType: {
      type: String,
      enum: ['hospital', 'phc', 'cancer_center', 'dental_center'],
      default: 'hospital',
      required: true,
      index: true,
    },
    ownership: {
      type: String,
      enum: ['government', 'private', 'unknown'],
      default: 'unknown',
      required: true,
      index: true,
    },
    specialties: { type: [String], default: [] },
    rating: { type: Number, min: 0, max: 5 },
    registrationInfo: { type: String, trim: true, maxlength: 300 },
    address: { type: String, trim: true, maxlength: 300 },
    city: { type: String, trim: true, maxlength: 100 },
    state: { type: String, required: true, trim: true, maxlength: 100 },
    postalCode: { type: String, trim: true, maxlength: 16 },
    district: { type: String, trim: true, maxlength: 120 },
    mandal: { type: String, trim: true, maxlength: 120 },
    village: { type: String, trim: true, maxlength: 120 },
    contactEmail: { type: String, trim: true, lowercase: true, maxlength: 254 },
    contactPhone: { type: String, trim: true, maxlength: 20 },
    coordinates: {
      latitude: { type: Number, min: -90, max: 90 },
      longitude: { type: Number, min: -180, max: 180 },
    },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], index: '2dsphere' },
    },
    facilities: { type: [String], default: [] },
    services: { type: [String], default: [] },
    importSource: {
      sourceFile: { type: String, trim: true, maxlength: 160 },
      sheetName: { type: String, trim: true, maxlength: 80 },
      rowNumber: { type: Number, min: 1 },
      originalFacilityName: { type: String, trim: true, maxlength: 200 },
      canonicalFacilityName: { type: String, trim: true, maxlength: 200 },
    },
    workingHours: {
      type: [
        new mongoose.Schema(
          {
            day: {
              type: String,
              enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
              required: true,
            },
            opensAt: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
            closesAt: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
            closed: { type: Boolean, default: false },
          },
          { _id: false, strict: 'throw' },
        ),
      ],
      default: [],
    },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', required: true },
  },
  { collection: 'hospitals' },
);
hospitalSchema.index({ code: 1 }, { unique: true });
export const Hospital = createModel('Hospital', hospitalSchema);

const hospitalManagerSchema = createTimestampedSchema(
  {
    hospitalId: { type: objectId, ref: 'Hospital', required: true, index: true },
    managerId: { type: objectId, ref: 'User', required: true },
    assignedBy: { type: objectId, ref: 'User' },
    active: { type: Boolean, default: true, required: true },
  },
  { collection: 'hospital_managers' },
);
hospitalManagerSchema.index({ hospitalId: 1, managerId: 1 }, { unique: true });
hospitalManagerSchema.index(
  { managerId: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);
export const HospitalManager = createModel('HospitalManager', hospitalManagerSchema);

const doctorDocumentSchema = new mongoose.Schema(
  {
    storageKey: { type: String, required: true, trim: true, maxlength: 512 },
    contentType: {
      type: String,
      enum: ['application/pdf', 'image/jpeg', 'image/png'],
      required: true,
    },
    sizeBytes: { type: Number, required: true, min: 1, max: 10485760 },
    documentType: {
      type: String,
      enum: ['identity', 'registration', 'qualification', 'other'],
      required: true,
    },
    uploadedAt: { type: Date, required: true },
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending',
      required: true,
    },
    reviewerId: { type: objectId, ref: 'User' },
    reviewedAt: Date,
    isSynthetic: { type: Boolean, default: false, required: true },
  },
  { _id: true, strict: 'throw' },
);

const doctorProfileSchema = createTimestampedSchema(
  {
    userId: { type: objectId, ref: 'User', required: true },
    hospitalId: { type: objectId, ref: 'Hospital', required: true },
    qualification: { type: String, required: true, trim: true, maxlength: 160 },
    registrationNumber: { type: String, required: true, trim: true, maxlength: 100 },
    specialty: { type: String, trim: true, maxlength: 120 },
    experienceYears: { type: Number, min: 0, max: 80, default: 0 },
    previousWork: { type: [String], default: [] },
    achievements: { type: [String], default: [] },
    expertise: { type: [String], default: [] },
    consultationFee: { type: Number, min: 0, default: 0 },
    availability: {
      type: [
        new mongoose.Schema(
          {
            day: {
              type: String,
              enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
              required: true,
            },
            startsAt: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, required: true },
            endsAt: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, required: true },
          },
          { _id: false, strict: 'throw' },
        ),
      ],
      default: [],
    },
    photoStorageKey: { type: String, trim: true, maxlength: 512 },
    photoContentType: { type: String, enum: ['image/jpeg', 'image/png'] },
    languages: { type: [String], default: [] },
    documents: { type: [doctorDocumentSchema], default: [] },
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending',
      required: true,
      index: true,
    },
    verifiedBy: { type: objectId, ref: 'User' },
    verifiedAt: Date,
    demoLoginEnabled: { type: Boolean, default: false, required: true },
  },
  { collection: 'doctor_profiles' },
);
doctorProfileSchema.index({ userId: 1 }, { unique: true });
doctorProfileSchema.index({ hospitalId: 1, verificationStatus: 1 });
doctorProfileSchema.index({ hospitalId: 1, registrationNumber: 1 }, { unique: true });
export const DoctorProfile = createModel('DoctorProfile', doctorProfileSchema);

const patientSchema = createTimestampedSchema(
  {
    userId: { type: objectId, ref: 'User', required: true },
    careJourney: { type: careJourneySchema, default: () => ({}) },
    dateOfBirth: { type: String, trim: true, maxlength: 200 },
    yearOfBirth: { type: String, match: /^\d{4}$/ },
    sexAtBirth: { type: String, trim: true, maxlength: 200, default: 'undisclosed' },
    district: { type: String, trim: true, maxlength: 512 },
    village: { type: String, trim: true, maxlength: 120 },
    mandal: { type: String, trim: true, maxlength: 120 },
    phc: { type: String, trim: true, maxlength: 120 },
    preferredLanguage: { type: String, enum: ['en', 'te'], default: 'te', required: true },
    active: { type: Boolean, default: true, required: true },
  },
  { collection: 'patients' },
);
patientSchema.index({ userId: 1 }, { unique: true });
export const Patient = createModel('Patient', patientSchema);
