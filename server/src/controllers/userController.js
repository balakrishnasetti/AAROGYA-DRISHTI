import { ApiError } from '../utils/apiError.js';

export function createUserController({ authService }) {
  return {
    getMe: async (req, res) => {
      const user = await authService.getMe(req.user, req);
      res.json({
        success: true,
        code: 'USER_PROFILE',
        message: 'Your profile is ready.',
        details: user,
      });
    },
    updateMe: async (req, res) => {
      const user = await authService.updateMe(req.user.id, req.body, req);
      res.json({
        success: true,
        code: 'USER_UPDATED',
        message: 'Your profile was updated.',
        details: user,
      });
    },
    listSessions: async (req, res) => {
      const sessions = await authService.listSessions(req.user.id, req.user.sessionId, req);
      res.json({
        success: true,
        code: 'SESSIONS',
        message: 'Your active sessions are ready.',
        details: sessions,
      });
    },
    revokeSession: async (req, res) => {
      await authService.revokeSession(req.user.id, req.params.sessionId, req);
      res.json({
        success: true,
        code: 'SESSION_REVOKED',
        message: 'That session was signed out.',
        details: null,
      });
    },
    changeRole: async (req, res) => {
      const user = await authService.changeRole(req.user, req.params.userId, req.body.role, req);
      res.json({
        success: true,
        code: 'ROLE_CHANGED',
        message: 'The user role was changed.',
        details: user,
      });
    },
  };
}

export function validateObjectIdParam(parameter) {
  return (req, res, next) => {
    if (!/^[a-f\d]{24}$/i.test(req.params[parameter] ?? '')) {
      return next(new ApiError(400, 'INVALID_ID', 'That ID is not valid. Check it and try again.'));
    }
    return next();
  };
}
