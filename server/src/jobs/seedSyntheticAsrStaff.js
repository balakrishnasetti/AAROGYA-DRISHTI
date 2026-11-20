import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDatabase } from '../config/database.js';
import { assertLocalDemoSeedEnvironment } from '../config/demoMode.js';
import { loadEnv } from '../config/env.js';
import { Hospital, HospitalManager, User } from '../models/index.js';
import { seedSyntheticProviders } from './seedSyntheticProviders.js';

const district = 'Alluri Sitarama Raju District';
const staffAccounts = [
  {
    fullName: 'Synthetic ASR Hospital Administrator',
    staffId: 'SYN-ASR-MANAGER-01',
    email: 'asr-manager@aarogya.synthetic.test',
    role: 'hospital_manager',
    mandal: 'Synthetic Mandal 01',
    phc: 'Synthetic Demo Community Dental Center 01',
  },
  {
    fullName: 'Synthetic ASR ASHA Health Worker',
    staffId: 'SYN-ASR-HEALTH-WORKER-01',
    email: 'asr-health-worker@aarogya.synthetic.test',
    role: 'health_worker',
    mandal: 'Synthetic Mandal 01',
    phc: 'Synthetic Demo Primary Health Centre 01',
    assignedVillages: ['Synthetic Demo Village 01', 'Synthetic Demo Village 02'],
  },
  {
    fullName: 'Synthetic ASR Health Assistant',
    staffId: 'SYN-ASR-HEALTH-ASSISTANT-01',
    email: 'asr-health-assistant@aarogya.synthetic.test',
    role: 'navigator',
    mandal: 'Synthetic Mandal 01',
    phc: 'Synthetic Demo Primary Health Centre 01',
    assignedVillages: ['Synthetic Demo Village 01', 'Synthetic Demo Village 02'],
  },
  {
    fullName: 'Synthetic ASR District Administrator',
    staffId: 'SYN-ASR-DISTRICT-ADMIN-01',
    email: 'asr-district-admin@aarogya.synthetic.test',
    role: 'district_officer',
  },
];

async function ensureSyntheticUser(account, passwordHash) {
  const existing = await User.findOne({
    $or: [{ staffId: account.staffId }, { email: account.email }],
  }).select('+passwordHash');

  if (!existing) {
    await User.create({
      ...account,
      district,
      status: 'active',
      passwordHash,
      mustChangePassword: true,
      isSynthetic: true,
    });
    return { created: true, activated: true };
  }

  if (
    !existing.isSynthetic ||
    existing.role !== account.role ||
    existing.staffId !== account.staffId ||
    existing.email !== account.email
  ) {
    throw new Error(`Refusing to modify a non-matching account for ${account.staffId}.`);
  }

  const update = { status: 'active', district };
  if (!existing.passwordHash) {
    update.passwordHash = passwordHash;
    update.mustChangePassword = true;
  }
  if (account.mandal) update.mandal = account.mandal;
  if (account.phc) update.phc = account.phc;
  if (account.assignedVillages) update.assignedVillages = account.assignedVillages;
  await User.updateOne({ _id: existing._id, isSynthetic: true }, { $set: update });
  return { created: false, activated: existing.status !== 'active' };
}

export async function seedSyntheticAsrStaff(environment = loadEnv()) {
  assertLocalDemoSeedEnvironment(environment);
  if (!environment.SEED_STAFF_PASSWORD) {
    throw new Error('Set SEED_STAFF_PASSWORD in server/.env before creating demo staff accounts.');
  }

  await seedSyntheticProviders(environment);
  const passwordHash = await bcrypt.hash(environment.SEED_STAFF_PASSWORD, 12);
  const results = [];
  for (const account of staffAccounts) {
    results.push({
      staffId: account.staffId,
      ...(await ensureSyntheticUser(account, passwordHash)),
    });
  }

  const manager = await User.findOne({
    staffId: 'SYN-ASR-MANAGER-01',
    role: 'hospital_manager',
    isSynthetic: true,
  }).select('_id');
  const hospital = await Hospital.findOne({
    code: 'SYN-ASR-HOSP-01',
    district,
    isSynthetic: true,
    status: 'active',
  }).select('_id');
  if (!manager || !hospital) {
    throw new Error('The ASR synthetic manager or hospital could not be found.');
  }

  const existingAssignment = await HospitalManager.findOne({
    managerId: manager._id,
    active: true,
  });
  if (
    existingAssignment &&
    (!existingAssignment.isSynthetic || !existingAssignment.hospitalId.equals(hospital._id))
  ) {
    throw new Error('The synthetic ASR manager is already assigned to another hospital.');
  }
  const matchingAssignment = await HospitalManager.findOne({
    hospitalId: hospital._id,
    managerId: manager._id,
  });
  if (matchingAssignment && !matchingAssignment.isSynthetic) {
    throw new Error('Refusing to modify a non-synthetic hospital manager assignment.');
  }
  if (matchingAssignment && !matchingAssignment.active) {
    await HospitalManager.updateOne(
      { _id: matchingAssignment._id, isSynthetic: true },
      { $set: { active: true } },
    );
  } else if (!matchingAssignment) {
    await HospitalManager.create({
      hospitalId: hospital._id,
      managerId: manager._id,
      active: true,
      isSynthetic: true,
    });
  }

  const activatedDoctors = await User.updateMany(
    {
      staffId: /^SYN-ASR-DENTIST-\d{2}$/,
      role: 'doctor',
      isSynthetic: true,
      status: 'pending',
    },
    {
      $set: {
        status: 'active',
        passwordHash,
        mustChangePassword: true,
        district,
      },
    },
  );

  return {
    district,
    staff: results,
    hospitalManagerAssignments: existingAssignment ? 0 : 1,
    doctorsActivated: activatedDoctors.modifiedCount,
  };
}

try {
  const environment = loadEnv();
  assertLocalDemoSeedEnvironment(environment);
  await connectDatabase(environment.MONGO_URI);
  console.info('Synthetic ASR staff seed result:', await seedSyntheticAsrStaff(environment));
} catch (error) {
  console.error(`Synthetic ASR staff seeding failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
