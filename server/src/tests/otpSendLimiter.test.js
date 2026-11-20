import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createOtpSendIpLimiter } from '../middleware/otpSendLimiter.js';

test('OTP send routes enforce the per-IP request limit', async () => {
  const app = express();
  app.post('/auth/otp/send', createOtpSendIpLimiter(), (req, res) => res.status(202).end());
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  try {
    for (let request = 0; request < 10; request += 1) {
      const response = await fetch(`http://127.0.0.1:${port}/auth/otp/send`, { method: 'POST' });
      assert.equal(response.status, 202);
    }

    const limited = await fetch(`http://127.0.0.1:${port}/auth/otp/send`, { method: 'POST' });
    const body = await limited.json();
    assert.equal(limited.status, 429);
    assert.equal(body.code, 'RATE_LIMITED');
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
