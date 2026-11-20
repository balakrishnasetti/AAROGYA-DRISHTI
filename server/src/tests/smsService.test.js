import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmsProvider } from '../services/smsService.js';

test('MSG91 sends the app-generated OTP through its approved template', async () => {
  let request;
  const provider = createSmsProvider({
    environment: {
      NODE_ENV: 'development',
      SMS_PROVIDER: 'msg91',
      SMS_API_KEY: 'test-auth-key',
      SMS_TEMPLATE_ID: 'approved-template-id',
    },
    fetchImpl: async (url, options) => {
      request = { url: new URL(url), options };
      return Response.json({ type: 'success', message: 'SMS sent successfully' });
    },
  });

  await provider.sendOtp('+919876543210', '123456');

  assert.equal(request.url.origin, 'https://control.msg91.com');
  assert.equal(request.url.pathname, '/api/v5/otp');
  assert.equal(request.url.searchParams.get('template_id'), 'approved-template-id');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.authkey, 'test-auth-key');
  assert.deepEqual(JSON.parse(request.options.body), {
    mobile: '919876543210',
    otp: '123456',
  });
});

test('MSG91 requires an API key and approved template ID', async () => {
  const provider = createSmsProvider({
    environment: { SMS_PROVIDER: 'msg91' },
    fetchImpl: async () => {
      throw new Error('fetch must not be called without configuration');
    },
  });

  await assert.rejects(
    provider.sendOtp('+919876543210', '123456'),
    /SMS_API_KEY and SMS_TEMPLATE_ID/,
  );
});

test('MSG91 provider rejection is surfaced as a delivery failure', async () => {
  const provider = createSmsProvider({
    environment: {
      SMS_PROVIDER: 'msg91',
      SMS_API_KEY: 'test-auth-key',
      SMS_TEMPLATE_ID: 'approved-template-id',
    },
    fetchImpl: async () => Response.json({ type: 'error', message: 'template rejected' }),
  });

  await assert.rejects(provider.sendOtp('+919876543210', '123456'), /did not accept/);
});

test('MSG91 HTTP errors do not expose provider response bodies', async () => {
  const provider = createSmsProvider({
    environment: {
      SMS_PROVIDER: 'msg91',
      SMS_API_KEY: 'test-auth-key',
      SMS_TEMPLATE_ID: 'approved-template-id',
    },
    fetchImpl: async () => new Response('private provider details', { status: 401 }),
  });

  await assert.rejects(provider.sendOtp('+919876543210', '123456'), /HTTP 401/);
});

test('development OTP is gated to explicitly seeded synthetic demo accounts', async () => {
  const messages = [];
  const disabled = createSmsProvider({
    environment: { NODE_ENV: 'development', SEED_DEMO: false },
    logger: { info: (message) => messages.push(message) },
  });
  assert.equal(disabled.deliveryMode, 'unavailable');
  await assert.rejects(disabled.sendOtp('+910000000001', '123456'), /not configured/);

  const provider = createSmsProvider({
    environment: { NODE_ENV: 'development', SEED_DEMO: true },
    logger: { info: (message) => messages.push(message) },
  });
  await assert.rejects(
    provider.sendOtp('+919876543210', '123456'),
    /limited to seeded synthetic demo accounts/,
  );
  await provider.sendOtp('+910000000001', '123456');

  assert.deepEqual(messages, ['Development-only OTP for synthetic demo account: 123456']);
});

test('local patient registration OTP mode accepts real numbers only in development', async () => {
  const provider = createSmsProvider({
    environment: {
      NODE_ENV: 'development',
      DEV_PATIENT_REGISTRATION_OTP: true,
    },
  });

  assert.equal(provider.deliveryMode, 'development_console');
  await assert.doesNotReject(provider.sendOtp('+919876543210', '123456'));
  await assert.rejects(
    createSmsProvider({
      environment: {
        NODE_ENV: 'development',
        DEPLOYMENT_ENV: 'staging',
        DEV_PATIENT_REGISTRATION_OTP: true,
      },
    }).sendOtp('+919876543210', '123456'),
    /not configured/,
  );
});

test('test mode uses a mock SMS provider without external delivery', async () => {
  const provider = createSmsProvider({
    environment: { NODE_ENV: 'test', SMS_PROVIDER: 'msg91' },
    fetchImpl: async () => assert.fail('test SMS must not contact MSG91'),
  });

  assert.equal(provider.deliveryMode, 'mock');
  await assert.doesNotReject(provider.sendOtp('+919876543210', '123456'));
});

test('production mode fails closed when no SMS provider is configured', async () => {
  const provider = createSmsProvider({
    environment: { NODE_ENV: 'production' },
  });

  await assert.rejects(provider.sendOtp('+919876543210', '123456'), /not configured/);
});
