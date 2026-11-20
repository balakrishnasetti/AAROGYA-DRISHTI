import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { createAuthController } from '../controllers/authController.js';
import { authenticate, authenticateFlow } from '../middleware/authenticate.js';
import { validateBody } from '../middleware/validate.js';
import {
  forgotPasswordSchema,
  patientLoginSchema,
  patientPasswordActivationSchema,
  patientRegistrationDemoRequestSchema,
  patientRegistrationDemoVerifySchema,
  patientRegistrationRequestSchema,
  patientRegistrationVerifySchema,
  passwordChangeSchema,
  resetPasswordSchema,
  staffLoginSchema,
} from '../validators/authValidators.js';
import { createAuthService } from '../services/authService.js';
import { createEmailProvider } from '../services/emailService.js';
import { createSmsProvider } from '../services/smsService.js';
import { createOtpSendIpLimiter } from '../middleware/otpSendLimiter.js';

export function createAuthRoutes(environment) {
  const router = Router();
  const createLimiter = (limit, windowMs = 15 * 60 * 1000, options = {}) =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      ...options,
      message: {
        success: false,
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please wait a few minutes and try again.',
        details: null,
      },
    });
  const setAuthMethod = (method) => (req, res, next) => {
    req.authMethod = method;
    next();
  };
  router.use(createLimiter(30, 15 * 60 * 1000, { skipSuccessfulRequests: true }));
  const authService = createAuthService({
    environment,
    smsProvider: createSmsProvider({ environment }),
    emailProvider: createEmailProvider(environment),
  });
  const controller = createAuthController({ authService, environment });
  const demoPatientRegistrationEnabled =
    environment.NODE_ENV === 'development' && environment.SEED_DEMO === true;
  router.post(
    '/login',
    setAuthMethod('manual'),
    createLimiter(10, 15 * 60 * 1000, { skipSuccessfulRequests: true }),
    validateBody(staffLoginSchema),
    asyncHandler(controller.staffLogin),
  );
  router.post(
    '/patient/login',
    setAuthMethod('manual'),
    createLimiter(10, 15 * 60 * 1000, { skipSuccessfulRequests: true }),
    validateBody(patientLoginSchema),
    asyncHandler(controller.patientLogin),
  );
  router.post(
    '/patient/register/request-otp',
    createOtpSendIpLimiter(),
    createLimiter(10),
    validateBody(
      demoPatientRegistrationEnabled
        ? patientRegistrationDemoRequestSchema
        : patientRegistrationRequestSchema,
    ),
    asyncHandler(controller.requestPatientRegistrationOtp),
  );
  router.post(
    '/patient/register/verify-otp',
    createLimiter(10),
    validateBody(
      demoPatientRegistrationEnabled
        ? patientRegistrationDemoVerifySchema
        : patientRegistrationVerifySchema,
    ),
    asyncHandler(controller.verifyPatientRegistrationOtp),
  );
  router.post(
    '/patient/password/activate',
    createLimiter(5),
    validateBody(patientPasswordActivationSchema),
    asyncHandler(controller.activatePatientPassword),
  );
  router.post(
    '/password/change/first',
    authenticateFlow('password_change', environment),
    validateBody(passwordChangeSchema),
    asyncHandler(controller.changePassword),
  );
  router.post(
    '/password/change',
    authenticate(environment),
    validateBody(passwordChangeSchema),
    asyncHandler(controller.changePassword),
  );
  router.post(
    '/password/forgot',
    validateBody(forgotPasswordSchema),
    asyncHandler(controller.forgotPassword),
  );
  router.post(
    '/password/reset',
    validateBody(resetPasswordSchema),
    asyncHandler(controller.resetPassword),
  );
  router.post('/refresh', asyncHandler(controller.refresh));
  router.post('/logout', authenticate(environment), asyncHandler(controller.logout));

  return router;
}
