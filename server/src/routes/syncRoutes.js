import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { FieldRegistration, SyncOperation } from '../models/index.js';
import { registerFieldPatient } from './fieldWorkRoutes.js';
import { ApiError } from '../utils/apiError.js';

const syncBatchSchema = z.object({
  operations: z
    .array(
      z.object({
        clientOpId: z.string().uuid(),
        route: z.string().trim().min(1).max(200),
        method: z.enum(['POST', 'PATCH', 'PUT', 'DELETE']).default('POST'),
        payload: z.any().default({}),
        kind: z.string().trim().max(80).default('generic'),
      }),
    ).max(50)
    .default([]),
});

export function createSyncRoutes(environment) {
  const router = Router();

  router.use(authenticate(environment));

  router.post(
    '/batch',
    asyncHandler(async (req, res) => {
      const { operations } = syncBatchSchema.parse(req.body || {});
      const results = [];

      for (const operation of operations) {
        if (
          operation.kind === 'field_registration' &&
          operation.payload?.clientOpId !== operation.clientOpId
        ) {
          throw new ApiError(400, 'SYNC_OPERATION_INVALID', 'Offline registration IDs must match their queued operation.');
        }
        const existing = await SyncOperation.findOne({ clientOpId: operation.clientOpId }).lean();

        if (existing) {
          if (existing.userId?.toString() !== req.user.id.toString()) {
            throw new ApiError(409, 'SYNC_OPERATION_CONFLICT', 'That offline operation ID has already been used.');
          }
          if (existing.kind === 'field_registration' && ['pending', 'failed'].includes(existing.status)) {
            if (
              req.user.role !== 'health_worker' ||
              operation.route !== '/field/registrations' ||
              operation.method !== 'POST' ||
              operation.kind !== 'field_registration'
            ) {
              throw new ApiError(403, 'SYNC_OPERATION_FORBIDDEN', 'That offline registration cannot be replayed by this account.');
            }
            const result = await registerFieldPatient({
              payload: operation.payload,
              user: req.user,
              requestId: req.id,
              environment,
            });
            await SyncOperation.updateOne(
              { _id: existing._id, userId: req.user.id },
              { $set: { status: 'sent', lastError: '' }, $inc: { retries: 1 } },
            );
            results.push({
              clientOpId: operation.clientOpId,
              status: 'sent',
              registrationId: result.registrationId.toString(),
            });
            continue;
          }
          const fieldRegistration = existing.kind === 'field_registration'
            ? await FieldRegistration.findOne({
                clientOpId: operation.clientOpId,
                registeredBy: req.user.id,
              }).select('_id').lean()
            : null;
          results.push({
            clientOpId: operation.clientOpId,
            status: 'duplicate',
            ...(fieldRegistration ? { registrationId: fieldRegistration._id.toString() } : {}),
          });
          continue;
        }

        if (operation.kind === 'field_registration') {
          if (
            req.user.role !== 'health_worker' ||
            operation.route !== '/field/registrations' ||
            operation.method !== 'POST'
          ) {
            throw new ApiError(403, 'SYNC_OPERATION_FORBIDDEN', 'That offline registration cannot be replayed by this account.');
          }
          const record = await SyncOperation.create({
            userId: req.user.id,
            clientOpId: operation.clientOpId,
            route: operation.route,
            method: operation.method,
            payload: {},
            kind: operation.kind,
            status: 'pending',
          });
          const result = await registerFieldPatient({
            payload: operation.payload,
            user: req.user,
            requestId: req.id,
            environment,
          });
          await SyncOperation.updateOne(
            { _id: record._id, userId: req.user.id },
            { $set: { status: 'sent' } },
          );
          results.push({
            clientOpId: record.clientOpId,
            status: 'sent',
            registrationId: result.registrationId.toString(),
          });
          continue;
        }

        const record = await SyncOperation.create({
          userId: req.user?.id,
          clientOpId: operation.clientOpId,
          route: operation.route,
          method: operation.method,
          payload: operation.payload || {},
          kind: operation.kind || 'generic',
          status: 'sent',
        });

        results.push({ clientOpId: record.clientOpId, status: 'sent', id: record._id.toString() });
      }

      res.json({
        success: true,
        data: {
          processed: results.length,
          results,
        },
      });
    }),
  );

  return router;
}
