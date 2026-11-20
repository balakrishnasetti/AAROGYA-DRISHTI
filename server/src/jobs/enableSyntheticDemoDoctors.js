import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { assertLocalDemoSeedEnvironment } from '../config/demoMode.js';
import { loadEnv } from '../config/env.js';
import { DoctorProfile, Hospital, Session, User } from '../models/index.js';

const staffIds = Array.from(
  { length: 5 },
  (_, index) => `SYN-ASR-DENTIST-${String(index + 1).padStart(2, '0')}`,
);

function temporaryPassword() {
  return `${randomBytes(24).toString('base64url')}aA1!`;
}

export async function enableSyntheticDemoDoctors(environment = loadEnv()) {
  assertLocalDemoSeedEnvironment(environment);

  const doctors = [];
  for (const staffId of staffIds) {
    const user = await User.findOne({
      staffId,
      role: 'doctor',
      status: 'active',
      isSynthetic: true,
    }).select('_id staffId email isSynthetic');
    const profile = user
      ? await DoctorProfile.findOne({ userId: user._id, isSynthetic: true })
      : null;
    const hospital = profile
      ? await Hospital.findOne({
          _id: profile.hospitalId,
          status: 'active',
          isSynthetic: true,
        }).select('_id status isSynthetic')
      : null;

    if (!user || !profile || !hospital || profile.verificationStatus !== 'pending') {
      throw new Error(
        `Expected active pending synthetic doctor, profile, and hospital for ${staffId}. No doctor setup was changed.`,
      );
    }
    doctors.push({ user, profile });
  }

  const credentials = [];
  for (const { user, profile } of doctors) {
    if (profile.demoLoginEnabled) continue;
    const password = temporaryPassword();
    const passwordHash = await bcrypt.hash(password, 12);
    const updatedUser = await User.updateOne(
      { _id: user._id, role: 'doctor', status: 'active', isSynthetic: true },
      {
        $set: {
          passwordHash,
          mustChangePassword: true,
          failedLoginAttempts: 0,
        },
        $unset: { lockedUntil: '' },
      },
    );
    if (updatedUser.matchedCount !== 1) {
      throw new Error(`Could not issue a temporary password to ${user.staffId}.`);
    }

    profile.demoLoginEnabled = true;
    await profile.save();
    await Session.updateMany(
      { userId: user._id, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    credentials.push({ staffId: user.staffId, email: user.email, password });
  }

  return credentials;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const environment = loadEnv();
    assertLocalDemoSeedEnvironment(environment);
    await connectDatabase(environment.MONGO_URI);
    const credentials = await enableSyntheticDemoDoctors(environment);
    console.info(
      'Synthetic demo doctor credentials (save now; passwords are shown only once):',
      JSON.stringify(credentials, null, 2),
    );
    console.info(
      'These profiles remain pending professional verification and only allow local demo access while SEED_DEMO=true.',
    );
  } catch (error) {
    console.error(`Synthetic demo doctor setup failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
