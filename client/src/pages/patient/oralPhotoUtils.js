export const MAX_ORAL_PHOTO_BYTES = 1_000_000;
export const ORAL_CAPTURE_ANGLES = [
  'upper_palate',
  'lower_mouth',
  'left_cheek',
  'right_cheek',
  'tongue_top',
  'tongue_underside',
];

export function classifyOralPhotoQuality({
  width,
  height,
  blurScore,
  darkRatio,
  meanBrightness,
  glareRatio,
}) {
  const reasons = [];
  if (Math.max(width, height) < 640 || Math.min(width, height) < 480) reasons.push('resolution');
  if (blurScore < 90) reasons.push('blur');
  if (darkRatio > 0.35 || meanBrightness < 35) reasons.push('too_dark');
  if (glareRatio > 0.08 || meanBrightness > 220) reasons.push('glare');

  const inadequate =
    reasons.includes('resolution') ||
    blurScore < 35 ||
    darkRatio > 0.6 ||
    glareRatio > 0.2 ||
    meanBrightness < 35 ||
    meanBrightness > 220;
  return {
    imageQuality: inadequate ? 'inadequate' : reasons.length ? 'uncertain' : 'adequate',
    reasons,
  };
}

function decodeImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('screening.photoQualityError'));
    };
    image.src = url;
  });
}

export async function compressOralPhoto(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('screening.photoFileError');
  }
  const image = await decodeImage(file);
  const canvas = document.createElement('canvas');
  const initialScale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
  let scale = initialScale;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('screening.photoQualityError');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const quality = Math.max(0.42, 0.88 - attempt * 0.07);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('screening.photoQualityError');
    if (blob.size <= MAX_ORAL_PHOTO_BYTES) {
      return new File([blob], 'oral-screening.jpg', { type: 'image/jpeg' });
    }
    scale *= 0.82;
  }
  throw new Error('screening.photoFileError');
}

export async function checkOralPhoto(file) {
  if (!file || file.size > MAX_ORAL_PHOTO_BYTES) throw new Error('screening.photoFileError');
  const image = await decodeImage(file);
  const scale = Math.min(1, 320 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(3, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(3, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('screening.photoQualityError');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const gray = new Uint8Array(canvas.width * canvas.height);
  let brightness = 0;
  let dark = 0;
  let glare = 0;
  for (let pixel = 0; pixel < gray.length; pixel += 1) {
    const offset = pixel * 4;
    const value = Math.round(
      data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114,
    );
    gray[pixel] = value;
    brightness += value;
    if (value < 30) dark += 1;
    if (value > 240) glare += 1;
  }
  let laplacian = 0;
  let squared = 0;
  let count = 0;
  for (let y = 1; y < canvas.height - 1; y += 1) {
    for (let x = 1; x < canvas.width - 1; x += 1) {
      const index = y * canvas.width + x;
      const value =
        gray[index - 1] +
        gray[index + 1] +
        gray[index - canvas.width] +
        gray[index + canvas.width] -
        4 * gray[index];
      laplacian += value;
      squared += value * value;
      count += 1;
    }
  }
  const variance = count ? squared / count - (laplacian / count) ** 2 : 0;
  const countPixels = gray.length;
  return classifyOralPhotoQuality({
    width: image.naturalWidth,
    height: image.naturalHeight,
    blurScore: variance,
    darkRatio: dark / countPixels,
    meanBrightness: brightness / countPixels,
    glareRatio: glare / countPixels,
  });
}
