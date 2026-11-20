import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDatabase } from '../config/database.js';
import { assertDemoSeedEnabled } from '../config/demoMode.js';
import { loadEnv } from '../config/env.js';
import { User } from '../models/index.js';

function assertSafeEnvironment(environment) {
  assertDemoSeedEnabled(environment);
  const uri = new URL(environment.MONGO_URI);
  if (!['localhost', '127.0.0.1', '::1'].includes(uri.hostname)) {
    throw new Error('Synthetic administrator seeding only runs against a local MongoDB database.');
  }
  if (!environment.SEED_STAFF_PASSWORD) {
    throw new Error('Set SEED_STAFF_PASSWORD in server/.env before creating the administrator.');
  }
}

export async function seedSyntheticAdmin(environment = loadEnv()) {
  assertSafeEnvironment(environment);

  let identity;
  for (let sequence = 1; sequence <= 999; sequence += 1) {
    const suffix = String(sequence).padStart(3, '0');
    const staffId = `SYN-ADMIN-${suffix}`;
    const email = sequence === 1
      ? 'admin@aarogya.synthetic.test'
      : `admin${sequence}@aarogya.synthetic.test`;
    const matchingIdentity = await User.findOne({
      $or: [{ staffId }, { email }],
    }).lean();
    if (!matchingIdentity) {
      identity = { staffId, email };
      break;
    }
    if (matchingIdentity.isSynthetic && matchingIdentity.role === 'admin') {
      return {
        created: false,
        reason: 'synthetic administrator already exists',
        staffId: matchingIdentity.staffId,
      };
    }
  }

  if (!identity) throw new Error('No unused synthetic administrator identity is available.');

  if (await User.exists({ role: 'admin' })) {
    return { created: false, reason: 'an administrator already exists' };
  }

  await User.create({
    fullName: 'Synthetic Platform Administrator',
    ...identity,
    role: 'admin',
    status: 'active',
    passwordHash: await bcrypt.hash(environment.SEED_STAFF_PASSWORD, 12),
    mustChangePassword: true,
    isSynthetic: true,
  });
  return { created: true, staffId: identity.staffId };
}

try {
  const environment = loadEnv();
  assertSafeEnvironment(environment);
  await connectDatabase(environment.MONGO_URI);
  console.info('Synthetic administrator seed result:', await seedSyntheticAdmin(environment));
} catch (error) {
  console.error(`Synthetic administrator seeding failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
