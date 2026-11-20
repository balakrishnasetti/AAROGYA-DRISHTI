import { ApiError } from '../utils/apiError.js';

const COOKIE_NAME = 'aarogya_refresh';
const COOKIE_PATH = '/api/v1/auth';

function cookieOptions(environment) {
  return {
    httpOnly: true,
    secure: environment.NODE_ENV === 'production',
    sameSite: 'strict',
    path: COOKIE_PATH,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

function setRefreshCookie(res, token, environment) {
  res.cookie(COOKIE_NAME, token, cookieOptions(environment));
}

function clearRefreshCookie(res, environment) {
  res.clearCookie(COOKIE_NAME, {
    ...cookieOptions(environment),
    maxAge: undefined,
  });
}

function sendSession(res, session, environment) {
  setRefreshCookie(res, session.refreshToken, environment);
  return res.json({
    success: true,
    code: 'AUTHENTICATED',
    message: 'You are signed in.',
    details: {
      accessToken: session.accessToken,
      accessExpiresIn: session.accessExpiresIn,
      user: session.user,
    },
  });
}

export function createAuthController({ authService, environment }) {
  return {
    staffLogin: async (req, res) => {
      const result = await authService.staffLogin(req.body, req);
      if (result.flow) {
        return res.json({
          success: true,
          code: result.flow.toUpperCase(),
          message: 'Complete the next sign-in step to continue.',
          details: result,
        });
      }
      return sendSession(res, result, environment);
    },
    patientLogin: async (req, res) => {
      const session = await authService.patientLogin(req.body, req);
      return sendSession(res, session, environment);
    },
    requestPatientRegistrationOtp: async (req, res) => {
      const details = await authService.requestPatientRegistrationOtp(req.body, req);
      res.json({
        success: true,
        code: 'PATIENT_REGISTRATION_CODE_SENT',
        message: 'If this mobile number can receive a code, one has been sent.',
        details,
      });
    },
    verifyPatientRegistrationOtp: async (req, res) => {
      const result = await authService.verifyPatientRegistrationOtp(req.body, req);
      res.status(201).json({
        success: true,
        code: 'PATIENT_REGISTERED',
        message: 'Your patient account is ready. Sign in with your phone number and password.',
        details: result,
      });
    },
    activatePatientPassword: async (req, res) => {
      await authService.activatePatientPassword(req.body, req);
      res.json({
        success: true,
        code: 'PATIENT_PASSWORD_ACTIVATED',
        message: 'Your password is ready. Sign in to continue.',
        details: null,
      });
    },
    changePassword: async (req, res) => {
      const userId = req.flow?.userId ?? req.user?.id;
      if (!userId) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in again to continue.');
      await authService.changePassword(userId, req.body, Boolean(req.flow), req);
      clearRefreshCookie(res, environment);
      res.json({
        success: true,
        code: 'PASSWORD_CHANGED',
        message: 'Your password was changed. Sign in again to continue.',
        details: null,
      });
    },
    forgotPassword: async (req, res) => {
      await authService.forgotPassword(req.body.identifier, req);
      res.json({
        success: true,
        code: 'RESET_LINK_SENT',
        message: 'If the account is eligible, a password reset link has been sent.',
        details: null,
      });
    },
    resetPassword: async (req, res) => {
      await authService.resetPassword(req.body.token, req.body.newPassword, req);
      clearRefreshCookie(res, environment);
      res.json({
        success: true,
        code: 'PASSWORD_RESET',
        message: 'Your password was reset. Sign in with your new password.',
        details: null,
      });
    },
    refresh: async (req, res) => {
      if (!req.cookies?.[COOKIE_NAME]) return res.status(204).end();
      try {
        const session = await authService.refresh(req.cookies?.[COOKIE_NAME], req);
        return sendSession(res, session, environment);
      } catch (error) {
        if (error.status === 401) clearRefreshCookie(res, environment);
        throw error;
      }
    },
    logout: async (req, res) => {
      await authService.logout(req.user.id, req.user.sessionId, req);
      clearRefreshCookie(res, environment);
      res.json({
        success: true,
        code: 'LOGGED_OUT',
        message: 'You are signed out.',
        details: null,
      });
    },
  };
}

export { COOKIE_NAME };
