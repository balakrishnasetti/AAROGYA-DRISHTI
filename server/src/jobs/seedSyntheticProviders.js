import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { connectDatabase } from '../config/database.js';
import { assertDemoSeedEnabled } from '../config/demoMode.js';
import { loadEnv } from '../config/env.js';
import { Hospital, DoctorProfile, TimeSlot, User } from '../models/index.js';
import { syntheticDentists, syntheticFacilities } from './syntheticProviders.js';

function assertSafeEnvironment(environment) {
  assertDemoSeedEnabled(environment);
  const uri = new URL(environment.MONGO_URI);
  if (!['localhost', '127.0.0.1', '::1'].includes(uri.hostname)) {
    throw new Error('Synthetic provider seeding only runs against a local MongoDB database.');
  }
}

async function createIfMissing(model, filter, record, label) {
  const existing = await model.findOne(filter).lean();
  if (existing) {
    if (!existing.isSynthetic) {
      throw new Error(`Refusing to overwrite an existing non-synthetic ${label}.`);
    }
    return { record: existing, created: false };
  }
  return { record: await model.create(record), created: true };
}

export async function seedSyntheticProviders(environment = loadEnv()) {
  assertSafeEnvironment(environment);
  const facilitiesByCode = new Map();
  let facilitiesCreated = 0;
  for (const facility of syntheticFacilities) {
    const result = await createIfMissing(Hospital, { code: facility.code }, facility, 'facility');
    if (!result.created) {
      await Hospital.updateOne(
        { _id: result.record._id, isSynthetic: true },
        {
          $set: {
            centerType: facility.centerType,
            ownership: facility.ownership,
            specialties: facility.specialties,
            rating: facility.rating,
            coordinates: facility.coordinates,
            location: facility.location,
          },
        },
      );
    }
    facilitiesByCode.set(facility.code, result.record);
    if (result.created) facilitiesCreated += 1;
  }

  let doctorsCreated = 0;
  let slotsCreated = 0;
  const shifts = [
    { hour: 9, endHour: 9.5 },
    { hour: 14, endHour: 14.5 },
    { hour: 17, endHour: 17.5 },
  ];
  for (const dentist of syntheticDentists) {
    const userResult = await createIfMissing(
      User,
      { staffId: dentist.staffId },
      {
        fullName: dentist.fullName,
        email: dentist.email,
        staffId: dentist.staffId,
        role: 'doctor',
        status: 'pending',
        mustChangePassword: true,
        isSynthetic: true,
      },
      'demo doctor account',
    );
    const user = userResult.record;
    const facility = facilitiesByCode.get(dentist.facilityCode);
    if (!facility) throw new Error(`Missing synthetic facility ${dentist.facilityCode}.`);
    const profileResult = await createIfMissing(
      DoctorProfile,
      { userId: user._id },
      {
        userId: user._id,
        hospitalId: facility._id,
        qualification: dentist.qualification,
        registrationNumber: dentist.registrationNumber,
        specialty: dentist.specialty,
        experienceYears: dentist.experienceYears,
        consultationFee: dentist.consultationFee,
        expertise: dentist.expertise,
        languages: dentist.languages,
        availability: dentist.availability,
        verificationStatus: 'pending',
        isSynthetic: true,
      },
      'demo doctor profile',
    );
    if (profileResult.created) doctorsCreated += 1;

    for (let offset = 1; offset <= 14; offset += 1) {
      const date = new Date();
      date.setUTCHours(0, 0, 0, 0);
      date.setUTCDate(date.getUTCDate() + offset);
      const weekday = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][date.getUTCDay()];
      if (weekday === 'sun') continue;
      for (const shift of shifts) {
        const startAt = new Date(date);
        startAt.setUTCHours(Math.floor(shift.hour), (shift.hour % 1) * 60, 0, 0);
        const endAt = new Date(startAt);
        endAt.setUTCMinutes(endAt.getUTCMinutes() + 30);
        const existingSlot = await TimeSlot.findOne({
          doctorId: user._id,
          startAt,
        }).lean();
        if (existingSlot) {
          if (!existingSlot.isSynthetic) {
            throw new Error('Refusing to overwrite a non-synthetic appointment slot.');
          }
          continue;
        }
        await TimeSlot.create({
          doctorId: user._id,
          hospitalId: facility._id,
          startAt,
          endAt,
          status: 'available',
          isSynthetic: true,
        });
        slotsCreated += 1;
      }
    }
  }

  return { facilitiesCreated, doctorsCreated, slotsCreated };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const environment = loadEnv();
    assertSafeEnvironment(environment);
    await connectDatabase(environment.MONGO_URI);
    const counts = await seedSyntheticProviders(environment);
    console.info('Synthetic provider records added:', counts);
  } catch (error) {
    console.error(`Synthetic provider seeding failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
