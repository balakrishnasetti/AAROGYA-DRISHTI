import test from 'node:test';
import assert from 'node:assert/strict';
import {
  staffAccessRequestSchema,
  staffAccessReviewSchema,
} from '../validators/staffAccessRequestValidators.js';

const baseRequest = {
  fullName: 'Synthetic Applicant',
  email: 'applicant@example.test',
  phone: '+919876543210',
  district: 'Alluri Sitarama Raju District',
  requestedRole: 'district_officer',
};

test('staff request validation allows defined staff roles but not self-requested admin or patient roles', () => {
  for (const requestedRole of [
    'hospital_manager',
    'doctor',
    'specialist',
    'health_worker',
    'navigator',
    'district_officer',
  ]) {
    const request = {
      ...baseRequest,
      requestedRole,
      ...(requestedRole === 'hospital_manager' ||
      requestedRole === 'doctor' ||
      requestedRole === 'specialist'
        ? { hospitalId: '0123456789abcdef01234567' }
        : {}),
      ...(requestedRole === 'doctor' || requestedRole === 'specialist'
        ? { qualification: 'BDS', registrationNumber: 'REG-123', specialty: 'Dentistry' }
        : {}),
      ...(requestedRole === 'health_worker' || requestedRole === 'navigator'
        ? { mandal: 'Synthetic Mandal', phc: 'Synthetic PHC' }
        : {}),
    };
    assert.equal(staffAccessRequestSchema.safeParse(request).success, true, requestedRole);
  }

  assert.equal(
    staffAccessRequestSchema.safeParse({ ...baseRequest, requestedRole: 'admin' }).success,
    false,
  );
  assert.equal(
    staffAccessRequestSchema.safeParse({ ...baseRequest, requestedRole: 'patient' }).success,
    false,
  );
});

test('hospital and doctor applications require facility and professional details', () => {
  assert.equal(
    staffAccessRequestSchema.safeParse({ ...baseRequest, requestedRole: 'hospital_manager' })
      .success,
    false,
  );
  assert.equal(
    staffAccessRequestSchema.safeParse({
      ...baseRequest,
      requestedRole: 'doctor',
      hospitalId: '0123456789abcdef01234567',
    }).success,
    false,
  );
  assert.equal(
    staffAccessRequestSchema.safeParse({
      ...baseRequest,
      requestedRole: 'specialist',
      hospitalId: '0123456789abcdef01234567',
    }).success,
    false,
  );
});

test('review can only approve or reject and cannot set account roles or passwords', () => {
  assert.equal(staffAccessReviewSchema.safeParse({ status: 'approved' }).success, true);
  assert.equal(staffAccessReviewSchema.safeParse({ status: 'pending' }).success, false);
  assert.equal(
    staffAccessReviewSchema.safeParse({ status: 'approved', role: 'admin' }).success,
    false,
  );
});
