import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import {
  AuditLog,
  OtpLoginState,
  Patient,
  PatientRegistrationChallenge,
  User,
} from '../models/index.js';
import { hashOtp } from '../services/authCrypto.js';
import { createAuthService } from '../services/authService.js';

const environment = {
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

async function withStubs(stubs, run) {
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

test('patient registration stores only OTP and password hashes, then creates the patient after verification', async () => {
  const phone = '+919876543210';
  let sentCode;
  let pendingChallenge;
  let createdUser;
  const service = createAuthService({
    environment,
    smsProvider: {
      deliveryMode: 'mock',
      async sendOtp(_phone, code) {
        sentCode = code;
      },
    },
  });

  await withStubs(
    [
      [
        OtpLoginState,
        {
          updateOne: async () => ({ acknowledged: true }),
          findOne: () => ({
            select: () => ({ lean: async () => null }),
          }),
          findOneAndUpdate: async () => ({ destinationHash: 'reserved' }),
        },
      ],
      [
        PatientRegistrationChallenge,
        {
          updateMany: async () => ({ acknowledged: true }),
          create: async (challenge) => {
            pendingChallenge = { ...challenge, _id: new mongoose.Types.ObjectId() };
            return pendingChallenge;
          },
          findOne: () => ({
            select: async () => pendingChallenge,
          }),
          findOneAndUpdate: async () => pendingChallenge,
        },
      ],
      [
        User,
        {
          findOne: (query) => ({
            select: () => ('email' in query ? { lean: async () => null } : Promise.resolve(null)),
          }),
          create: async ([user]) => {
            createdUser = { ...user, _id: new mongoose.Types.ObjectId() };
            return [createdUser];
          },
        },
      ],
      [Patient, { updateOne: async () => ({ acknowledged: true }) }],
      [AuditLog, { create: async () => ({}) }],
    ],
    async () => {
      const request = await service.requestPatientRegistrationOtp(
        {
          fullName: 'Patient Example',
          phone,
          email: 'patient@example.test',
          password: 'Strong-Patient-123',
        },
        { id: 'patient-registration-test' },
      );

      assert.equal(
        pendingChallenge.codeHash,
        hashOtp(phone, sentCode, environment.JWT_ACCESS_SECRET),
      );
      assert.notEqual(pendingChallenge.codeHash, sentCode);
      assert.ok(await bcrypt.compare('Strong-Patient-123', pendingChallenge.passwordHash));
      assert.equal(request.challengeId, pendingChallenge._id);

      const result = await service.verifyPatientRegistrationOtp(
        { phone, challengeId: String(pendingChallenge._id), code: sentCode },
        { id: 'patient-registration-test' },
      );

      assert.equal(createdUser.role, 'patient');
      assert.equal(createdUser.phone, phone);
      assert.equal(createdUser.email, 'patient@example.test');
      assert.equal(createdUser.emailVerified, false);
      assert.ok(await bcrypt.compare('Strong-Patient-123', createdUser.passwordHash));
      assert.equal(result.user.role, 'patient');
    },
  );
});

test('patient registration returns the local development code when that mode is enabled', async () => {
  const service = createAuthService({
    environment: { ...environment, NODE_ENV: 'development', DEV_PATIENT_REGISTRATION_OTP: true },
    smsProvider: {
      deliveryMode: 'development_console',
      async sendOtp() {},
    },
  });
  let pendingChallenge;

  await withStubs(
    [
      [
        OtpLoginState,
        {
          updateOne: async () => ({ acknowledged: true }),
          findOne: () => ({ select: () => ({ lean: async () => null }) }),
          findOneAndUpdate: async () => ({ destinationHash: 'reserved' }),
        },
      ],
      [
        PatientRegistrationChallenge,
        {
          updateMany: async () => ({ acknowledged: true }),
          create: async (challenge) => {
            pendingChallenge = { ...challenge, _id: new mongoose.Types.ObjectId() };
            return pendingChallenge;
          },
        },
      ],
      [AuditLog, { create: async () => ({}) }],
    ],
    async () => {
      const result = await service.requestPatientRegistrationOtp(
        {
          fullName: 'Patient Example',
          phone: '+919876543210',
          password: 'Strong-Patient-123',
        },
        { id: 'patient-registration-test' },
      );

      assert.equal(result.deliveryMode, 'development_console');
      assert.match(result.developmentCode, /^\d{6}$/);
      assert.equal(
        pendingChallenge.codeHash,
        hashOtp('+919876543210', result.developmentCode, environment.JWT_ACCESS_SECRET),
      );
    },
  );
});

test('failed SMS delivery releases its OTP send reservation', async () => {
  const reservationUpdates = [];
  let reservedAt;
  const service = createAuthService({
    environment,
    smsProvider: {
      deliveryMode: 'unavailable',
      async sendOtp() {
        throw new Error('SMS provider is not configured.');
      },
    },
  });

  await withStubs(
    [
      [
        OtpLoginState,
        {
          updateOne: async (...args) => {
            reservationUpdates.push(args);
            return { acknowledged: true };
          },
          findOne: () => ({ select: () => ({ lean: async () => null }) }),
          findOneAndUpdate: async (_query, update) => {
            reservedAt = update[0].$set.sendTimestamps.$concatArrays[1][0];
            return { destinationHash: 'reserved' };
          },
        },
      ],
      [
        PatientRegistrationChallenge,
        {
          updateMany: async () => ({ acknowledged: true }),
          create: async (challenge) => ({ ...challenge, _id: new mongoose.Types.ObjectId() }),
          updateOne: async () => ({ acknowledged: true }),
        },
      ],
      [AuditLog, { create: async () => ({}) }],
    ],
    async () => {
      await assert.rejects(
        service.requestPatientRegistrationOtp(
          {
            fullName: 'Patient Example',
            phone: '+919876543210',
            password: 'Strong-Patient-123',
          },
          { id: 'patient-registration-test' },
        ),
        (error) => error.code === 'SMS_UNAVAILABLE',
      );
    },
  );

  assert.equal(reservationUpdates.length, 2);
  assert.equal(reservationUpdates[1][1].$pull.sendTimestamps.getTime(), reservedAt.getTime());
});
