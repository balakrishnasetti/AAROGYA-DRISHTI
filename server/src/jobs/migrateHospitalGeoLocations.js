import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { loadEnv } from '../config/env.js';
import { Hospital } from '../models/index.js';

try {
  const environment = loadEnv();
  await connectDatabase(environment.MONGO_URI);
  const result = await Hospital.collection.updateMany(
    {
      'coordinates.latitude': { $type: 'number', $gte: -90, $lte: 90 },
      'coordinates.longitude': { $type: 'number', $gte: -180, $lte: 180 },
      $or: [
        { 'location.coordinates': { $exists: false } },
        { 'location.coordinates': { $size: 0 } },
      ],
    },
    [{
      $set: {
        location: {
          type: 'Point',
          coordinates: ['$coordinates.longitude', '$coordinates.latitude'],
        },
      },
    }],
  );
  console.info('Hospital GeoJSON migration complete:', {
    matched: result.matchedCount,
    updated: result.modifiedCount,
  });
} catch (error) {
  console.error(`Hospital GeoJSON migration failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
