import sharp from 'sharp';
import { ApiError } from '../utils/apiError.js';

const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_MIN_LONG_EDGE = 640;
const IMAGE_MIN_SHORT_EDGE = 480;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function hasExpectedSignature(buffer, mimetype) {
  if (mimetype === 'image/png') {
    return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mimetype === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimetype === 'image/webp') {
    return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

function laplacianVariance(data, width, height) {
  let total = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const center = data[i];
      const lap = Math.abs(data[i - 1] - 2 * center + data[i + 1]) + Math.abs(data[i - width] - 2 * center + data[i + width]);
      total += lap * lap;
      count += 1;
    }
  }

  return count > 0 ? total / count : 0;
}

export async function assessImageQuality({ buffer, mimetype }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ApiError(400, 'IMAGE_REQUIRED', 'Upload a non-empty image file and try again.');
  }
  if (!ALLOWED_TYPES.has(mimetype)) {
    throw new ApiError(400, 'IMAGE_TYPE_INVALID', 'Use a JPEG, PNG, or WEBP image and try again.');
  }
  if (buffer.length > IMAGE_MAX_BYTES) {
    throw new ApiError(400, 'IMAGE_TOO_LARGE', 'Choose an image smaller than 10 MB.');
  }
  if (!hasExpectedSignature(buffer, mimetype)) {
    throw new ApiError(400, 'IMAGE_INVALID', 'The uploaded image file is invalid or corrupted.');
  }

  const raw = sharp(buffer).rotate();
  const metadata = await raw.metadata();
  if (!metadata.width || !metadata.height) {
    throw new ApiError(400, 'IMAGE_INVALID', 'The uploaded image file could not be decoded.');
  }
  if (
    Math.max(metadata.width, metadata.height) < IMAGE_MIN_LONG_EDGE ||
    Math.min(metadata.width, metadata.height) < IMAGE_MIN_SHORT_EDGE
  ) {
    return {
      imageQuality: 'inadequate',
      width: metadata.width,
      height: metadata.height,
      reasons: ['resolution'],
      recommendation: 'Use a larger, in-focus photo with at least 640 × 480 pixels in either orientation.',
    };
  }

  const grayscale = raw.grayscale().raw();
  const { data, info } = await grayscale.toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const totalPixels = data.length;

  let brightnessTotal = 0;
  let darkPixels = 0;
  let brightPixels = 0;

  for (let i = 0; i < data.length; i += 1) {
    const value = data[i];
    brightnessTotal += value;
    if (value < 30) darkPixels += 1;
    if (value > 240) brightPixels += 1;
  }

  const meanBrightness = totalPixels > 0 ? brightnessTotal / totalPixels : 0;
  const darkRatio = totalPixels > 0 ? darkPixels / totalPixels : 0;
  const glareRatio = totalPixels > 0 ? brightPixels / totalPixels : 0;
  const blurScore = laplacianVariance(data, width, height);

  let imageQuality = 'adequate';
  if (
    blurScore < 35 ||
    darkRatio > 0.6 ||
    glareRatio > 0.2 ||
    meanBrightness < 35 ||
    meanBrightness > 220
  ) {
    imageQuality = 'inadequate';
  } else if (blurScore < 90 || darkRatio > 0.35 || glareRatio > 0.08) {
    imageQuality = 'uncertain';
  }

  return {
    imageQuality,
    blurScore,
    meanBrightness,
    darkRatio,
    glareRatio,
    width,
    height,
    reasons: [
      ...(blurScore < 90 ? ['blur'] : []),
      ...(darkRatio > 0.35 || meanBrightness < 35 ? ['too_dark'] : []),
      ...(glareRatio > 0.08 || meanBrightness > 220 ? ['glare'] : []),
    ],
    recommendation:
      imageQuality === 'adequate'
        ? 'The photo looks usable for review.'
        : 'Retake the photo with better lighting and a clearer angle.',
  };
}

export function createImageQualityGuard() {
  return async function validateImage(req, res, next) {
    try {
      const file = req.file || req.files?.[0];
      if (!file) {
        return next(new ApiError(400, 'IMAGE_REQUIRED', 'Choose an image to continue.'));
      }
      const quality = await assessImageQuality({ buffer: file.buffer, mimetype: file.mimetype });
      req.imageQuality = quality;
      if (quality.imageQuality !== 'adequate') {
        return next(
          new ApiError(
            400,
            'IMAGE_QUALITY_POOR',
            quality.recommendation,
          ),
        );
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
