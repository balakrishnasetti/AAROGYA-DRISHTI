import { addOutboxOperation, getPendingOperations, updateOutboxStatus } from '../lib/offlineStore.js';
import api from './api.js';

export function createClientOpId() {
  return crypto.randomUUID();
}

export async function queueOfflineWrite({ route, method = 'POST', payload = {}, kind = 'generic' }) {
  const operation = await addOutboxOperation({
    clientOpId: createClientOpId(),
    route,
    method,
    payload,
    kind,
    status: 'pending',
  });
  return operation;
}

export async function syncPendingOperations() {
  if (!navigator.onLine) {
    return { sent: 0, skipped: true, operations: [] };
  }

  const pending = await getPendingOperations();
  if (!pending.length) {
    return { sent: 0, skipped: false, operations: [] };
  }

  const response = await api.post('/sync/batch', {
    operations: pending.map((item) => ({
      clientOpId: item.clientOpId,
      route: item.route,
      method: item.method,
      payload: item.payload,
      kind: item.kind,
    })),
  });
  const result = response.data;
  for (const item of pending) {
    const outcome = result?.data?.results?.find((entry) => entry.clientOpId === item.clientOpId);
    const nextStatus = outcome?.status === 'duplicate' ? 'duplicate' : outcome?.status === 'sent' ? 'sent' : 'failed';
    await updateOutboxStatus(item.clientOpId, nextStatus, {
      attempts: (item.attempts || 0) + 1,
      lastOutcome: outcome?.status || 'sent',
    });
  }

  return { sent: result?.data?.results?.length || 0, skipped: false, operations: result?.data?.results || [] };
}
