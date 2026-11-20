import { AuditLog } from '../models/index.js';

export function writeAuditLog({
  actorId = null,
  action,
  severity = 'medium',
  resourceType,
  resourceId = null,
  hospitalId = null,
  requestId = null,
  metadata = {},
}) {
  const safeMetadata = Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, String(value).slice(0, 200)]),
  );

  return AuditLog.create({
    actorId,
    action,
    severity,
    resourceType,
    resourceId,
    hospitalId,
    requestId,
    metadata: safeMetadata,
    occurredAt: new Date(),
  });
}
