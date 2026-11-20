import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { createNotificationService } from '../services/notificationService.js';

export function createNotificationRoutes(environment) {
  const router = Router();
  const notificationService = createNotificationService();

  router.use(authenticate(environment));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const notifications = await notificationService.notificationModel
        ? notificationService.notificationModel.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50).lean()
        : [];

      res.json({
        success: true,
        code: 'NOTIFICATIONS',
        message: 'Notifications are ready.',
        details: notifications,
      });
    }),
  );

  router.patch(
    '/:notificationId/read',
    asyncHandler(async (req, res) => {
      const record = await notificationService.notificationModel.findOneAndUpdate(
        { _id: req.params.notificationId, userId: req.user._id },
        { $set: { readAt: new Date() } },
        { new: true },
      );
      if (!record) {
        return res.status(404).json({
          success: false,
          code: 'NOTIFICATION_NOT_FOUND',
          message: 'Notification not found.',
          details: null,
        });
      }

      res.json({
        success: true,
        code: 'NOTIFICATION_READ',
        message: 'Notification marked as read.',
        details: record,
      });
    }),
  );

  return router;
}
