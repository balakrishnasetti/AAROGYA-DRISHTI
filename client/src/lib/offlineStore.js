import Dexie from 'dexie';

const db = new Dexie('aarogyaOfflineStore');

db.version(1).stores({
  ownRecords: '++id, userId, kind, syncedAt',
  reminders: '++id, dueAt, status, reminderType',
  downloads: '++id, resourceName, createdAt',
  outbox: '++id, clientOpId, status, createdAt, nextRetryAt, attempts',
  cacheMeta: 'key',
  sensitive: '++id, category, createdAt',
});

async function deriveKey() {
  const material = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode('aarogya-dr-ishti-offline-secret-v1'),
  );
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptValue(value) {
  const key = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return {
    iv: Array.from(iv),
    value: Array.from(new Uint8Array(encrypted)),
  };
}

async function decryptValue(payload) {
  if (!payload || !payload.iv || !payload.value) return null;
  const key = await deriveKey();
  const iv = new Uint8Array(payload.iv);
  const encoded = new Uint8Array(payload.value);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encoded.buffer);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

export async function saveSensitiveRecord(category, value) {
  const payload = await encryptValue(value);
  await db.sensitive.put({ category, payload, createdAt: new Date().toISOString() });
}

export async function readSensitiveRecord(category) {
  const row = await db.sensitive.where('category').equals(category).first();
  if (!row) return null;
  return decryptValue(row.payload);
}

export async function wipeSensitiveData() {
  await db.sensitive.clear();
  await db.outbox.clear();
  await db.cacheMeta.clear();
}

export async function listOutboxOperations() {
  return db.outbox.orderBy('createdAt').reverse().toArray();
}

export async function addOutboxOperation(operation) {
  const isSensitive = operation.kind === 'field_registration';
  const record = {
    clientOpId: operation.clientOpId || crypto.randomUUID(),
    route: operation.route,
    method: operation.method || 'POST',
    payload: isSensitive ? await encryptValue(operation.payload || {}) : operation.payload || {},
    payloadEncrypted: isSensitive,
    status: operation.status || 'pending',
    attempts: operation.attempts || 0,
    nextRetryAt: operation.nextRetryAt || Date.now(),
    createdAt: operation.createdAt || new Date().toISOString(),
    kind: operation.kind || 'generic',
  };
  await db.outbox.put(record);
  return record;
}

export async function updateOutboxStatus(clientOpId, status, extra = {}) {
  const row = await db.outbox.where('clientOpId').equals(clientOpId).first();
  if (!row) return null;
  await db.outbox.update(row.id, { status, ...extra, updatedAt: new Date().toISOString() });
  return row;
}

export async function getPendingOperations() {
  const records = await db.outbox.where('status').equals('pending').sortBy('createdAt');
  return Promise.all(records.map(async (record) => ({
    ...record,
    payload: record.payloadEncrypted ? await decryptValue(record.payload) : record.payload,
  })));
}

export async function clearAllOfflineStorage() {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
}

export { db };
