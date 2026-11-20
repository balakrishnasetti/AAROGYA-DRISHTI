export const OTP_LIFETIME_MS = 5 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 30 * 1000;
export const OTP_SEND_WINDOW_MS = 10 * 60 * 1000;
export const OTP_SEND_LIMIT = 3;
export const OTP_FAILURE_LIMIT = 5;
export const OTP_FAILURE_LOCKOUT_MS = 15 * 60 * 1000;
export const OTP_CAPTCHA_THRESHOLD = 3;

export function getOtpSendLimit(sendTimestamps = [], now = new Date()) {
  const nowMs = now.getTime();
  const recent = sendTimestamps
    .map((timestamp) => new Date(timestamp).getTime())
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > nowMs - OTP_SEND_WINDOW_MS)
    .sort((left, right) => left - right);

  if (recent.length >= OTP_SEND_LIMIT) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + OTP_SEND_WINDOW_MS - nowMs) / 1000)),
      reason: 'send_limit',
    };
  }

  const lastSentAt = recent.at(-1);
  if (lastSentAt !== undefined && nowMs - lastSentAt < OTP_RESEND_COOLDOWN_MS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((OTP_RESEND_COOLDOWN_MS - (nowMs - lastSentAt)) / 1000),
      reason: 'resend_cooldown',
    };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export function otpFailureUpdate(state = {}, now = new Date()) {
  const nowMs = now.getTime();
  const startedAt = state.failureWindowStartedAt
    ? new Date(state.failureWindowStartedAt).getTime()
    : 0;
  const windowExpired = !Number.isFinite(startedAt) || startedAt <= nowMs - OTP_FAILURE_LOCKOUT_MS;
  const failedAttempts = (windowExpired ? 0 : state.failedAttempts ?? 0) + 1;
  const locked = failedAttempts >= OTP_FAILURE_LIMIT;

  return {
    failedAttempts,
    failureWindowStartedAt: windowExpired ? now : new Date(startedAt),
    lockedUntil: locked ? new Date(nowMs + OTP_FAILURE_LOCKOUT_MS) : null,
    captchaRequired: failedAttempts >= OTP_CAPTCHA_THRESHOLD && !locked,
    locked,
  };
}

export function otpLockIsActive(state, now = new Date()) {
  return Boolean(state?.lockedUntil && new Date(state.lockedUntil).getTime() > now.getTime());
}

export function isOtpUsable(otp, now = new Date()) {
  return Boolean(
    otp &&
      !otp.consumedAt &&
      new Date(otp.expiresAt).getTime() > now.getTime() &&
      otp.attempts < OTP_FAILURE_LIMIT,
  );
}
