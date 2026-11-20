import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDatabase } from '../config/database.js';
import { assertDemoSeedEnabled } from '../config/demoMode.js';
import { loadEnv } from '../config/env.js';
import {
  AiReport,
  Appointment,
  CareAssignment,
  Consultation,
  ConsultationNote,
  Consent,
  DoctorProfile,
  FollowUp,
  Hospital,
  HospitalManager,
  MediaAsset,
  Notification,
  OtpRequest,
  Patient,
  PasswordResetToken,
  QuestionnaireResponse,
  Referral,
  ScreeningSession,
  Session,
  SyncOperation,
  TimeSlot,
  User,
  AiChatSession,
  FieldRegistration,
  Investigation,
  NavigatorActivity,
} from '../models/index.js';

const syntheticModels = [
  AiReport,
  Appointment,
  CareAssignment,
  Consultation,
  ConsultationNote,
  Consent,
  DoctorProfile,
  FollowUp,
  Hospital,
  HospitalManager,
  MediaAsset,
  Notification,
  OtpRequest,
  Patient,
  PasswordResetToken,
  QuestionnaireResponse,
  Referral,
  ScreeningSession,
  Session,
  SyncOperation,
  TimeSlot,
  User,
  AiChatSession,
  FieldRegistration,
  Investigation,
  NavigatorActivity,
];

const hospitalsData = [
  {
    name: 'Sanjeevani Community Hospital',
    code: 'SYN-HYD-01',
    address: 'Synthetic Campus 1, Community Road',
    city: 'Hyderabad',
    state: 'Telangana',
    postalCode: '500001',
    contactEmail: 'contact@sanjeevani.synthetic.test',
  },
  {
    name: 'Aarogya District Hospital',
    code: 'SYN-WGL-02',
    address: 'Synthetic Campus 2, District Road',
    city: 'Warangal',
    state: 'Telangana',
    postalCode: '506001',
    contactEmail: 'contact@aarogya.synthetic.test',
  },
];

const givenNames = [
  'Aarav',
  'Anaya',
  'Dev',
  'Diya',
  'Ishaan',
  'Kavya',
  'Mira',
  'Neel',
  'Rohan',
  'Sana',
  'Tara',
  'Vihaan',
  'Aditi',
  'Kabir',
  'Leela',
  'Nikhil',
  'Priya',
  'Reyansh',
  'Saira',
  'Yash',
];

function assertSafeEnvironment(environment) {
  assertDemoSeedEnabled(environment);
  if (/production|prod-clinical/i.test(environment.MONGO_URI)) {
    throw new Error('Synthetic seed/reset requires a non-production MongoDB URI.');
  }
  if (!environment.SEED_STAFF_PASSWORD) {
    throw new Error(
      'Set SEED_STAFF_PASSWORD in server environment before creating synthetic staff accounts.',
    );
  }
}

export async function connectForSyntheticData() {
  const environment = loadEnv();
  assertSafeEnvironment(environment);
  await connectDatabase(environment.MONGO_URI);
  return environment;
}

async function clearSyntheticData() {
  for (const model of syntheticModels) {
    await model.deleteMany({ isSynthetic: true });
  }
}

async function hasSyntheticData() {
  const counts = await Promise.all(
    syntheticModels.map((model) => model.exists({ isSynthetic: true })),
  );
  return counts.some(Boolean);
}

async function createSyntheticData(environment) {
  const hashPassword = () => bcrypt.hash(environment.SEED_STAFF_PASSWORD, 12);
  const admin = await User.create({
    fullName: 'Synthetic Platform Administrator',
    staffId: 'SYN-ADMIN-001',
    email: 'admin@aarogya.synthetic.test',
    role: 'admin',
    status: 'active',
    passwordHash: await hashPassword(),
    mustChangePassword: true,
    isSynthetic: true,
  });

  const hospitals = await Hospital.create(
    hospitalsData.map((hospital) => ({ ...hospital, isSynthetic: true })),
  );
  const managers = await User.create(
    await Promise.all(
      hospitals.map(async (hospital, index) => ({
        fullName: `Synthetic Hospital Manager ${index + 1}`,
        staffId: `SYN-MANAGER-${String(index + 1).padStart(2, '0')}`,
        email: `manager${index + 1}@aarogya.synthetic.test`,
        role: 'hospital_manager',
        status: 'active',
        passwordHash: await hashPassword(),
        mustChangePassword: true,
        isSynthetic: true,
      })),
    ),
  );
  await HospitalManager.create(
    hospitals.map((hospital, index) => ({
      hospitalId: hospital._id,
      managerId: managers[index]._id,
      assignedBy: admin._id,
      active: true,
      isSynthetic: true,
    })),
  );

  const doctors = await User.create(
    await Promise.all(
      Array.from({ length: 6 }, async (_, index) => ({
        fullName: `Synthetic Doctor ${index + 1}`,
        staffId: `SYN-DOCTOR-${String(index + 1).padStart(2, '0')}`,
        email: `doctor${index + 1}@aarogya.synthetic.test`,
        role: 'doctor',
        status: 'active',
        passwordHash: await hashPassword(),
        mustChangePassword: true,
        isSynthetic: true,
      })),
    ),
  );
  await DoctorProfile.create(
    doctors.map((doctor, index) => {
      const hospital = hospitals[index % hospitals.length];
      return {
        userId: doctor._id,
        hospitalId: hospital._id,
        qualification: 'Synthetic BDS',
        registrationNumber: `SYNTH-DOC-${String(index + 1).padStart(3, '0')}`,
        specialty: 'General Dentistry',
        languages: ['te', 'en'],
        documents: [
          {
            storageKey: `synthetic/doctor-documents/doctor-${index + 1}/registration.pdf`,
            contentType: 'application/pdf',
            sizeBytes: 1024,
            documentType: 'registration',
            uploadedAt: new Date(),
            verificationStatus: 'verified',
            reviewerId: admin._id,
            reviewedAt: new Date(),
            isSynthetic: true,
          },
        ],
        verificationStatus: 'verified',
        verifiedBy: admin._id,
        verifiedAt: new Date(),
        isSynthetic: true,
      };
    }),
  );

  const fieldStaff = await User.create(
    await Promise.all(
      [
        {
          fullName: 'Synthetic Health Worker',
          staffId: 'SYN-HEALTH-WORKER-01',
          email: 'health-worker@aarogya.synthetic.test',
          role: 'health_worker',
          district: 'Hyderabad',
          mandal: 'Synthetic Mandal',
          phc: 'Synthetic PHC',
        },
        {
          fullName: 'Synthetic Navigator',
          staffId: 'SYN-NAVIGATOR-01',
          email: 'navigator@aarogya.synthetic.test',
          role: 'navigator',
          district: 'Hyderabad',
          mandal: 'Synthetic Mandal',
          phc: 'Synthetic PHC',
        },
        {
          fullName: 'Synthetic District Officer',
          staffId: 'SYN-DISTRICT-OFFICER-01',
          email: 'district-officer@aarogya.synthetic.test',
          role: 'district_officer',
          district: 'Hyderabad',
        },
      ].map(async (staff) => ({
        ...staff,
        status: 'active',
        passwordHash: await hashPassword(),
        mustChangePassword: true,
        isSynthetic: true,
      })),
    ),
  );

  const patients = await User.create(
    givenNames.map((name, index) => ({
      fullName: `Synthetic ${name} Patient ${index + 1}`,
      email: `patient${String(index + 1).padStart(2, '0')}@aarogya.synthetic.test`,
      phone: `+9100000${String(index + 1).padStart(5, '0')}`,
      role: 'patient',
      status: 'active',
      isSynthetic: true,
    })),
  );
  const patientProfiles = await Patient.create(
    patients.map((user, index) => ({
      userId: user._id,
      dateOfBirth: new Date(Date.UTC(1980 + (index % 20), (index * 3) % 12, 10 + (index % 18))),
      sexAtBirth: ['female', 'male', 'undisclosed'][index % 3],
      district: ['Hyderabad', 'Warangal', 'Nalgonda', 'Karimnagar'][index % 4],
      preferredLanguage: index % 2 === 0 ? 'te' : 'en',
      isSynthetic: true,
    })),
  );

  for (let index = 0; index < 6; index += 1) {
    const patient = patientProfiles[index];
    const hospital = hospitals[index % hospitals.length];
    const consent = await Consent.create({
      patientId: patient._id,
      consentType: 'screening',
      consentVersion: 'synthetic-v1',
      textVersion: 'synthetic-consent-v1',
      language: index % 2 === 0 ? 'te' : 'en',
      granted: true,
      recordedAt: new Date(),
      recordedBy: patients[index]._id,
      isSynthetic: true,
    });
    const screening = await ScreeningSession.create({
      patientId: patient._id,
      hospitalId: hospital._id,
      createdBy: managers[index % managers.length]._id,
      consentId: consent._id,
      status: 'completed',
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
      completedAt: new Date(),
      isSynthetic: true,
    });
    consent.screeningSessionId = screening._id;
    await consent.save();

    await QuestionnaireResponse.create({
      screeningSessionId: screening._id,
      patientId: patient._id,
      questionnaireVersion: 'synthetic-v1',
      answers: [
        { questionKey: 'synthetic_duration', answer: ['recent', 'ongoing', 'unsure'][index % 3] },
        { questionKey: 'synthetic_discomfort', answer: index % 2 === 0 },
      ],
      completedAt: new Date(),
      isSynthetic: true,
    });

    const media = await MediaAsset.create({
      patientId: patient._id,
      screeningSessionId: screening._id,
      uploadedBy: managers[index % managers.length]._id,
      region: 'tongue',
      storageKey: `synthetic/screenings/${screening._id}/image-${index + 1}.jpg`,
      contentType: 'image/jpeg',
      sizeBytes: 120000 + index * 1000,
      checksum: `synthetic-checksum-${String(index + 1).padStart(3, '0')}`,
      capturedAt: new Date(),
      isSynthetic: true,
    });
    await AiReport.create({
      patientId: patient._id,
      screeningSessionId: screening._id,
      mediaAssetId: media._id,
      modelName: 'synthetic-demo-model',
      modelVersion: '0.0-synthetic',
      imageQuality: index === 5 ? 'uncertain' : 'adequate',
      observations: ['Synthetic example observation; not a clinical finding.'],
      region: 'unspecified',
      riskCategory: ['low', 'moderate', 'high', 'urgent_evaluation'][index % 4],
      explanation:
        'Synthetic demonstration output only; this is not a diagnosis or clinical assessment.',
      recommendedNextSteps: ['Discuss concerns with a qualified healthcare professional.'],
      limitations: [
        'Synthetic data',
        'Not evaluated for clinical use',
        'Image interpretation may be unreliable',
      ],
      notForClinicalUse: true,
      generatedAt: new Date(),
      isSynthetic: true,
    });
  }

  return {
    hospitals: hospitals.length,
    hospitalManagers: managers.length,
    doctors: doctors.length,
    patients: patientProfiles.length,
    fieldStaff: fieldStaff.length,
    screenings: 6,
  };
}

export async function seedSyntheticData({ reset = false, environment } = {}) {
  assertSafeEnvironment(environment);
  if (reset) {
    await clearSyntheticData();
  } else if (await hasSyntheticData()) {
    throw new Error(
      'Synthetic data already exists. Run the reset script to replace synthetic records.',
    );
  }

  return createSyntheticData(environment);
}

export async function closeSyntheticDatabase() {
  await mongoose.disconnect();
}

export const syntheticResetModels = syntheticModels;
