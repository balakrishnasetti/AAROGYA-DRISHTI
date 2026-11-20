import { randomUUID } from 'node:crypto';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { constants as fsConstants } from 'node:fs';
import { createReadStream } from 'node:fs';
import { access, chmod, mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ApiError } from '../utils/apiError.js';

const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const serverDirectory = fileURLToPath(new URL('../..', import.meta.url));

function hasS3Configuration(environment) {
  return Boolean(
    environment.STORAGE_BUCKET && environment.STORAGE_ACCESS_KEY && environment.STORAGE_SECRET_KEY,
  );
}

export function getPrivateStorageBackend(environment = {}) {
  if (environment.STORAGE_BACKEND === 'local') return 'local';
  if (environment.STORAGE_BACKEND === 's3') {
    if (hasS3Configuration(environment) || environment.NODE_ENV === 'production') return 's3';
    return 'local';
  }
  return hasS3Configuration(environment) ? 's3' : 'local';
}

function getStorageUnavailableError() {
  return new ApiError(
    503,
    'PRIVATE_STORAGE_UNAVAILABLE',
    'Private image storage is unavailable. Try again later or contact support.',
  );
}

function hasExpectedSignature(buffer, contentType) {
  if (contentType === 'application/pdf') return buffer.subarray(0, 5).toString() === '%PDF-';
  if (contentType === 'image/png')
    return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (contentType === 'image/jpeg')
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (contentType === 'image/webp')
    return (
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  return false;
}

export async function normalizeImage(buffer, contentType) {
  const expectedFormat =
    contentType === 'image/jpeg' ? 'jpeg' : contentType === 'image/webp' ? 'webp' : 'png';
  let metadata;
  try {
    metadata = await sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata();
  } catch {
    throw new ApiError(400, 'FILE_TYPE_INVALID', 'The image file could not be decoded safely.');
  }
  if (metadata.format !== expectedFormat || (metadata.pages || 1) !== 1) {
    throw new ApiError(
      400,
      'FILE_TYPE_INVALID',
      'Use a valid single-frame JPEG, PNG, or WebP image.',
    );
  }

  try {
    return await sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 })
      .rotate()
      .toFormat(expectedFormat, expectedFormat === 'jpeg' ? { quality: 90 } : {})
      .toBuffer();
  } catch {
    throw new ApiError(400, 'FILE_TYPE_INVALID', 'The image file could not be processed safely.');
  }
}

export function isPrivateStorageConfigured(environment) {
  const backend = getPrivateStorageBackend(environment);
  if (backend === 'local')
    return Boolean(environment.LOCAL_STORAGE_DIR || environment.NODE_ENV !== 'production');
  return backend === 's3' && hasS3Configuration(environment);
}

export function createPrivateStorageService(environment, { clientOverride } = {}) {
  const backend = getPrivateStorageBackend(environment);
  const configured = isPrivateStorageConfigured(environment);
  const localRoot =
    backend === 'local'
      ? path.resolve(serverDirectory, environment.LOCAL_STORAGE_DIR || './private-storage')
      : null;
  const client =
    backend === 's3' && configured
      ? clientOverride ||
        new S3Client({
          ...(environment.STORAGE_ENDPOINT ? { endpoint: environment.STORAGE_ENDPOINT } : {}),
          region: environment.STORAGE_REGION || 'us-east-1',
          forcePathStyle: Boolean(environment.STORAGE_ENDPOINT),
          maxAttempts: 1,
          credentials: {
            accessKeyId: environment.STORAGE_ACCESS_KEY,
            secretAccessKey: environment.STORAGE_SECRET_KEY,
          },
        })
      : null;

  async function send(command, options) {
    try {
      return await client.send(command, options);
    } catch (error) {
      if (
        ['NoSuchBucket', 'NotFound'].includes(error?.name) ||
        ['NoSuchBucket', 'NotFound'].includes(error?.Code) ||
        error?.$metadata?.httpStatusCode === 404
      ) {
        throw new ApiError(
          503,
          'PRIVATE_STORAGE_UNAVAILABLE',
          'Private storage bucket is missing or unavailable.',
          { bucketMissing: true },
        );
      }
      throw getStorageUnavailableError();
    }
  }

  function getLocalPath(storageKey) {
    if (
      !localRoot ||
      typeof storageKey !== 'string' ||
      !storageKey ||
      storageKey.includes('\\') ||
      storageKey.includes('\0') ||
      path.posix.isAbsolute(storageKey) ||
      storageKey.split('/').some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      throw new ApiError(400, 'STORAGE_KEY_INVALID', 'The private storage key is invalid.');
    }
    const target = path.resolve(localRoot, ...storageKey.split('/'));
    if (!target.startsWith(`${localRoot}${path.sep}`)) {
      throw new ApiError(400, 'STORAGE_KEY_INVALID', 'The private storage key is invalid.');
    }
    return target;
  }

  async function ensureLocalDirectory() {
    if (!localRoot) throw getStorageUnavailableError();
    await mkdir(localRoot, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') await chmod(localRoot, 0o700);
    await access(localRoot, fsConstants.R_OK | fsConstants.W_OK);
  }

  async function checkLocalAvailability() {
    try {
      await ensureLocalDirectory();
      const probePath = path.join(localRoot, `.${randomUUID()}.tmp`);
      await writeFile(probePath, '', { flag: 'wx', mode: 0o600 });
      await unlink(probePath);
      return 'available';
    } catch {
      return 'unavailable';
    }
  }

  function requireConfigured() {
    if (!configured) {
      throw new ApiError(
        503,
        'PRIVATE_STORAGE_UNAVAILABLE',
        'Private image storage is not configured. Contact the administrator.',
      );
    }
  }

  async function saveObject(storageKey, body, contentType) {
    requireConfigured();
    if (backend === 'local') {
      try {
        await ensureLocalDirectory();
        const target = getLocalPath(storageKey);
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(target, body, { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw getStorageUnavailableError();
      }
      return;
    }
    await send(
      new PutObjectCommand({
        Bucket: environment.STORAGE_BUCKET,
        Key: storageKey,
        Body: body,
        ContentLength: body.length,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      }),
    );
  }

  async function checkS3Availability() {
    if (!client) return 'not_configured';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      await send(new HeadBucketCommand({ Bucket: environment.STORAGE_BUCKET }), {
        abortSignal: controller.signal,
      });
      return 'available';
    } catch {
      return 'unavailable';
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async initialize() {
      if (!configured) {
        return {
          status: 'not_configured',
          backend: backend || 'none',
          reason: 'required backend configuration is missing',
        };
      }
      if (backend === 'local') {
        const status = await checkLocalAvailability();
        return {
          status,
          backend,
          ...(status === 'unavailable'
            ? { reason: 'the local directory could not be created or is not writable' }
            : {}),
        };
      }
      const currentStatus = await checkS3Availability();
      if (currentStatus === 'available') return { status: currentStatus, backend };
      try {
        const region = environment.STORAGE_REGION || 'us-east-1';
        await send(
          new CreateBucketCommand({
            Bucket: environment.STORAGE_BUCKET,
            ...(region === 'us-east-1'
              ? {}
              : { CreateBucketConfiguration: { LocationConstraint: region } }),
          }),
        );
        const status = await checkS3Availability();
        return {
          status,
          backend,
          ...(status === 'unavailable'
            ? { reason: 'the bucket endpoint is unreachable or access was denied' }
            : {}),
        };
      } catch {
        return {
          status: 'unavailable',
          backend,
          reason: 'the bucket is missing or cannot be reached with the configured access',
        };
      }
    },
    async checkAvailability() {
      if (!configured) return 'not_configured';
      if (backend === 'local') return checkLocalAvailability();
      return checkS3Availability();
    },
    async storeDoctorFile({ hospitalId, doctorId, file, kind }) {
      if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
        throw new ApiError(
          400,
          'FILE_REQUIRED',
          'Choose a non-empty PDF, JPEG, or PNG file and try again.',
        );
      }
      if (!allowedTypes.has(file.mimetype) || !hasExpectedSignature(file.buffer, file.mimetype)) {
        throw new ApiError(
          400,
          'FILE_TYPE_INVALID',
          'Use a valid PDF, JPEG, or PNG document and try again.',
        );
      }
      if (kind === 'photo' && !['image/jpeg', 'image/png'].includes(file.mimetype)) {
        throw new ApiError(
          400,
          'FILE_TYPE_INVALID',
          'Use a JPEG or PNG doctor photo and try again.',
        );
      }
      requireConfigured();

      const body =
        file.mimetype === 'image/jpeg' || file.mimetype === 'image/png'
          ? await normalizeImage(file.buffer, file.mimetype)
          : file.buffer;
      const extension =
        file.mimetype === 'application/pdf' ? 'pdf' : file.mimetype === 'image/png' ? 'png' : 'jpg';
      const storageKey = `hospitals/${hospitalId}/doctors/${doctorId}/${kind}/${randomUUID()}.${extension}`;
      await saveObject(storageKey, body, file.mimetype);
      return { storageKey, contentType: file.mimetype, sizeBytes: body.length };
    },
    async storeFieldPhoto({ patientId, registrationId, view, file }) {
      if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
        throw new ApiError(400, 'FILE_REQUIRED', 'Choose a non-empty JPEG or PNG image.');
      }
      if (
        !['image/jpeg', 'image/png'].includes(file.mimetype) ||
        !hasExpectedSignature(file.buffer, file.mimetype)
      ) {
        throw new ApiError(400, 'FILE_TYPE_INVALID', 'Use a valid JPEG or PNG image.');
      }
      requireConfigured();
      const body = await normalizeImage(file.buffer, file.mimetype);
      if (body.length > 10 * 1024 * 1024) {
        throw new ApiError(
          413,
          'PAYLOAD_TOO_LARGE',
          'The normalized image is too large. Choose a smaller image.',
        );
      }
      const extension = file.mimetype === 'image/png' ? 'png' : 'jpg';
      const storageKey = `patients/${patientId}/field-registrations/${registrationId}/${view}/${randomUUID()}.${extension}`;
      await saveObject(storageKey, body, file.mimetype);
      return { storageKey, contentType: file.mimetype, sizeBytes: body.length };
    },
    async storeScreeningPhoto({ patientId, screeningSessionId, region, file }) {
      if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
        throw new ApiError(400, 'FILE_REQUIRED', 'Choose a non-empty JPEG, PNG, or WebP image.');
      }
      if (
        !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) ||
        !hasExpectedSignature(file.buffer, file.mimetype)
      ) {
        throw new ApiError(400, 'FILE_TYPE_INVALID', 'Use a valid JPEG, PNG, or WebP image.');
      }
      requireConfigured();
      const body = await normalizeImage(file.buffer, file.mimetype);
      if (body.length > 1_000_000) {
        throw new ApiError(
          413,
          'PAYLOAD_TOO_LARGE',
          'The compressed image must be no larger than 1 MB.',
        );
      }
      const extension =
        file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
      const storageKey = `patients/${patientId}/screenings/${screeningSessionId}/${region}/${randomUUID()}.${extension}`;
      await saveObject(storageKey, body, file.mimetype);
      return { storageKey, contentType: file.mimetype, sizeBytes: body.length, buffer: body };
    },
    async storeScreeningHeatmap({ patientId, screeningSessionId, reportId, buffer }) {
      const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      if (
        !Buffer.isBuffer(buffer) ||
        buffer.length <= signature.length ||
        buffer.length > 2_000_000 ||
        !buffer.subarray(0, signature.length).equals(signature)
      ) {
        throw new ApiError(400, 'HEATMAP_INVALID', 'The model heatmap is invalid.');
      }
      requireConfigured();
      const storageKey = `patients/${patientId}/screenings/${screeningSessionId}/reports/${reportId}/heatmap.png`;
      await saveObject(storageKey, buffer, 'image/png');
      return { storageKey, sizeBytes: buffer.length };
    },
    async deleteObject(storageKey) {
      requireConfigured();
      if (backend === 'local') {
        try {
          await unlink(getLocalPath(storageKey));
        } catch (error) {
          if (error.code !== 'ENOENT') throw getStorageUnavailableError();
        }
        return;
      }
      await send(new DeleteObjectCommand({ Bucket: environment.STORAGE_BUCKET, Key: storageKey }));
    },
    async readObject(storageKey) {
      requireConfigured();
      if (backend === 'local') {
        const filePath = getLocalPath(storageKey);
        try {
          await access(filePath, fsConstants.R_OK);
        } catch {
          throw getStorageUnavailableError();
        }
        const extension = path.extname(filePath).toLowerCase();
        const contentType =
          extension === '.pdf'
            ? 'application/pdf'
            : extension === '.png'
              ? 'image/png'
              : extension === '.webp'
                ? 'image/webp'
                : 'image/jpeg';
        return { body: createReadStream(filePath), contentType };
      }
      const result = await send(
        new GetObjectCommand({ Bucket: environment.STORAGE_BUCKET, Key: storageKey }),
      );
      return { body: result.Body, contentType: result.ContentType };
    },
  };
}
