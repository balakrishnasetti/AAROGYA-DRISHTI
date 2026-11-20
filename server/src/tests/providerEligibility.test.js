import test from 'node:test';
import assert from 'node:assert/strict';
import { getAppointableDoctorFilter } from '../utils/providerEligibility.js';

test('real appointment options must be verified and synthetic demo options remain explicitly unverified', () => {
  assert.deepEqual(getAppointableDoctorFilter(), [
    { verificationStatus: 'verified', isSynthetic: { $ne: true } },
    { verificationStatus: 'pending', isSynthetic: true },
  ]);
});
