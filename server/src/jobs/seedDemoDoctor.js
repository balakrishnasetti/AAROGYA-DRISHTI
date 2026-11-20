import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDatabase } from '../config/database.js';
import { assertLocalDemoSeedEnvironment } from '../config/demoMode.js';
import { loadEnv } from '../config/env.js';
import { User } from '../models/index.js';

const staffId = 'SYN-DEMO-DOCTOR-001';
const email = 'demo.doctor@aarogya.synthetic.test';

export async function seedDemoDoctor(environment = loadEnv()) {
  assertLocalDemoSeedEnvironment(environment);
  if (!environment.SEED_STAFF_PASSWORD) {
    throw new Error('Set SEED_STAFF_PASSWORD before creating the local demo doctor.');
  }

  const existing = await User.findOne({ $or: [{ staffId }, { email }] }).lean();
  if (existing) {
    if (existing.isSynthetic && existing.role === 'doctor') {
      return { created: false, staffId, email };
    }
    throw new Error('Refusing to overwrite an existing non-synthetic account.');
  }

  await User.create({
    fullName: 'Synthetic Dashboard-Only Doctor',
    staffId,
    email,
    role: 'doctor',
    status: 'active',
    passwordHash: await bcrypt.hash(environment.SEED_STAFF_PASSWORD, 12),
    mustChangePassword: true,
    isSynthetic: true,
  });

  return { created: true, staffId, email };
}

try {
  const environment = loadEnv();
  assertLocalDemoSeedEnvironment(environment);
  await connectDatabase(environment.MONGO_URI);
  const result = await seedDemoDoctor(environment);
  console.info('Local synthetic dashboard-only doctor account:', result);
  console.info('No doctor profile, hospital assignment, patient assignment, or call eligibility was created.');
} catch (error) {
  console.error(`Local demo doctor seeding failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
