import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { authenticateFlow } from '../middleware/authenticate.js';
import { authorizePermission, roleAllowed, scopeToHospital } from '../middleware/authorize.js';
import { permissionsForRole, roleHasPermission } from '../security/rolePermissions.js';
import { careRelationship } from '../middleware/careRelationship.js';
import { assertPatientAccessWith } from '../middleware/patientAccess.js';
import {
  consumeResetToken,
  isSyntheticDemoPatientPhone,
  otpIsUsable,
  resetTokenIsUsable,
} from '../services/authPolicy.js';
import { signAccessToken, signFlowToken, verifyAccessToken } from '../services/tokenService.js';
import { assertLocalDemoSeedEnvironment, isDemoSeedEnabled } from '../config/demoMode.js';

const environment = {
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

test('patient role cannot pass a doctor-only route guard', () => {
  assert.equal(roleAllowed({ role: 'patient' }, ['doctor']), false);
  assert.equal(roleAllowed({ role: 'doctor' }, ['doctor']), true);
});

test('demo seed access requires opt-in and explicit staging for production-mode deployments', () => {
  assert.equal(isDemoSeedEnabled({ NODE_ENV: 'development', SEED_DEMO: false }), false);
  assert.equal(isDemoSeedEnabled({ NODE_ENV: 'production', SEED_DEMO: true }), false);
  assert.equal(
    isDemoSeedEnabled({
      NODE_ENV: 'production',
      DEPLOYMENT_ENV: 'staging',
      SEED_DEMO: true,
    }),
    true,
  );
  assert.equal(
    isDemoSeedEnabled({
      NODE_ENV: 'production',
      DEPLOYMENT_ENV: 'development',
      SEED_DEMO: true,
    }),
    false,
  );
});

test('local demo doctor seeding is restricted to opted-in development on localhost MongoDB', () => {
  const allowed = {
    NODE_ENV: 'development',
    SEED_DEMO: true,
    MONGO_URI: 'mongodb://127.0.0.1:27017/aarogya_test',
  };
  assert.doesNotThrow(() => assertLocalDemoSeedEnvironment(allowed));
  assert.throws(
    () => assertLocalDemoSeedEnvironment({ ...allowed, SEED_DEMO: false }),
    /SEED_DEMO=true/,
  );
  assert.throws(
    () => assertLocalDemoSeedEnvironment({ ...allowed, NODE_ENV: 'production' }),
    /only in development/,
  );
  assert.throws(
    () =>
      assertLocalDemoSeedEnvironment({
        ...allowed,
        MONGO_URI: 'mongodb://remote.example.test:27017/aarogya',
      }),
    /localhost MongoDB/,
  );
});

test('role permission matrix follows least privilege for clinical, field, and admin features', () => {
  assert.equal(roleHasPermission('doctor', 'screenings.review.write'), true);
  assert.equal(roleHasPermission('navigator', 'screenings.review.write'), false);
  assert.equal(roleHasPermission('health_worker', 'field.patients.register'), true);
  assert.equal(roleHasPermission('health_worker', 'patients.assigned.read'), false);
  assert.equal(roleHasPermission('district_officer', 'district.analytics.export'), true);
  assert.equal(roleHasPermission('district_officer', 'platform.users.manage'), false);
  assert.equal(roleHasPermission('unknown', 'dashboard.read'), false);
  assert.ok(permissionsForRole('patient').includes('profile.self.read'));
});

test('permission middleware rejects another role and audits the denied permission', async () => {
  let auditEvent;
  let nextError;
  const middleware = authorizePermission('platform.roles.manage', async (event) => {
    auditEvent = event;
  });
  await middleware(
    {
      user: { id: 'user-1', role: 'health_worker' },
      baseUrl: '/api/v1/users',
      path: '/user-1/role',
      id: 'request-1',
    },
    {},
    (error) => {
      nextError = error;
    },
  );
  assert.equal(nextError.code, 'FORBIDDEN');
  assert.equal(auditEvent.action, 'access_denied');
  assert.equal(auditEvent.metadata.requiredPermission, 'platform.roles.manage');
});

test('doctors cannot read patients without an active care assignment', async () => {
  const patientId = new mongoose.Types.ObjectId().toString();
  const doctorId = new mongoose.Types.ObjectId();
  const hospitalId = new mongoose.Types.ObjectId();
  const middleware = careRelationship({
    CareAssignmentModel: {
      findOne: () => ({ select: async () => null }),
    },
    PatientModel: {
      findOne: () => ({ select: async () => ({ _id: patientId }) }),
    },
    BreakGlassAccessModel: {
      findOne: () => ({ select: async () => null }),
    },
    auditWriter: async () => {},
  });
  let nextError;

  await middleware(
    {
      user: { id: doctorId, role: 'doctor', hospitalId },
      params: { patientId },
    },
    {},
    (error) => {
      nextError = error;
    },
  );

  assert.equal(nextError.code, 'CARE_RELATIONSHIP_REQUIRED');
});

test('patient cannot use doctor care relationship middleware and denial is logged', async () => {
  let auditEvent;
  const middleware = careRelationship({ auditWriter: async (event) => { auditEvent = event; } });
  let nextError;
  await middleware(
    {
      user: { id: new mongoose.Types.ObjectId(), role: 'patient' },
      params: { patientId: 'valid' },
    },
    {},
    (error) => {
      nextError = error;
    },
  );
  assert.equal(nextError.code, 'FORBIDDEN');
  assert.equal(auditEvent.action, 'access_denied');
});

test('hospital manager cannot override their hospital scope with a client-sent ID', () => {
  const hospitalId = new mongoose.Types.ObjectId();
  const otherHospitalId = new mongoose.Types.ObjectId();
  let nextError;
  scopeToHospital(
    {
      user: { role: 'hospital_manager', hospitalId },
      params: {},
      query: { hospitalId: otherHospitalId.toString() },
      body: {},
    },
    {},
    (error) => {
      nextError = error;
    },
  );
  assert.equal(nextError.code, 'HOSPITAL_SCOPE_FORBIDDEN');
});

test('manager cannot request another hospital doctors or appointment summary', () => {
  const hospitalId = new mongoose.Types.ObjectId();
  const otherHospitalId = new mongoose.Types.ObjectId();
  for (const [method, path] of [
    ['GET', '/doctors'],
    ['PATCH', `/doctors/${new mongoose.Types.ObjectId()}`],
    ['GET', '/appointments/summary'],
  ]) {
    let nextError;
    scopeToHospital(
      {
        method,
        path,
        user: { role: 'hospital_manager', hospitalId },
        params: {},
        query: { hospitalId: otherHospitalId.toString() },
        body: {},
      },
      {},
      (error) => {
        nextError = error;
      },
    );
    assert.equal(nextError.code, 'HOSPITAL_SCOPE_FORBIDDEN');
  }
});

test('hospital managers cannot access patient clinical routes', async () => {
  const patientId = new mongoose.Types.ObjectId().toString();
  const middleware = assertPatientAccessWith({
    PatientModel: {
      findOne: () => ({
        select: async () => ({ _id: patientId, userId: new mongoose.Types.ObjectId() }),
      }),
    },
    CareAssignmentModel: {
      exists: async () => assert.fail('Managers must not receive clinical access through a care assignment.'),
    },
    auditWriter: async () => {},
    anomalyMonitor: async () => {},
  });
  let nextError;
  await middleware(
    {
      params: { patientId },
      user: { id: new mongoose.Types.ObjectId(), role: 'hospital_manager' },
    },
    {},
    (error) => {
      nextError = error;
    },
  );
  assert.equal(nextError.code, 'FORBIDDEN');
});

test('patient ID tampering is denied and recorded by the patient access guard', async () => {
  const patientId = new mongoose.Types.ObjectId();
  const otherPatientId = new mongoose.Types.ObjectId();
  let auditEvent;
  const middleware = assertPatientAccessWith({
    PatientModel: {
      findOne: () => ({
        select: async () => ({ _id: patientId, userId: otherPatientId }),
      }),
    },
    auditWriter: async (event) => { auditEvent = event; },
    anomalyMonitor: async () => {},
  });
  let nextError;

  await middleware(
    {
      params: { patientId: patientId.toString() },
      path: `/${patientId}/history`,
      method: 'GET',
      id: 'request-1',
      user: { id: new mongoose.Types.ObjectId(), role: 'patient' },
    },
    {},
    (error) => { nextError = error; },
  );

  assert.equal(nextError.code, 'FORBIDDEN');
  assert.equal(auditEvent.action, 'access_denied');
  assert.equal(auditEvent.resourceId, patientId.toString());
});

test('expired and tampered access tokens are rejected', () => {
  const user = { _id: new mongoose.Types.ObjectId(), role: 'doctor' };
  const accessToken = signAccessToken(user, new mongoose.Types.ObjectId(), environment);
  assert.equal(verifyAccessToken(accessToken, environment).tokenUse, 'access');
  assert.throws(() => verifyAccessToken(`${accessToken.slice(0, -1)}x`, environment));

  const expired = jwt.sign(
    { sid: new mongoose.Types.ObjectId().toString(), tokenUse: 'access' },
    environment.JWT_ACCESS_SECRET,
    {
      subject: user._id.toString(),
      expiresIn: -1,
      issuer: 'aarogya-drishti',
      audience: 'aarogya-drishti-client',
      algorithm: 'HS256',
    },
  );
  assert.throws(() => verifyAccessToken(expired, environment));
});

test('expired and wrong-purpose password-change flow tokens cannot be authenticated', () => {
  const token = signFlowToken(new mongoose.Types.ObjectId(), 'password_reset', environment);
  let nextError;
  authenticateFlow('password_change', environment)({ get: () => `Bearer ${token}` }, {}, (error) => {
    nextError = error;
  });
  assert.equal(nextError.code, 'AUTHENTICATION_REQUIRED');

  const expiredToken = jwt.sign(
    { tokenUse: 'flow', purpose: 'password_change' },
    environment.JWT_ACCESS_SECRET,
    {
      subject: new mongoose.Types.ObjectId().toString(),
      expiresIn: -1,
      issuer: 'aarogya-drishti',
      audience: 'aarogya-drishti-client',
      algorithm: 'HS256',
    },
  );
  authenticateFlow('password_change', environment)(
    { get: () => `Bearer ${expiredToken}` },
    {},
    (error) => {
      nextError = error;
    },
  );
  assert.equal(nextError.code, 'AUTHENTICATION_REQUIRED');
});

test('expired or consumed OTP and password reset tokens are unusable', () => {
  const now = new Date();
  assert.equal(otpIsUsable({ expiresAt: new Date(now.getTime() + 1000), attempts: 0 }, now), true);
  assert.equal(otpIsUsable({ expiresAt: new Date(now.getTime() - 1), attempts: 0 }, now), false);
  assert.equal(
    otpIsUsable({ expiresAt: new Date(now.getTime() + 1000), attempts: 0, consumedAt: now }, now),
    false,
  );

  const token = { expiresAt: new Date(now.getTime() + 1000), consumedAt: null };
  assert.equal(resetTokenIsUsable(token, now), true);
  token.consumedAt = now;
  assert.equal(resetTokenIsUsable(token, now), false);
  assert.equal(resetTokenIsUsable({ expiresAt: new Date(now.getTime() - 1) }, now), false);
});

test('synthetic demo patient phone allowlist matches only seeded patient account numbers', () => {
  assert.equal(isSyntheticDemoPatientPhone('+910000000001'), true);
  assert.equal(isSyntheticDemoPatientPhone('+910000000020'), true);
  assert.equal(isSyntheticDemoPatientPhone('+910000000021'), false);
  assert.equal(isSyntheticDemoPatientPhone('+919876543210'), false);
});

test('a password reset token is consumed once and cannot be replayed', async () => {
  const record = {
    tokenHash: 'stored-hash',
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  };
  const resetModel = {
    async findOneAndUpdate(filter, update) {
      if (
        filter.tokenHash !== record.tokenHash ||
        record.consumedAt ||
        record.expiresAt <= filter.expiresAt.$gt
      ) {
        return null;
      }
      record.consumedAt = update.$set.consumedAt;
      return record;
    },
  };

  const first = await consumeResetToken(resetModel, 'stored-hash');
  const second = await consumeResetToken(resetModel, 'stored-hash');
  assert.ok(first);
  assert.equal(second, null);
});
