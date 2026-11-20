import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import {
  AuditLog,
  AuthAuditLog,
  AuthIdentity,
  DoctorProfile,
  Hospital,
  HospitalManager,
  PatientPasswordActivation,
  Session,
  User,
} from '../models/index.js';
import { hashToken } from '../services/authCrypto.js';
import { createAuthService } from '../services/authService.js';

const environment = {
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};
const password = 'Correct-Password-123';

function installLoginStubs(user, onFindOne) {
  const methods = [
    [User, 'findOne'],
    [User, 'findOneAndUpdate'],
    [User, 'updateOne'],
    [AuditLog, 'create'],
    [AuthIdentity, 'findOne'],
    [AuthIdentity, 'updateOne'],
  ];
  const originals = methods.map(([model, name]) => [
    model,
    name,
    Object.getOwnPropertyDescriptor(model, name),
  ]);

  User.findOne = (query) => {
    onFindOne?.(query);
    return { select: async () => user };
  };
  User.findOneAndUpdate = async () => {
    user.failedLoginAttempts += 1;
    return user;
  };
  User.updateOne = async () => ({ acknowledged: true });
  AuditLog.create = async () => ({});
  AuthIdentity.findOne = () => ({ select: async () => null });
  AuthIdentity.updateOne = async () => ({ acknowledged: true });

  return () => {
    for (const [model, name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(model, name, descriptor);
      else delete model[name];
    }
  };
}

function createUser(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    role: 'doctor',
    status: 'active',
    passwordHash: null,
    mustChangePassword: true,
    failedLoginAttempts: 0,
    lockedUntil: undefined,
    save: async () => {},
    ...overrides,
  };
}

async function login(user, submittedPassword = password, role, onFindOne) {
  const restore = installLoginStubs(user, onFindOne);
  try {
    return await createAuthService({ environment }).staffLogin(
      { identifier: 'staff-001', password: submittedPassword, role },
      { id: 'staff-login-test' },
    );
  } finally {
    restore();
  }
}

async function assertInvalidCredentials(user, submittedPassword) {
  await assert.rejects(login(user, submittedPassword), (error) => {
    assert.equal(error.status, 401);
    assert.equal(error.code, 'INVALID_CREDENTIALS');
    assert.equal(error.message, 'Invalid credentials.');
    return true;
  });
}

async function withModelStubs(stubs, run) {
  const originals = [];
  for (const [model, methods] of stubs) {
    for (const [name, implementation] of Object.entries(methods)) {
      originals.push([model, name, Object.getOwnPropertyDescriptor(model, name)]);
      model[name] = implementation;
    }
  }
  try {
    return await run();
  } finally {
    for (const [model, name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(model, name, descriptor);
      else delete model[name];
    }
  }
}

test('staff login accepts a valid password and returns the first-login flow', async () => {
  const user = createUser({ passwordHash: await bcrypt.hash(password, 4) });

  const result = await login(user);

  assert.equal(result.flow, 'password_change');
  assert.ok(result.flowToken);
  assert.equal(user.failedLoginAttempts, 0);
});

test('staff login query is restricted to the role selected by the user', async () => {
  const user = createUser({ passwordHash: await bcrypt.hash(password, 4) });
  let loginQuery;

  await login(user, password, 'doctor', (query) => {
    loginQuery = query;
  });

  assert.equal(loginQuery.role, 'doctor');
});

test('admin, hospital manager, and verified doctor get a session after password login', async () => {
  const hospitalId = new mongoose.Types.ObjectId();

  for (const role of ['admin', 'hospital_manager', 'doctor']) {
    const user = createUser({
      role,
      mustChangePassword: false,
      passwordHash: await bcrypt.hash(password, 4),
    });
    const stubs = [
      [User, {
        findOne: () => ({ select: async () => user }),
      }],
      [AuthIdentity, {
        findOne: () => ({ select: async () => null }),
        updateOne: async () => ({ acknowledged: true }),
      }],
      [Session, {
        create: async () => ({ _id: new mongoose.Types.ObjectId() }),
      }],
      [AuditLog, { create: async () => ({}) }],
      [AuthAuditLog, { create: async () => ({}) }],
      [HospitalManager, {
        findOne: () => ({ select: async () => ({ hospitalId }) }),
      }],
      [Hospital, {
        findOne: () => ({
          select: async () => ({ _id: hospitalId, status: 'active', isSynthetic: false }),
        }),
      }],
      [DoctorProfile, {
        findOne: () => ({
          select: async () => ({
            hospitalId,
            verificationStatus: 'verified',
            isSynthetic: false,
            demoLoginEnabled: false,
          }),
        }),
      }],
    ];

    const result = await withModelStubs(stubs, () =>
      createAuthService({ environment }).staffLogin(
        { identifier: 'staff-001', password, role },
        { id: `${role}-login-test`, get: () => 'test-agent' },
      ),
    );

    assert.equal(result.flow, undefined, `${role} should not receive a challenge flow`);
    assert.ok(result.accessToken, `${role} should receive an access token`);
    assert.equal(result.user.role, role);
    assert.equal(
      result.user.hospitalId?.toString() ?? null,
      role === 'admin' ? null : hospitalId.toString(),
    );
    assert.ok(user.lastLoginAt);
  }
});

test('doctor without a verified profile cannot receive a session', async () => {
  const user = createUser({
    role: 'doctor',
    mustChangePassword: false,
    passwordHash: await bcrypt.hash(password, 4),
  });
  await assert.rejects(
    withModelStubs(
      [
        [User, {
          findOne: () => ({ select: async () => user }),
        }],
        [AuthIdentity, {
          findOne: () => ({ select: async () => null }),
          updateOne: async () => ({ acknowledged: true }),
        }],
        [DoctorProfile, {
          findOne: () => ({ select: async () => null }),
        }],
        [AuditLog, { create: async () => ({}) }],
        [AuthAuditLog, { create: async () => ({}) }],
        [Session, {
          create: async () => assert.fail('Unverified doctors must not receive sessions.'),
        }],
      ],
      () =>
        createAuthService({ environment }).staffLogin(
          { identifier: 'doctor-001', password, role: 'doctor' },
          { id: 'unverified-doctor-login-test', get: () => 'test-agent' },
        ),
    ),
    (error) => {
      assert.equal(error.status, 403);
      assert.equal(error.code, 'DOCTOR_NOT_VERIFIED');
      return true;
    },
  );
});

test('enabled synthetic doctors can sign in only in opted-in local demo mode', async () => {
  const hospitalId = new mongoose.Types.ObjectId();
  const user = createUser({
    role: 'doctor',
    isSynthetic: true,
    mustChangePassword: false,
    passwordHash: await bcrypt.hash(password, 4),
  });
  const profile = {
    hospitalId,
    verificationStatus: 'pending',
    isSynthetic: true,
    demoLoginEnabled: true,
  };
  const stubs = [
    [User, {
      findOne: () => ({ select: async () => user }),
    }],
    [AuthIdentity, {
      findOne: () => ({ select: async () => null }),
      updateOne: async () => ({ acknowledged: true }),
    }],
    [DoctorProfile, {
      findOne: () => ({ select: async () => profile }),
    }],
    [Hospital, {
      findOne: () => ({
        select: async () => ({ _id: hospitalId, status: 'active', isSynthetic: true }),
      }),
    }],
    [Session, {
      create: async () => ({ _id: new mongoose.Types.ObjectId() }),
    }],
    [AuditLog, { create: async () => ({}) }],
    [AuthAuditLog, { create: async () => ({}) }],
  ];

  const allowed = await withModelStubs(stubs, () =>
    createAuthService({
      environment: { ...environment, NODE_ENV: 'development', SEED_DEMO: true },
    }).staffLogin(
      { identifier: 'demo-doctor', password, role: 'doctor' },
      { id: 'synthetic-doctor-login-test', get: () => 'test-agent' },
    ),
  );
  assert.ok(allowed.accessToken);
  assert.equal(allowed.user.role, 'doctor');

  await assert.rejects(
    withModelStubs(stubs, () =>
      createAuthService({
        environment: { ...environment, NODE_ENV: 'development', SEED_DEMO: false },
      }).staffLogin(
        { identifier: 'demo-doctor', password, role: 'doctor' },
        { id: 'synthetic-doctor-login-disabled-test', get: () => 'test-agent' },
      ),
    ),
    (error) => {
      assert.equal(error.status, 403);
      assert.equal(error.code, 'DOCTOR_NOT_VERIFIED');
      return true;
    },
  );
});

test('staff login rejects a wrong password with a generic error', async () => {
  const user = createUser({ passwordHash: await bcrypt.hash(password, 4) });

  await assertInvalidCredentials(user, 'wrong-password');
  assert.equal(user.failedLoginAttempts, 1);
});

test('staff login rejects an unknown user with the same generic error', async () => {
  await assertInvalidCredentials(null, password);
});

test('staff login rejects a locked account with the same generic error', async () => {
  const user = createUser({
    lockedUntil: new Date(Date.now() + 60_000),
    passwordHash: await bcrypt.hash(password, 4),
  });

  await assertInvalidCredentials(user, password);
  assert.equal(user.failedLoginAttempts, 0);
});

test('patient login accepts the registered phone and creates a patient session', async () => {
  const user = createUser({
    role: 'patient',
    phone: '+919876543210',
    status: 'active',
    mustChangePassword: false,
    passwordHash: await bcrypt.hash(password, 4),
  });
  let userQuery;

  const result = await withModelStubs(
    [
      [User, {
        findOne: (query) => {
          userQuery = query;
          return { select: async () => user };
        },
      }],
      [AuthIdentity, {
        findOne: () => ({ select: async () => null }),
        updateOne: async () => ({ acknowledged: true }),
      }],
      [Session, { create: async () => ({ _id: new mongoose.Types.ObjectId() }) }],
      [AuditLog, { create: async () => ({}) }],
      [AuthAuditLog, { create: async () => ({}) }],
    ],
    () => createAuthService({ environment }).patientLogin(
      { identifier: '987-654-3210', password },
      { id: 'patient-login-test', authMethod: 'manual', get: () => '' },
    ),
  );

  assert.equal(userQuery.role, 'patient');
  assert.ok(userQuery.$or.some((clause) => clause.phone === '+919876543210'));
  assert.equal(result.user.role, 'patient');
  assert.ok(result.accessToken);
});

test('patient login accepts an unverified email with a valid password without verifying it', async () => {
  const user = createUser({
    role: 'patient',
    email: 'patient@example.test',
    emailVerified: false,
    status: 'active',
    mustChangePassword: false,
    passwordHash: await bcrypt.hash(password, 4),
  });
  let userQuery;
  let identityUpdate;

  const result = await withModelStubs(
    [
      [User, {
        findOne: (query) => {
          userQuery = query;
          return { select: async () => user };
        },
      }],
      [AuthIdentity, {
        findOne: () => ({ select: async () => null }),
        updateOne: async (...args) => {
          identityUpdate = args;
          return { acknowledged: true };
        },
      }],
      [Session, { create: async () => ({ _id: new mongoose.Types.ObjectId() }) }],
      [AuditLog, { create: async () => ({}) }],
      [AuthAuditLog, { create: async () => ({}) }],
    ],
    () => createAuthService({ environment }).patientLogin(
      { identifier: ' Patient@Example.Test ', password },
      { id: 'patient-email-login-test', authMethod: 'manual', get: () => '' },
    ),
  );

  assert.ok(userQuery.$or.some((clause) => clause.email === 'patient@example.test'));
  assert.equal(userQuery.$or.some((clause) => 'emailVerified' in clause), false);
  assert.equal(identityUpdate[1].$set?.verifiedAt, undefined);
  assert.equal(user.emailVerified, false);
  assert.equal(result.user.role, 'patient');
  assert.ok(result.accessToken);
});

test('patient email login still rejects an incorrect password', async () => {
  const user = createUser({
    role: 'patient',
    email: 'patient@example.test',
    emailVerified: false,
    status: 'active',
    mustChangePassword: false,
    passwordHash: await bcrypt.hash(password, 4),
  });

  await withModelStubs(
    [
      [User, {
        findOne: () => ({ select: async () => user }),
        findOneAndUpdate: async () => {
          user.failedLoginAttempts += 1;
          return user;
        },
        updateOne: async () => ({ acknowledged: true }),
      }],
      [AuditLog, { create: async () => ({}) }],
      [AuthAuditLog, { create: async () => ({}) }],
    ],
    () => assert.rejects(
      createAuthService({ environment }).patientLogin(
        { identifier: 'patient@example.test', password: 'wrong-password' },
        { id: 'patient-email-login-test', authMethod: 'manual', get: () => '' },
      ),
      (error) => {
        assert.equal(error.code, 'INVALID_CREDENTIALS');
        return true;
      },
    ),
  );

  assert.equal(user.failedLoginAttempts, 1);
});

test('patient activation consumes its one-time code and saves a password hash', async () => {
  const user = createUser({
    role: 'patient',
    status: 'active',
    passwordHash: null,
    save: async () => {},
  });
  const activationCode = 'patient-activation-code-123456';
  let activationFilter;
  let sessionRevocations;

  await withModelStubs(
    [
      [PatientPasswordActivation, {
        findOneAndUpdate: (filter) => {
          activationFilter = filter;
          return { select: async () => ({ userId: user._id }) };
        },
        updateMany: async () => ({ acknowledged: true }),
      }],
      [User, { findOne: () => ({ select: async () => user }) }],
      [Session, {
        updateMany: async (...args) => {
          sessionRevocations = args;
          return { acknowledged: true };
        },
      }],
      [AuditLog, { create: async () => ({}) }],
    ],
    () => createAuthService({ environment }).activatePatientPassword(
      { activationCode, newPassword: 'Patient-Password-123' },
      { id: 'patient-activation-test' },
    ),
  );

  assert.equal(activationFilter.tokenHash, hashToken(activationCode));
  assert.equal(activationFilter.consumedAt, null);
  assert.ok(await bcrypt.compare('Patient-Password-123', user.passwordHash));
  assert.equal(user.mustChangePassword, false);
  assert.equal(sessionRevocations[0].userId, user._id);
});
