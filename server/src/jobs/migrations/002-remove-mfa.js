import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDatabase } from '../../config/database.js';
import { loadEnv } from '../../config/env.js';
import { User } from '../../models/index.js';

export const migrationId = '002-remove-mfa';

const legacyMfaFields = [
  'totpSecretEncrypted',
  'totpEnabled',
  'totpBackupCodeHashes',
  'totpLastUsedAt',
  'totpLastUsedStep',
];

export async function up() {
  const result = await User.collection.updateMany(
    { $or: legacyMfaFields.map((field) => ({ [field]: { $exists: true } })) },
    { $unset: Object.fromEntries(legacyMfaFields.map((field) => [field, ''])) },
  );
  return { usersMatched: result.matchedCount, usersModified: result.modifiedCount };
}

export async function down() {
  throw new Error('This migration removes obsolete MFA credentials and cannot be reversed.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const direction = process.argv[2] ?? 'up';
  try {
    const environment = loadEnv();
    await connectDatabase(environment.MONGO_URI);
    const result =
      direction === 'up'
        ? await up()
        : direction === 'down'
          ? await down()
          : (() => {
              throw new Error('Migration direction must be "up" or "down".');
            })();
    console.info(`${migrationId} ${direction} complete:`, result);
  } catch (error) {
    console.error(`${migrationId} ${direction} failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
