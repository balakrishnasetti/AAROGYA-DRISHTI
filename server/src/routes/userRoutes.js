import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { createUserController, validateObjectIdParam } from '../controllers/userController.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorizePermission } from '../middleware/authorize.js';
import { validateBody } from '../middleware/validate.js';
import { createAuthService } from '../services/authService.js';
import { updateMeSchema, changeRoleSchema } from '../validators/authValidators.js';

export function createUserRoutes(environment) {
  const router = Router();
  const controller = createUserController({ authService: createAuthService({ environment }) });
  router.use(authenticate(environment));
  router.get('/me', asyncHandler(controller.getMe));
  router.patch('/me', validateBody(updateMeSchema), asyncHandler(controller.updateMe));
  router.get('/me/sessions', asyncHandler(controller.listSessions));
  router.delete(
    '/me/sessions/:sessionId',
    validateObjectIdParam('sessionId'),
    asyncHandler(controller.revokeSession),
  );
  router.patch(
    '/:userId/role',
    authorizePermission('platform.roles.manage'),
    validateObjectIdParam('userId'),
    validateBody(changeRoleSchema),
    asyncHandler(controller.changeRole),
  );
  return router;
}
