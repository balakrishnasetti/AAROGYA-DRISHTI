import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDatabase } from '../../config/database.js';
import { loadEnv } from '../../config/env.js';
import { ClinicianReviewTask, FollowUp, Patient, ScreeningSession } from '../../models/index.js';
import { inferLegacyCareJourneyStage } from '../../services/patientJourneyService.js';

export const migrationId = '003-care-journey';
const BATCH_SIZE = 200;

async function groupedStatuses(model, patientIds, match = {}) {
  const rows = await model.aggregate([
    { $match: { patientId: { $in: patientIds }, ...match } },
    { $group: { _id: '$patientId', statuses: { $addToSet: '$status' } } },
  ]);
  return new Map(rows.map((row) => [row._id.toString(), row.statuses]));
}

export async function up() {
  let modifiedCount = 0;
  const cursor = Patient.find({ 'careJourney.stage': { $exists: false } })
    .select('_id')
    .lean()
    .cursor({ batchSize: BATCH_SIZE });
  let batch = [];

  async function migrateBatch(patients) {
    if (!patients.length) return;
    const patientIds = patients.map((patient) => patient._id);
    const [followUpStatuses, reviewStatuses, completedScreenings] = await Promise.all([
      groupedStatuses(FollowUp, patientIds),
      groupedStatuses(ClinicianReviewTask, patientIds, { status: { $in: ['in_review', 'completed'] } }),
      ScreeningSession.distinct('patientId', {
        patientId: { $in: patientIds },
        status: 'completed',
      }),
    ]);
    const completedScreeningIds = new Set(completedScreenings.map((patientId) => patientId.toString()));
    const operations = patients.map((patient) => ({
      updateOne: {
        filter: { _id: patient._id, 'careJourney.stage': { $exists: false } },
        update: {
          $set: {
            'careJourney.stage': inferLegacyCareJourneyStage({
              followUpStatuses: followUpStatuses.get(patient._id.toString()) ?? [],
              reviewStatuses: reviewStatuses.get(patient._id.toString()) ?? [],
              screeningCompleted: completedScreeningIds.has(patient._id.toString()),
            }),
          },
        },
      },
    }));
    const result = await Patient.bulkWrite(operations, { ordered: false });
    modifiedCount += result.modifiedCount;
  }

  for await (const patient of cursor) {
    batch.push(patient);
    if (batch.length === BATCH_SIZE) {
      await migrateBatch(batch);
      batch = [];
    }
  }
  await migrateBatch(batch);
  return { patientsUpdated: modifiedCount };
}

export async function down() {
  throw new Error('This migration is not reversible; it only adds journey stages to patient records.');
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
