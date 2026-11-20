import cron from 'node-cron';
import { EventEmitter } from 'node:events';
import { Notification } from '../models/index.js';

export const NOTIFICATION_TEMPLATES = {
  request: {
    titleKey: 'Appointment request',
    bodyKey: 'A new appointment request is waiting for review.',
  },
  requested: {
    titleKey: 'Appointment request received',
    bodyKey: 'Your appointment request was sent to the provider.',
  },
  accepted: {
    titleKey: 'Appointment accepted',
    bodyKey: 'Your appointment request has been accepted.',
  },
  confirmed: {
    titleKey: 'Appointment confirmed',
    bodyKey: 'Your appointment is confirmed for the selected date and time.',
  },
  declined: {
    titleKey: 'Appointment update',
    bodyKey: 'Your appointment request could not be accommodated.',
  },
  cancelled: {
    titleKey: 'Appointment cancelled',
    bodyKey: 'Your appointment has been cancelled.',
  },
  reminder: {
    titleKey: 'Appointment reminder',
    bodyKey: 'A reminder is ready for your upcoming appointment.',
  },
  urgent_request: {
    titleKey: 'Urgent care request',
    bodyKey: 'We have received an urgent care request and are reviewing the next step.',
  },
  urgent_response: {
    titleKey: 'Urgent care update',
    bodyKey: 'The urgent care request has been updated.',
  },
  report: {
    titleKey: 'New screening report',
    bodyKey: 'A new screening report is available for review.',
  },
  follow_up: {
    titleKey: 'Follow-up needed',
    bodyKey: 'A follow-up is scheduled for a later review.',
  },
};

export function createNotificationTemplate(type, overrides = {}) {
  const base = NOTIFICATION_TEMPLATES[type] ?? {
    titleKey: 'Update',
    bodyKey: 'A new update is available.',
  };

  return {
    ...base,
    ...overrides,
  };
}

export function createNotificationService({
  notificationModel = Notification,
  emailProvider = null,
  smsProvider = null,
  realtimeEmitter = new EventEmitter(),
  logger = console,
} = {}) {
  return {
    notificationModel,
    templates: NOTIFICATION_TEMPLATES,

    async createNotification({
      userId,
      type,
      titleKey,
      bodyKey,
      channel = 'in_app',
      templateKey,
      resourceType,
      resourceId,
      metadata = {},
    }) {
      const resolved = createNotificationTemplate(type, {
        titleKey: titleKey ?? templateKey ?? NOTIFICATION_TEMPLATES[type]?.titleKey,
        bodyKey: bodyKey ?? NOTIFICATION_TEMPLATES[type]?.bodyKey,
      });

      const record = await notificationModel.create({
        userId,
        type,
        titleKey: resolved.titleKey,
        bodyKey: resolved.bodyKey,
        channel,
        templateKey: templateKey ?? type,
        resourceType,
        resourceId,
        metadata,
      });

      realtimeEmitter.emit('notification', {
        userId,
        type,
        channel,
        resourceType,
        resourceId,
        metadata,
        notification: record.toObject(),
      });

      if (channel === 'email' && emailProvider?.sendMessage) {
        await emailProvider.sendMessage({ userId, type, metadata });
      }

      if (channel === 'sms' && smsProvider?.sendMessage) {
        await smsProvider.sendMessage({ userId, type, metadata });
      }

      logger.info?.(`Notification queued: ${type} for ${String(userId)}`);
      return record;
    },

    async deliverEmail({ email, type, metadata = {} }) {
      if (!emailProvider?.sendMessage) {
        return null;
      }

      return emailProvider.sendMessage({ email, type, metadata });
    },

    async deliverSms({ phone, type, metadata = {} }) {
      if (!smsProvider?.sendMessage) {
        return null;
      }

      return smsProvider.sendMessage({ phone, type, metadata });
    },

    scheduleReminderJob(cronExpression, callback) {
      return cron.schedule(cronExpression, callback, { scheduled: true });
    },
  };
}

export const notificationService = createNotificationService();
