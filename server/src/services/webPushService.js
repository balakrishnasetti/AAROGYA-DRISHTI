import { createRequire } from 'node:module';
import { PushSubscription } from '../models/index.js';

const webPush = createRequire(import.meta.url)('web-push');

const allowedPushHosts = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
  'wns.windows.com',
];

export function isAllowedPushEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === 'https:' &&
      allowedPushHosts.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    );
  } catch {
    return false;
  }
}

export function createWebPushService(environment, subscriptionModel = PushSubscription) {
  const enabled = Boolean(environment.VAPID_PUBLIC_KEY && environment.VAPID_PRIVATE_KEY);
  if (enabled) {
    webPush.setVapidDetails(
      environment.VAPID_SUBJECT,
      environment.VAPID_PUBLIC_KEY,
      environment.VAPID_PRIVATE_KEY,
    );
  }

  return {
    publicKey: enabled ? environment.VAPID_PUBLIC_KEY : '',
    async sendToUser(userId, payload) {
      if (!enabled) return;
      const subscriptions = await subscriptionModel.find({ userId }).lean();
      await Promise.all(
        subscriptions.map(async (subscription) => {
          if (!isAllowedPushEndpoint(subscription.endpoint)) {
            await subscriptionModel.deleteOne({ _id: subscription._id });
            return;
          }
          try {
            await webPush.sendNotification(
              { endpoint: subscription.endpoint, keys: subscription.keys },
              JSON.stringify(payload),
              { TTL: 300, urgency: 'high' },
            );
            await subscriptionModel.updateOne(
              { _id: subscription._id },
              { $set: { lastUsedAt: new Date() } },
            );
          } catch (error) {
            if ([404, 410].includes(error.statusCode)) {
              await subscriptionModel.deleteOne({ _id: subscription._id });
            } else {
              console.warn(`Web Push delivery failed (${error.statusCode || 'unknown'}).`);
            }
          }
        }),
      );
    },
  };
}
