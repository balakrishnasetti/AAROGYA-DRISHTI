import rateLimit from 'express-rate-limit';

export function createOtpSendIpLimiter() {
  return rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      success: false,
      code: 'RATE_LIMITED',
      message: 'Too many code requests. Please wait before trying again.',
      details: null,
    },
  });
}
