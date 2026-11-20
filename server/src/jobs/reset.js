import {
  closeSyntheticDatabase,
  connectForSyntheticData,
  seedSyntheticData,
} from './syntheticData.js';

try {
  const environment = await connectForSyntheticData();
  const counts = await seedSyntheticData({ reset: true, environment });
  console.info('Synthetic records were reset and reseeded:', counts);
  console.info('Append-only audit logs were not modified.');
} catch (error) {
  console.error(`Synthetic reset failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await closeSyntheticDatabase();
}
