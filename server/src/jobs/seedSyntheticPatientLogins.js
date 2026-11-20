import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { assertLocalDemoSeedEnvironment } from '../config/demoMode.js';
import { loadEnv } from '../config/env.js';
import { Patient, User } from '../models/index.js';

const accounts = Array.from({ length: 5 }, (_, index) => ({
  fullName: `Synthetic Demo Patient ${String(index + 1).padStart(2, '0')}`,
  email: `local.patient.demo${String(index + 1).padStart(2, '0')}@example.test`,
}));

export async function seedSyntheticPatientLogins(environment = loadEnv()) {
  assertLocalDemoSeedEnvironment(environment);
  if (!environment.SEED_STAFF_PASSWORD) {
    throw new Error('Set SEED_STAFF_PASSWORD before creating or resetting local demo patients.');
  }
  const passwordHash = await bcrypt.hash(environment.SEED_STAFF_PASSWORD, 12);
  const accountsSeeded = [];

  for (const account of accounts) {
    const existing = await User.findOne({ email: account.email }).select('_id role isSynthetic');
    if (existing) {
      if (existing.role !== 'patient' || existing.isSynthetic !== true) {
        throw new Error(`Refusing to modify a non-synthetic account using ${account.email}.`);
      }
      const updated = await User.updateOne(
        { _id: existing._id, role: 'patient', isSynthetic: true },
        {
          $set: { passwordHash, failedLoginAttempts: 0 },
          $unset: { lockedUntil: 1 },
        },
      );
      if (updated.matchedCount !== 1) {
        throw new Error(`Unable to reset the local demo patient account ${account.email}.`);
      }
      await Patient.updateOne(
        { userId: existing._id },
        { $setOnInsert: { userId: existing._id, preferredLanguage: 'te', isSynthetic: true } },
        { upsert: true },
      );
      accountsSeeded.push(account.email);
      continue;
    }

    const user = await User.create({
      ...account,
      emailVerified: true,
      role: 'patient',
      status: 'active',
      passwordHash,
      mustChangePassword: false,
      isSynthetic: true,
    });
    try {
      await Patient.create({
        userId: user._id,
        preferredLanguage: 'te',
        isSynthetic: true,
      });
    } catch (error) {
      await User.deleteOne({ _id: user._id, role: 'patient', isSynthetic: true });
      throw error;
    }
    accountsSeeded.push(account.email);
  }

  return accountsSeeded;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const environment = loadEnv();
    assertLocalDemoSeedEnvironment(environment);
    await connectDatabase(environment.MONGO_URI);
    const credentials = await seedSyntheticPatientLogins(environment);
    console.info('Local synthetic patient accounts created or reset:', credentials.join(', '));
    console.info('Use the configured SEED_STAFF_PASSWORD to sign in to these fictional accounts.');
  } catch (error) {
    console.error(`Synthetic patient account seeding failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
