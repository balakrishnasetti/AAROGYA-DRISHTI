import {
  AuditLog,
  Notification,
  SecurityAlert,
  User,
} from '../models/index.js';
import { writeAuditLog } from './auditService.js';

const ACCESS_WINDOW_MS = 5 * 60 * 1000;
const ALERT_THRESHOLD = 25;

export async function monitorPatientAccess({ actorId, requestId }) {
  if (!actorId) return;
  const since = new Date(Date.now() - ACCESS_WINDOW_MS);
  const recentAccessCount = await AuditLog.countDocuments({
    actorId,
    resourceType: 'patient',
    action: { $in: ['read', 'break_glass'] },
    occurredAt: { $gte: since },
  });
  if (recentAccessCount < ALERT_THRESHOLD) return;

  const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
  let alert;
  try {
    alert = await SecurityAlert.create({
      actorId,
      alertType: 'unusual_patient_record_access',
      dedupeKey: `${actorId.toString()}:patient-access:${bucket}`,
      detectedAt: new Date(),
      metadata: { accessCount: recentAccessCount, windowMinutes: 5 },
    });
  } catch (error) {
    if (error.code === 11000) return;
    throw error;
  }

  const admins = await User.find({ role: 'admin', status: 'active' }).select('_id').limit(50).lean();
  if (admins.length) {
    await Notification.insertMany(
      admins.map((admin) => ({
        userId: admin._id,
        type: 'security_access_anomaly',
        titleKey: 'notification.securityAccessAnomaly.title',
        bodyKey: 'notification.securityAccessAnomaly.body',
        channel: 'in_app',
        templateKey: 'security_access_anomaly',
        resourceType: 'security_alert',
        resourceId: alert._id,
        metadata: { alertId: alert._id.toString() },
        deliveryStatus: 'queued',
      })),
    );
  }
  await writeAuditLog({
    actorId,
    action: 'create',
    severity: 'high',
    resourceType: 'security_alert',
    resourceId: alert._id.toString(),
    requestId,
    metadata: { alertType: alert.alertType, accessCount: recentAccessCount },
  });
}
