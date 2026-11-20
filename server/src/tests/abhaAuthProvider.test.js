import test from 'node:test';
import assert from 'node:assert/strict';
import {
  constants,
  generateKeyPairSync,
  privateDecrypt,
} from 'node:crypto';
import { AbhaAuthProvider, maskAbhaNumber } from '../auth/AbhaAuthProvider.js';

const environment = {
  ABDM_ENABLED: true,
  ABDM_ENVIRONMENT: 'sandbox',
  ABDM_CLIENT_ID: 'sandbox-client',
  ABDM_CLIENT_SECRET: 'sandbox-secret',
  ABDM_CM_ID: 'sandbox-cm',
  ABDM_SANDBOX_GATEWAY_URL: 'https://gateway.test',
  ABDM_SANDBOX_API_URL: 'https://api.test',
  DATA_ENCRYPTION_KEY: 'test-encryption-key',
  JWT_REFRESH_SECRET: 'r'.repeat(32),
};

function createHarness(respond) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKeyBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const records = new Map();
  let nextId = 1;
  const challengeStore = {
    async create(value) {
      const id = String(nextId++).padStart(24, '0');
      const challenge = { _id: { toString: () => id }, ...value };
      records.set(id, challenge);
      return challenge;
    },
    findOne({ _id, expiresAt, consumedAt }) {
      const record = records.get(String(_id));
      const found =
        record &&
        record.expiresAt > expiresAt.$gt &&
        (record.consumedAt ?? null) === consumedAt
          ? record
          : null;
      return { select: async () => found };
    },
    async updateOne({ _id }, update) {
      const record = records.get(String(_id));
      if (record) Object.assign(record, update.$set);
    },
  };
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, options, body });
    if (url.endsWith('/sessions')) {
      return { ok: true, status: 202, json: async () => ({ accessToken: 'gateway-token', expiresIn: 1800 }) };
    }
    if (url.endsWith('/login/public/certificate')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          publicKey: publicKeyBase64,
          encryptionAlgorithm: 'RSA/ECB/OAEPWithSHA-1AndMGF1Padding',
        }),
      };
    }
    return respond({
      url,
      options,
      body,
      calls,
      decrypt(value) {
        return privateDecrypt(
          {
            key: privateKey,
            padding: constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha1',
          },
          Buffer.from(value, 'base64'),
        ).toString('utf8');
      },
    });
  };
  return {
    calls,
    provider: new AbhaAuthProvider({ environment, fetchImpl, challengeStore }),
  };
}

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

test('ABHA mobile OTP login uses the documented encrypted P1 request and resolves the profile', async () => {
  const harness = createHarness(({ url, options, body, decrypt }) => {
    if (url.endsWith('/login/request/otp')) {
      assert.equal(body.loginHint, 'mobile-number');
      assert.deepEqual(body.scope, ['abha-login', 'mobile-verify']);
      assert.equal(body.otpSystem, 'abdm');
      assert.equal(decrypt(body.loginId), '9876543210');
      return jsonResponse({ txnId: 'txn-mobile-1', message: 'OTP sent' });
    }
    if (url.endsWith('/login/verify')) {
      assert.deepEqual(body.scope, ['abha-login', 'mobile-verify']);
      assert.equal(body.authData.otp.txnId, 'txn-mobile-1');
      assert.equal(decrypt(body.authData.otp.otpValue), '123456');
      return jsonResponse({
        users: [{ abhaAddress: 'person@abdm', abhaNumber: '12345678901234' }],
        tokens: { token: 'transaction-token' },
      });
    }
    if (url.endsWith('/login/verify/user')) {
      assert.equal(options.headers['T-token'], 'transaction-token');
      assert.deepEqual(body, { abhaAddress: 'person@abdm', txnId: 'txn-mobile-1' });
      return jsonResponse({ token: 'user-token' });
    }
    if (url.endsWith('/profile/account')) {
      assert.equal(options.headers['X-token'], 'user-token');
      return jsonResponse({
        ABHANumber: '12345678901234',
        preferredAbhaAddress: 'person@abdm',
        name: 'Test Patient',
        gender: 'F',
        yearOfBirth: '1990',
      });
    }
    assert.fail(`Unexpected ABDM URL: ${url}`);
  });

  const challenge = await harness.provider.initiate({
    loginType: 'mobile',
    identifier: '9876543210',
    authMethod: 'mobile-otp',
  });
  const profile = await harness.provider.verify({
    challengeId: challenge.challengeId,
    code: '123456',
  });

  assert.equal(profile.providerUserId, 'abha-number:12345678901234');
  assert.equal(profile.verifiedMobile, '+919876543210');
  assert.equal(profile.displayName, 'Test Patient');
  assert.equal(profile.yearOfBirth, '1990');
  assert.equal(profile.gender, 'F');
  assert.equal(profile.abhaNumber, '12345678901234');
  assert.equal(maskAbhaNumber(profile.abhaNumber), 'XX-XXXX-XXXX-1234');
  assert.equal(harness.calls.filter((call) => call.url.endsWith('/sessions')).length, 1);
});

test('ABHA number Aadhaar OTP request uses its exact scope and encrypted identifier', async () => {
  const harness = createHarness(({ url, body, decrypt }) => {
    if (url.endsWith('/login/request/otp')) {
      assert.deepEqual(body.scope, ['abha-login', 'aadhaar-verify']);
      assert.equal(body.loginHint, 'abha-number');
      assert.equal(body.otpSystem, 'aadhaar');
      assert.equal(decrypt(body.loginId), '12345678901234');
      return jsonResponse({ txnId: 'txn-aadhaar-1' });
    }
    assert.fail(`Unexpected ABDM URL: ${url}`);
  });

  const challenge = await harness.provider.initiate({
    loginType: 'abha-number',
    identifier: '12345678901234',
    authMethod: 'aadhaar-otp',
  });

  assert.equal(challenge.requiresOtp, true);
  assert.equal(harness.calls.some((call) => JSON.stringify(call.body ?? null).includes('12345678901234')), false);
});

test('ABHA address password flow checks methods and encrypts the password', async () => {
  const harness = createHarness(({ url, options, body, decrypt }) => {
    if (url.endsWith('/login/search')) {
      assert.equal(options.headers.abhaAddress, 'person@abdm');
      return jsonResponse({ authMethods: ['PASSWORD'] });
    }
    if (url.endsWith('/login/verify')) {
      assert.deepEqual(body.scope, ['abha-address-login', 'password-verify']);
      assert.deepEqual(body.authData.authMethods, ['password']);
      assert.equal(body.authData.password.abhaAddress, 'person@abdm');
      assert.equal(decrypt(body.authData.password.password), 'SecretPass123');
      return jsonResponse({
        users: [{ abhaAddress: 'person@abdm', abhaNumber: '12345678901234' }],
        tokens: { token: 'user-token' },
      });
    }
    if (url.endsWith('/profile/account')) {
      return jsonResponse({
        ABHANumber: '12345678901234',
        preferredAbhaAddress: 'person@abdm',
        name: 'Test Patient',
        gender: 'M',
        yearOfBirth: '1984',
      });
    }
    assert.fail(`Unexpected ABDM URL: ${url}`);
  });

  const challenge = await harness.provider.initiate({
    loginType: 'abha-address',
    identifier: 'person@abdm',
    authMethod: 'password',
  });
  const profile = await harness.provider.verify({
    challengeId: challenge.challengeId,
    password: 'SecretPass123',
  });

  assert.equal(challenge.requiresOtp, false);
  assert.equal(profile.abhaAddress, 'person@abdm');
  assert.equal(profile.yearOfBirth, '1984');
  assert.equal(harness.calls.some((call) => call.options.body?.includes('SecretPass123')), false);
});

test('unsupported ABHA address password method fails without exposing provider details', async () => {
  const harness = createHarness(({ url }) =>
    url.endsWith('/login/search')
      ? jsonResponse({ authMethods: ['MOBILE_OTP'] })
      : assert.fail(`Unexpected ABDM URL: ${url}`),
  );

  await assert.rejects(
    harness.provider.initiate({
      loginType: 'abha-address',
      identifier: 'person@abdm',
      authMethod: 'password',
    }),
    (error) => {
      assert.equal(error.code, 'ABHA_PASSWORD_UNAVAILABLE');
      assert.equal(error.message.includes('MOBILE_OTP'), false);
      return true;
    },
  );
});
