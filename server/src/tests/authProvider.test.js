import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTH_METHODS,
  AuthProvider,
  AuthProviderRegistry,
  validateNormalizedProfile,
} from '../auth/AuthProvider.js';

test('auth provider contract exposes all supported methods', () => {
  assert.deepEqual(AUTH_METHODS, ['manual', 'mobile_otp', 'abha', 'aadhaar_qr']);
  assert.equal(new AuthProvider('manual').method, 'manual');
});

test('provider registry dispatches initiate and normalizes verified profiles', async () => {
  const provider = {
    method: 'mobile_otp',
    initiate: async (input) => ({ challengeId: input.challengeId }),
    verify: async () => ({
      providerUserId: 'opaque-provider-id',
      verifiedMobile: '+919999999999',
      displayName: 'Patient',
      unexpected: 'discarded',
    }),
  };
  const registry = new AuthProviderRegistry().register(provider);

  assert.deepEqual(await registry.initiate('mobile_otp', { challengeId: 'challenge-1' }), {
    challengeId: 'challenge-1',
  });
  assert.deepEqual(await registry.verify('mobile_otp', {}), {
    providerUserId: 'opaque-provider-id',
    verifiedMobile: '+919999999999',
    displayName: 'Patient',
  });
});

test('provider registry rejects duplicate and missing provider methods explicitly', async () => {
  const provider = { method: 'manual', initiate: async () => ({}), verify: async () => ({ providerUserId: '1' }) };
  const registry = new AuthProviderRegistry().register(provider);

  assert.throws(() => registry.register(provider), /already registered/);
  await assert.rejects(registry.initiate('abha', {}), (error) => {
    assert.equal(error.code, 'AUTH_PROVIDER_UNAVAILABLE');
    return true;
  });
});

test('normalized profiles require stable IDs and properly formatted verified mobile numbers', () => {
  assert.throws(() => validateNormalizedProfile({}), (error) => {
    assert.equal(error.code, 'AUTH_PROVIDER_INVALID_PROFILE');
    return true;
  });
  assert.throws(
    () => validateNormalizedProfile({ providerUserId: 'subject-1', verifiedMobile: '9999999999' }),
    (error) => {
      assert.equal(error.code, 'AUTH_PROVIDER_INVALID_PROFILE');
      return true;
    },
  );
});

test('normalized ABHA profiles retain validated demographics and reject malformed ABHA numbers', () => {
  assert.deepEqual(
    validateNormalizedProfile({
      providerUserId: 'abha-number:12345678901234',
      displayName: 'Patient',
      yearOfBirth: '1990',
      gender: 'F',
      abhaNumber: '12345678901234',
      abhaAddress: 'person@abdm',
    }),
    {
      providerUserId: 'abha-number:12345678901234',
      displayName: 'Patient',
      yearOfBirth: '1990',
      gender: 'F',
      abhaNumber: '12345678901234',
      abhaAddress: 'person@abdm',
    },
  );
  assert.throws(
    () => validateNormalizedProfile({ providerUserId: 'abha:1', abhaNumber: '123' }),
    (error) => error.code === 'AUTH_PROVIDER_INVALID_PROFILE',
  );
});
