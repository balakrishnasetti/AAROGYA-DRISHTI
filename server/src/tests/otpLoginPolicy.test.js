import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getOtpSendLimit,
  isOtpUsable,
  otpFailureUpdate,
  otpLockIsActive,
  OTP_FAILURE_LOCKOUT_MS,
  OTP_LIFETIME_MS,
  OTP_SEND_WINDOW_MS,
} from '../services/otpLoginPolicy.js';
import { indianMobileSchema, otpDemoRequestSchema } from '../validators/authValidators.js';

test('OTP expiry and single-use state reject expired and replayed codes', () => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_LIFETIME_MS);

  assert.equal(isOtpUsable({ expiresAt, attempts: 0 }, now), true);
  assert.equal(isOtpUsable({ expiresAt: new Date(now.getTime() - 1), attempts: 0 }, now), false);
  assert.equal(isOtpUsable({ expiresAt, attempts: 0, consumedAt: now }, now), false);
});

test('OTP verification locks for 15 minutes after five failed attempts', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  let state = {};

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    state = otpFailureUpdate(state, new Date(start.getTime() + attempt * 1000));
    assert.equal(state.failedAttempts, attempt);
    assert.equal(state.locked, false);
  }

  state = otpFailureUpdate(state, new Date(start.getTime() + 5000));
  assert.equal(state.failedAttempts, 5);
  assert.equal(state.locked, true);
  assert.equal(state.lockedUntil.getTime(), start.getTime() + 5_000 + OTP_FAILURE_LOCKOUT_MS);
  assert.equal(otpLockIsActive(state, new Date(start.getTime() + 6000)), true);
  assert.equal(
    otpLockIsActive(state, new Date(start.getTime() + 5_000 + OTP_FAILURE_LOCKOUT_MS)),
    false,
  );
});

test('OTP CAPTCHA is required after three incorrect entries before lockout', () => {
  const now = new Date();
  let state = {};

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    state = otpFailureUpdate(state, new Date(now.getTime() + attempt));
  }

  assert.equal(state.captchaRequired, true);
  assert.equal(state.locked, false);
});

test('OTP sends enforce a 30-second resend delay and three sends in ten minutes', () => {
  const now = new Date();
  assert.equal(getOtpSendLimit([], now).allowed, true);

  const first = new Date(now.getTime() - 20_000);
  assert.deepEqual(getOtpSendLimit([first], now), {
    allowed: false,
    retryAfterSeconds: 10,
    reason: 'resend_cooldown',
  });

  const timestamps = [
    new Date(now.getTime() - 120_000),
    new Date(now.getTime() - 80_000),
    new Date(now.getTime() - 40_000),
  ];
  assert.equal(getOtpSendLimit(timestamps, now).allowed, false);
  assert.equal(
    getOtpSendLimit([new Date(now.getTime() - OTP_SEND_WINDOW_MS - 1)], now).allowed,
    true,
  );
});

test('OTP phone validation accepts Indian mobile numbers and rejects invalid or foreign numbers', () => {
  assert.equal(indianMobileSchema.parse('9876543210'), '+919876543210');
  assert.equal(indianMobileSchema.parse('+91 98765 43210'), '+919876543210');
  assert.equal(indianMobileSchema.safeParse('1234567890').success, false);
  assert.equal(indianMobileSchema.safeParse('+14155552671').success, false);
});

test('synthetic OTP phones remain valid only through the explicit development schema', () => {
  assert.equal(otpDemoRequestSchema.safeParse({ phone: '+910000000001' }).success, true);
  assert.equal(otpDemoRequestSchema.safeParse({ phone: '+910000000021' }).success, false);
});
