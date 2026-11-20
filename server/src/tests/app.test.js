import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';

const environment = {
  NODE_ENV: 'development',
  CLIENT_URL: 'http://localhost:5173',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

async function withServer(run, appEnvironment = environment) {
  const server = createApp(appEnvironment).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('health endpoint returns the API, database, and storage statuses', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(response.headers.get('x-request-id')?.length, 36);
    assert.deepEqual(
      { success: body.success, code: body.code, message: typeof body.message, details: null },
      { success: false, code: 'SERVICE_DEGRADED', message: 'string', details: null },
    );
    assert.equal(body.details.api, 'ok');
    assert.equal(body.details.db, 'unavailable');
    assert.equal(body.details.database, 'disconnected');
    assert.equal(body.details.storage, 'ok');
    assert.equal(body.details.storageBackend, 'local');
    assert.equal(body.details.model, 'not_configured');
  });
});

test('successful auth refreshes do not exhaust the auth request limiter', async () => {
  await withServer(async (baseUrl) => {
    for (let request = 0; request < 35; request += 1) {
      const response = await fetch(`${baseUrl}/api/v1/auth/refresh`, { method: 'POST' });
      assert.equal(response.status, 204);
    }
  });
});

test('health endpoint reports configured but unreachable private storage as unavailable', async () => {
  const storageEnvironment = {
    ...environment,
    STORAGE_ENDPOINT: 'http://127.0.0.1:1',
    STORAGE_BUCKET: 'private-test-bucket',
    STORAGE_ACCESS_KEY: 'test-access-key',
    STORAGE_SECRET_KEY: 'test-secret-key',
  };
  const server = createApp(storageEnvironment).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/health`);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.details.db, 'unavailable');
    assert.equal(body.details.storage, 'unavailable');
    assert.equal(body.details.storageBackend, 's3');
    assert.equal(body.details.model, 'not_configured');
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('health reports local storage separately from database connectivity', async (context) => {
  const localStorageDirectory = await mkdtemp(path.join(tmpdir(), 'aarogya-health-storage-'));
  context.after(() => rm(localStorageDirectory, { recursive: true, force: true }));
  const localEnvironment = {
    ...environment,
    STORAGE_BACKEND: 'local',
    LOCAL_STORAGE_DIR: localStorageDirectory,
  };
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.details.db, 'unavailable');
    assert.equal(body.details.storage, 'ok');
    assert.equal(body.details.storageBackend, 'local');
    assert.equal(body.details.model, 'not_configured');
  }, localEnvironment);
});

test('health reports model readiness independently from storage and database', async () => {
  const { getHealthStatus } = await import('../services/healthService.js');
  const storageService = { checkAvailability: async () => 'available' };
  const ready = await getHealthStatus(
    {
      ORAL_MODEL_API_URL: 'http://model-service:8000',
      ORAL_MODEL_API_TOKEN: 'server-only-token',
      STORAGE_BACKEND: 'local',
    },
    storageService,
    async () => ({
      ok: true,
      json: async () => ({
        status: 'not_ready',
        classifierModel: { status: 'ready', version: 'model-v1' },
      }),
    }),
  );
  const unavailable = await getHealthStatus(
    {
      ORAL_MODEL_API_URL: 'http://model-service:8000',
      ORAL_MODEL_API_TOKEN: 'server-only-token',
      STORAGE_BACKEND: 'local',
    },
    storageService,
    async () => {
      throw new Error('model endpoint unavailable');
    },
  );

  assert.equal(ready.storage, 'ok');
  assert.equal(ready.model, 'ready');
  assert.equal(ready.modelLoaded, true);
  assert.equal(ready.modelVersion, 'model-v1');
  assert.equal(unavailable.storage, 'ok');
  assert.equal(unavailable.model, 'unavailable');
  assert.equal(unavailable.modelLoaded, false);
});

test('unknown routes use the standard API error shape', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/does-not-exist`);
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.deepEqual(Object.keys(body).sort(), ['code', 'details', 'message', 'success']);
    assert.equal(body.success, false);
    assert.equal(body.code, 'NOT_FOUND');
  });
});

test('assistant endpoints are mounted under the requested and versioned API paths', async () => {
  await withServer(async (baseUrl) => {
    for (const path of ['/api/assistant', '/api/v1/assistant']) {
      const response = await fetch(baseUrl + path, { method: 'POST' });
      const body = await response.json();
      assert.equal(response.status, 401);
      assert.equal(body.code, 'AUTHENTICATION_REQUIRED');
    }
  });
});

test('API rejects cross-origin requests outside the configured client origin', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { Origin: 'https://untrusted.example' },
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.code, 'ORIGIN_NOT_ALLOWED');
    assert.equal(body.success, false);
  });
});

test('development CORS allows either local Vite loopback hostname', async () => {
  await withServer(async (baseUrl) => {
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
      const response = await fetch(`${baseUrl}/api/v1/health`, {
        headers: { Origin: origin },
      });

      assert.equal(response.headers.get('access-control-allow-origin'), origin);
    }
  });
});

test('malformed JSON receives a safe and actionable API error', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid',
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(Object.keys(body).sort(), ['code', 'details', 'message', 'success']);
    assert.equal(body.code, 'INVALID_JSON');
    assert.match(body.message, /try again/i);
    assert.equal(body.stack, undefined);
  });
});

test('auth endpoints are mounted and validate input without exposing details', async () => {
  await withServer(async (baseUrl) => {
    const invalidRoleLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'staff-001', password: 'password', role: 'patient' }),
    });
    assert.equal(invalidRoleLogin.status, 400);
    assert.equal((await invalidRoleLogin.json()).code, 'VALIDATION_ERROR');

    const publicAdminRequest = await fetch(`${baseUrl}/api/v1/staff-access-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Example Applicant',
        email: 'applicant@example.test',
        phone: '+919876543210',
        district: 'Example District',
        requestedRole: 'admin',
      }),
    });
    assert.equal(publicAdminRequest.status, 400);
    assert.equal((await publicAdminRequest.json()).code, 'VALIDATION_ERROR');

    const invalidPatientLogin = await fetch(`${baseUrl}/api/v1/auth/patient/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: '9876543210' }),
    });
    assert.equal(invalidPatientLogin.status, 400);
    assert.equal((await invalidPatientLogin.json()).code, 'VALIDATION_ERROR');

    const invalidPatientActivation = await fetch(
      `${baseUrl}/api/v1/auth/patient/password/activate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activationCode: 'a'.repeat(24), newPassword: 'weak' }),
      },
    );
    assert.equal(invalidPatientActivation.status, 400);
    assert.equal((await invalidPatientActivation.json()).code, 'VALIDATION_ERROR');

    const invalidRegistrationRequest = await fetch(
      `${baseUrl}/api/v1/auth/patient/register/request-otp`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: 'Patient Example',
          phone: '1234567890',
          password: 'weak',
        }),
      },
    );
    assert.equal(invalidRegistrationRequest.status, 400);
    assert.equal((await invalidRegistrationRequest.json()).code, 'VALIDATION_ERROR');

    const invalidRegistrationVerify = await fetch(
      `${baseUrl}/api/v1/auth/patient/register/verify-otp`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '1234567890', challengeId: 'invalid', code: '123' }),
      },
    );
    assert.equal(invalidRegistrationVerify.status, 400);
    assert.equal((await invalidRegistrationVerify.json()).code, 'VALIDATION_ERROR');

    const privateProfile = await fetch(`${baseUrl}/api/v1/users/me`);
    const unauthenticated = await privateProfile.json();
    assert.equal(privateProfile.status, 401);
    assert.equal(unauthenticated.code, 'AUTHENTICATION_REQUIRED');

    const refresh = await fetch(`${baseUrl}/api/v1/auth/refresh`, { method: 'POST' });
    assert.equal(refresh.status, 204);
    assert.equal(await refresh.text(), '');

    const invalidRefresh = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: 'aarogya_refresh=invalid' },
    });
    const expiredSession = await invalidRefresh.json();
    assert.equal(invalidRefresh.status, 401);
    assert.equal(expiredSession.code, 'REFRESH_INVALID');
  });
});

test('patient screening, appointment, and doctor workflow routes require authentication', async () => {
  await withServer(async (baseUrl) => {
    const requests = [
      fetch(`${baseUrl}/api/v1/patients/me/screenings`, { method: 'POST' }),
      fetch(`${baseUrl}/api/v1/patients/me/screenings`),
      fetch(`${baseUrl}/api/v1/admin/demo-providers`),
      fetch(`${baseUrl}/api/v1/staff-access-requests`),
      fetch(`${baseUrl}/api/v1/appointments/mine`),
      fetch(`${baseUrl}/api/v1/doctor/cases`),
      fetch(`${baseUrl}/api/v1/doctor/qr/scan`, { method: 'POST' }),
      fetch(`${baseUrl}/api/v1/patients/me/qr`, { method: 'POST' }),
      fetch(`${baseUrl}/api/v1/patients/me/qr`, { method: 'DELETE' }),
      fetch(`${baseUrl}/api/v1/field/registrations/${'a'.repeat(24)}/patient-password-activation`, {
        method: 'POST',
      }),
    ];
    const responses = await Promise.all(requests);
    for (const response of responses) {
      const body = await response.json();
      assert.equal(response.status, 401);
      assert.equal(body.code, 'AUTHENTICATION_REQUIRED');
    }
  });
});

test('patient API allows a normal dashboard request burst without exhausting its rate limit', async () => {
  await withServer(async (baseUrl) => {
    const responses = await Promise.all(
      Array.from({ length: 65 }, () => fetch(`${baseUrl}/api/v1/patients/me/screenings`)),
    );

    assert.ok(responses.every((response) => response.status === 401));
  });
});
