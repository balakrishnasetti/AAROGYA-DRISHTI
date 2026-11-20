import {
  closeSyntheticDatabase,
  connectForSyntheticData,
  seedSyntheticData,
} from './syntheticData.js';

try {
  const environment = await connectForSyntheticData();
  const counts = await seedSyntheticData({ environment });
  console.info('Synthetic seed data created:', counts);
} catch (error) {
  console.error(`Synthetic seed failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await closeSyntheticDatabase();
}
