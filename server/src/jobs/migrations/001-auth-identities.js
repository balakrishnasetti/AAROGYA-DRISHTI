import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDatabase } from '../../config/database.js';
import { loadEnv } from '../../config/env.js';
import { AuthIdentity, User } from '../../models/index.js';
import { identityProviderUserId } from '../../services/authIdentityService.js';

export const migrationId = '001-auth-identities';

export async function up(environment = loadEnv()) {
  await AuthIdentity.createIndexes();
  const cursor = User.find({})
    .select('_id staffId email phone')
    .lean()
    .cursor();
  let migrated = 0;

  for await (const user of cursor) {
    const identities = [
      user.staffId && { identityType: 'staff_id', value: user.staffId },
      user.email && { identityType: 'email', value: user.email },
      user.phone && { identityType: 'phone', value: user.phone },
    ].filter(Boolean);

    for (const identity of identities) {
      const providerUserId = identityProviderUserId(
        'manual',
        identity.identityType,
        identity.value,
        environment,
      );
      await AuthIdentity.updateOne(
        { provider: 'manual', providerUserId },
        {
          $setOnInsert: {
            userId: user._id,
            provider: 'manual',
            identityType: identity.identityType,
            providerUserId,
            migrationId,
          },
        },
        { upsert: true },
      );
      migrated += 1;
    }
  }

  return { identitiesProcessed: migrated };
}

export async function down() {
  const result = await AuthIdentity.deleteMany({ migrationId });
  return { identitiesRemoved: result.deletedCount };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const direction = process.argv[2] ?? 'up';
  try {
    const environment = loadEnv();
    await connectDatabase(environment.MONGO_URI);
    const result =
      direction === 'up'
        ? await up(environment)
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
