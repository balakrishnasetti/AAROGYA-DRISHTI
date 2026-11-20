import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from '../config/env.js';

const validEnvironment = {
  NODE_ENV: 'test',
  PORT: '4000',
  MONGO_URI: 'mongodb://127.0.0.1:27017/aarogya_test',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  CLIENT_URL: 'http://localhost:5173',
};

test('environment parser accepts the required configuration and empty optional integration values', () => {
  const parsed = parseEnv({ ...validEnvironment, SMTP_PORT: '' });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.PORT, 4000);
    assert.equal(parsed.data.GEMINI_API_KEY, '');
    assert.equal(parsed.data.GEMINI_MODEL, 'gemini-flash-lite-latest');
    assert.equal(parsed.data.ORAL_MODEL_API_URL, '');
    assert.equal(parsed.data.ORAL_MODEL_API_TOKEN, '');
    assert.equal(parsed.data.ANTHROPIC_API_KEY, '');
    assert.equal(parsed.data.ANTHROPIC_MODEL, 'claude-haiku-5-5');
    assert.equal(parsed.data.SEED_DEMO, false);
    assert.equal(parsed.data.DEV_PATIENT_REGISTRATION_OTP, false);
    assert.equal(parsed.data.MODEL_VALIDATED, false);
    assert.equal(parsed.data.ABDM_ENABLED, false);
    assert.equal(parsed.data.ABDM_ENVIRONMENT, 'sandbox');
    assert.equal(parsed.data.STORAGE_ENDPOINT, '');
    assert.equal(parsed.data.STORAGE_BACKEND, 'local');
    assert.equal(parsed.data.LOCAL_STORAGE_DIR, './private-storage');
    assert.equal(parsed.data.SMTP_PORT, undefined);
  }
});

test('local patient registration OTP mode is restricted to local development', () => {
  for (const environment of [
    { NODE_ENV: 'test' },
    { NODE_ENV: 'development', DEPLOYMENT_ENV: 'staging' },
    { NODE_ENV: 'development', DEPLOYMENT_ENV: 'production' },
  ]) {
    assert.equal(
      parseEnv({ ...validEnvironment, ...environment, DEV_PATIENT_REGISTRATION_OTP: 'true' })
        .success,
      false,
    );
  }
});

test('demo seeding is rejected in production and explicitly allowed in staging', () => {
  const production = parseEnv({
    ...validEnvironment,
    NODE_ENV: 'production',
    DEPLOYMENT_ENV: 'production',
    SEED_DEMO: 'true',
    DATA_ENCRYPTION_KEY: 'c'.repeat(32),
  });
  assert.equal(production.success, false);

  const productionWithDevelopmentLabel = parseEnv({
    ...validEnvironment,
    NODE_ENV: 'production',
    DEPLOYMENT_ENV: 'development',
    SEED_DEMO: 'true',
    DATA_ENCRYPTION_KEY: 'c'.repeat(32),
  });
  assert.equal(productionWithDevelopmentLabel.success, false);

  const staging = parseEnv({
    ...validEnvironment,
    NODE_ENV: 'production',
    DEPLOYMENT_ENV: 'staging',
    STORAGE_BACKEND: 's3',
    SEED_DEMO: 'true',
    DATA_ENCRYPTION_KEY: 'c'.repeat(32),
  });
  assert.equal(staging.success, true);
});

test('validated model flag requires configured model endpoint, token, and version', () => {
  assert.equal(parseEnv({ ...validEnvironment, MODEL_VALIDATED: 'true' }).success, false);
  assert.equal(
    parseEnv({
      ...validEnvironment,
      MODEL_VALIDATED: 'true',
      ORAL_MODEL_API_URL: 'https://model.example.test',
      ORAL_MODEL_API_TOKEN: 'server-only-token',
      ORAL_MODEL_VERSION: 'validated-v1',
    }).success,
    true,
  );
});

test('environment parser rejects short JWT secrets', () => {
  const parsed = parseEnv({ ...validEnvironment, JWT_ACCESS_SECRET: 'too-short' });

  assert.equal(parsed.success, false);
});

test('local storage is configured for development and prohibited in production', () => {
  const development = parseEnv({
    ...validEnvironment,
    STORAGE_BACKEND: 'local',
    LOCAL_STORAGE_DIR: './private-storage',
  });
  assert.equal(development.success, true);

  const production = parseEnv({
    ...validEnvironment,
    NODE_ENV: 'production',
    DEPLOYMENT_ENV: 'production',
    STORAGE_BACKEND: 'local',
    DATA_ENCRYPTION_KEY: 'c'.repeat(32),
  });
  assert.equal(production.success, false);
});

test('environment parser rejects reused JWT secrets', () => {
  const parsed = parseEnv({
    ...validEnvironment,
    JWT_REFRESH_SECRET: validEnvironment.JWT_ACCESS_SECRET,
  });

  assert.equal(parsed.success, false);
});

test('environment parser rejects a weak synthetic staff password', () => {
  const parsed = parseEnv({ ...validEnvironment, SEED_STAFF_PASSWORD: 'weak' });
  assert.equal(parsed.success, false);
});

test('Turnstile CAPTCHA keys must be configured together', () => {
  assert.equal(
    parseEnv({ ...validEnvironment, TURNSTILE_SECRET_KEY: 'server-secret' }).success,
    false,
  );
  assert.equal(
    parseEnv({
      ...validEnvironment,
      TURNSTILE_SECRET_KEY: 'server-secret',
      TURNSTILE_SITE_KEY: 'public-site-key',
    }).success,
    true,
  );
});

test('ABDM credentials are required only when the integration is enabled', () => {
  const credentials = {
    ABDM_ENABLED: 'true',
    ABDM_CLIENT_ID: 'sandbox-client',
    ABDM_CLIENT_SECRET: 'sandbox-secret',
    ABDM_CM_ID: 'sandbox-cm',
  };
  assert.equal(parseEnv({ ...validEnvironment, ...credentials }).success, true);
  assert.equal(parseEnv({ ...validEnvironment, ABDM_ENABLED: 'true' }).success, false);
});

test('ABDM production mode requires explicit approved gateway and API URLs', () => {
  const production = {
    ...validEnvironment,
    ABDM_ENABLED: 'true',
    ABDM_ENVIRONMENT: 'production',
    ABDM_CLIENT_ID: 'production-client',
    ABDM_CLIENT_SECRET: 'production-secret',
    ABDM_CM_ID: 'production-cm',
  };
  assert.equal(parseEnv(production).success, false);
  assert.equal(
    parseEnv({
      ...production,
      ABDM_PRODUCTION_GATEWAY_URL: 'https://gateway.example.test',
      ABDM_PRODUCTION_API_URL: 'https://api.example.test',
    }).success,
    true,
  );
});
