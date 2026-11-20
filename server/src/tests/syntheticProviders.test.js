import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dentalSpecialties,
  getSyntheticProviderCounts,
  syntheticDentists,
  syntheticFacilities,
} from '../jobs/syntheticProviders.js';

test('synthetic directory has five hospitals, ten PHCs, and twenty pending dentists', () => {
  assert.deepEqual(getSyntheticProviderCounts(), {
    hospitals: 5,
    phcs: 10,
    doctors: 20,
    specialties: 8,
  });
  assert.ok(syntheticFacilities.every((facility) => facility.isSynthetic));
  assert.ok(syntheticFacilities.every((facility) => (
    facility.state === 'Andhra Pradesh'
    && facility.district === 'Alluri Sitarama Raju District'
    && facility.coordinates
    && facility.location?.type === 'Point'
    && facility.specialties.length
  )));
  assert.ok(syntheticFacilities.every((facility) => facility.rating === null));
  assert.ok(syntheticDentists.every((doctor) => doctor.isSynthetic));
  assert.ok(syntheticDentists.every((doctor) => doctor.verificationStatus === 'pending'));
  assert.ok(syntheticDentists.every((doctor) => doctor.registrationNumber.startsWith('SYNTHETIC-DEMO')));
});

test('all requested specialties have two or three clearly synthetic doctors', () => {
  for (const specialty of dentalSpecialties) {
    const doctors = syntheticDentists.filter((doctor) => doctor.specialty === specialty);
    assert.ok(doctors.length === 2 || doctors.length === 3);
    assert.ok(doctors.every((doctor) => doctor.fullName.startsWith('Synthetic Demo Dentist')));
    assert.ok(doctors.every((doctor) => doctor.facilityCode.startsWith('SYN-ASR-')));
  }
});

test('synthetic doctors have morning, afternoon, and evening schedules without real contact data', () => {
  for (const doctor of syntheticDentists) {
    assert.ok(doctor.availability.some((slot) => slot.startsAt === '09:00'));
    assert.ok(doctor.availability.some((slot) => slot.startsAt === '14:00'));
    assert.ok(doctor.availability.some((slot) => slot.startsAt === '17:00'));
    assert.match(doctor.email, /@example\.invalid$/);
  }
});
