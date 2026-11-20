import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import {
  createPrivateStorageService,
  getPrivateStorageBackend,
  isPrivateStorageConfigured,
  normalizeImage,
} from '../services/privateStorageService.js';

test('local private storage is the development fallback when S3 is not configured', async (context) => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'aarogya-private-storage-default-'));
  context.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  const environment = {
    LOCAL_STORAGE_DIR: temporaryDirectory,
    STORAGE_BACKEND: 's3',
  };
  const storage = createPrivateStorageService(environment);

  assert.equal(getPrivateStorageBackend(environment), 'local');
  assert.equal(isPrivateStorageConfigured(environment), true);
  assert.deepEqual(await storage.initialize(), { status: 'available', backend: 'local' });
});

test('production never falls back from an incomplete S3 configuration to local storage', () => {
  const environment = {
    NODE_ENV: 'production',
    STORAGE_BACKEND: 's3',
    LOCAL_STORAGE_DIR: './private-storage',
  };

  assert.equal(getPrivateStorageBackend(environment), 's3');
  assert.equal(isPrivateStorageConfigured(environment), false);
});

test('AWS S3 storage configuration does not require a custom endpoint', () => {
  assert.equal(
    isPrivateStorageConfigured({
      STORAGE_BUCKET: 'private-bucket',
      STORAGE_ACCESS_KEY: 'access-key',
      STORAGE_SECRET_KEY: 'secret-key',
      STORAGE_BACKEND: 's3',
    }),
    true,
  );
  assert.equal(
    isPrivateStorageConfigured({
      NODE_ENV: 'production',
      STORAGE_BACKEND: 's3',
      STORAGE_BUCKET: 'private-bucket',
      STORAGE_ACCESS_KEY: 'access-key',
    }),
    false,
  );
});

test('image normalization rejects script content disguised with a PNG signature', async () => {
  const disguised = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.from('<script>alert(1)</script>'),
  ]);
  await assert.rejects(normalizeImage(disguised, 'image/png'), { code: 'FILE_TYPE_INVALID' });
});

test('screening photo storage rejects normalized images larger than one megabyte', async () => {
  const pixels = randomBytes(800 * 800 * 3);
  const image = await sharp(pixels, {
    raw: { width: 800, height: 800, channels: 3 },
  })
    .png()
    .toBuffer();
  const storage = createPrivateStorageService({
    STORAGE_BUCKET: 'private-test-bucket',
    STORAGE_REGION: 'test-region',
    STORAGE_ACCESS_KEY: 'test-access-key',
    STORAGE_SECRET_KEY: 'test-secret-key',
  });
  await assert.rejects(
    storage.storeScreeningPhoto({
      patientId: 'patient-id',
      screeningSessionId: 'session-id',
      region: 'tongue_top',
      file: { buffer: image, mimetype: 'image/png' },
    }),
    { code: 'PAYLOAD_TOO_LARGE' },
  );
});

test('screening photo storage reports an unavailable object store without a generic server error', async () => {
  const image = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 120, g: 80, b: 90 } },
  })
    .jpeg()
    .toBuffer();
  const storage = createPrivateStorageService({
    STORAGE_ENDPOINT: 'http://127.0.0.1:1',
    STORAGE_BUCKET: 'private-test-bucket',
    STORAGE_REGION: 'test-region',
    STORAGE_ACCESS_KEY: 'test-access-key',
    STORAGE_SECRET_KEY: 'test-secret-key',
  });

  await assert.rejects(
    storage.storeScreeningPhoto({
      patientId: 'patient-id',
      screeningSessionId: 'session-id',
      region: 'tongue_top',
      file: { buffer: image, mimetype: 'image/jpeg' },
    }),
    {
      status: 503,
      code: 'PRIVATE_STORAGE_UNAVAILABLE',
      message: 'Private image storage is unavailable. Try again later or contact support.',
    },
  );
});

test('private storage checks the configured bucket and reports connection failures', async () => {
  const environment = {
    STORAGE_ENDPOINT: 'http://minio.test:9000',
    STORAGE_BUCKET: 'private-test-bucket',
    STORAGE_REGION: 'test-region',
    STORAGE_ACCESS_KEY: 'test-access-key',
    STORAGE_SECRET_KEY: 'test-secret-key',
  };
  const availableStorage = createPrivateStorageService(environment, {
    clientOverride: { send: async () => ({}) },
  });
  const unavailableStorage = createPrivateStorageService(environment, {
    clientOverride: {
      send: async () => {
        const error = new Error('connection refused');
        error.code = 'ECONNREFUSED';
        throw error;
      },
    },
  });

  assert.equal(await availableStorage.checkAvailability(), 'available');
  assert.equal(await unavailableStorage.checkAvailability(), 'unavailable');
  assert.equal(await createPrivateStorageService({}).checkAvailability(), 'available');
});

test('screening photo uploads cannot report success when the S3-compatible service is down', async () => {
  const image = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 120, g: 80, b: 90 } },
  })
    .jpeg()
    .toBuffer();
  const storage = createPrivateStorageService(
    {
      STORAGE_ENDPOINT: 'http://minio.test:9000',
      STORAGE_BUCKET: 'private-test-bucket',
      STORAGE_REGION: 'test-region',
      STORAGE_ACCESS_KEY: 'test-access-key',
      STORAGE_SECRET_KEY: 'test-secret-key',
    },
    {
      clientOverride: {
        send: async () => {
          const error = new Error('connection refused');
          error.code = 'ECONNREFUSED';
          throw error;
        },
      },
    },
  );

  await assert.rejects(
    storage.storeScreeningPhoto({
      patientId: 'patient-id',
      screeningSessionId: 'session-id',
      region: 'tongue_top',
      file: { buffer: image, mimetype: 'image/jpeg' },
    }),
    { status: 503, code: 'PRIVATE_STORAGE_UNAVAILABLE' },
  );
});

test('stored screening photos can be retrieved through the private storage service', async () => {
  const objects = new Map();
  const clientOverride = {
    async send(command) {
      if (command.constructor.name === 'PutObjectCommand') {
        objects.set(command.input.Key, {
          Body: command.input.Body,
          ContentType: command.input.ContentType,
        });
        return {};
      }
      if (command.constructor.name === 'GetObjectCommand') {
        const stored = objects.get(command.input.Key);
        return stored
          ? { Body: Readable.from([stored.Body]), ContentType: stored.ContentType }
          : {};
      }
      throw new Error(`Unexpected storage operation: ${command.constructor.name}`);
    },
  };
  const storage = createPrivateStorageService(
    {
      STORAGE_ENDPOINT: 'http://minio.test:9000',
      STORAGE_BUCKET: 'private-test-bucket',
      STORAGE_REGION: 'test-region',
      STORAGE_ACCESS_KEY: 'test-access-key',
      STORAGE_SECRET_KEY: 'test-secret-key',
    },
    { clientOverride },
  );
  const image = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 120, g: 80, b: 90 } },
  })
    .jpeg()
    .toBuffer();

  const saved = await storage.storeScreeningPhoto({
    patientId: 'patient-id',
    screeningSessionId: 'session-id',
    region: 'tongue_top',
    file: { buffer: image, mimetype: 'image/jpeg' },
  });
  const retrieved = await storage.readObject(saved.storageKey);
  const chunks = [];
  for await (const chunk of retrieved.body) chunks.push(chunk);

  assert.equal(retrieved.contentType, 'image/jpeg');
  assert.deepEqual(Buffer.concat(chunks), saved.buffer);
  assert.equal(objects.size, 1);
});

test('local private storage initializes directories and securely stores, reads, and deletes images', async (context) => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'aarogya-private-storage-'));
  context.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  const directory = path.join(temporaryDirectory, 'private-photos');
  const storage = createPrivateStorageService({
    STORAGE_BACKEND: 'local',
    LOCAL_STORAGE_DIR: directory,
  });
  const image = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 120, g: 80, b: 90 } },
  })
    .jpeg()
    .toBuffer();

  assert.deepEqual(await storage.initialize(), { status: 'available', backend: 'local' });
  assert.equal(await storage.checkAvailability(), 'available');
  const stored = await storage.storeScreeningPhoto({
    patientId: 'patient-id',
    screeningSessionId: 'session-id',
    region: 'tongue_top',
    file: { buffer: image, mimetype: 'image/jpeg' },
  });
  const onDisk = await stat(path.join(directory, stored.storageKey));
  const retrieved = await storage.readObject(stored.storageKey);
  const chunks = [];
  for await (const chunk of retrieved.body) chunks.push(chunk);

  assert.equal(retrieved.contentType, 'image/jpeg');
  assert.deepEqual(Buffer.concat(chunks), stored.buffer);
  assert.deepEqual(await readFile(path.join(directory, stored.storageKey)), stored.buffer);
  if (process.platform !== 'win32') assert.equal(onDisk.mode & 0o777, 0o600);
  await assert.rejects(storage.readObject('../outside.jpg'), { code: 'STORAGE_KEY_INVALID' });
  await storage.deleteObject(stored.storageKey);
  await assert.rejects(readFile(path.join(directory, stored.storageKey)), { code: 'ENOENT' });
});

test('private screening storage accepts WebP images', async () => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'aarogya-private-webp-'));
  try {
    const storage = createPrivateStorageService({
      STORAGE_BACKEND: 'local',
      LOCAL_STORAGE_DIR: temporaryDirectory,
    });
    const image = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 120, g: 80, b: 90 } },
    })
      .webp()
      .toBuffer();
    const stored = await storage.storeScreeningPhoto({
      patientId: 'patient-id',
      screeningSessionId: 'session-id',
      region: 'tongue_top',
      file: { buffer: image, mimetype: 'image/webp' },
    });
    assert.equal(stored.contentType, 'image/webp');
    assert.match(stored.storageKey, /\.webp$/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('S3 initialization creates a missing configured bucket', async () => {
  const commands = [];
  const storage = createPrivateStorageService(
    {
      STORAGE_ENDPOINT: 'http://minio.test:9000',
      STORAGE_BUCKET: 'private-test-bucket',
      STORAGE_REGION: 'test-region',
      STORAGE_ACCESS_KEY: 'test-access-key',
      STORAGE_SECRET_KEY: 'test-secret-key',
    },
    {
      clientOverride: {
        async send(command) {
          commands.push(command.constructor.name);
          if (command.constructor.name === 'HeadBucketCommand' && commands.length === 1) {
            const error = new Error('missing bucket');
            error.name = 'NotFound';
            throw error;
          }
          return {};
        },
      },
    },
  );
  assert.deepEqual(await storage.initialize(), { status: 'available', backend: 's3' });
  assert.deepEqual(commands, ['HeadBucketCommand', 'CreateBucketCommand', 'HeadBucketCommand']);
});
