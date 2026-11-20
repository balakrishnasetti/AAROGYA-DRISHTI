import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyOralPhotoQuality,
  MAX_ORAL_PHOTO_BYTES,
  ORAL_CAPTURE_ANGLES,
} from './oralPhotoUtils.js';

test('guided oral capture covers six distinct requested angles in order', () => {
  assert.deepEqual(ORAL_CAPTURE_ANGLES, [
    'upper_palate',
    'lower_mouth',
    'left_cheek',
    'right_cheek',
    'tongue_top',
    'tongue_underside',
  ]);
  assert.equal(new Set(ORAL_CAPTURE_ANGLES).size, 6);
});

test('oral photo uploads are capped at one million bytes', () => {
  assert.equal(MAX_ORAL_PHOTO_BYTES, 1_000_000);
});

test('blurry and dark photos are marked for retake instead of rejected before upload', () => {
  const blurry = classifyOralPhotoQuality({
    width: 1280,
    height: 960,
    blurScore: 20,
    darkRatio: 0.1,
    meanBrightness: 100,
    glareRatio: 0,
  });
  const dark = classifyOralPhotoQuality({
    width: 1280,
    height: 960,
    blurScore: 120,
    darkRatio: 0.7,
    meanBrightness: 28,
    glareRatio: 0,
  });

  assert.equal(blurry.imageQuality, 'inadequate');
  assert.deepEqual(blurry.reasons, ['blur']);
  assert.equal(dark.imageQuality, 'inadequate');
  assert.deepEqual(dark.reasons, ['too_dark']);
});

test('small photos can be saved with a resolution warning and no automated review', () => {
  const quality = classifyOralPhotoQuality({
    width: 480,
    height: 320,
    blurScore: 120,
    darkRatio: 0,
    meanBrightness: 120,
    glareRatio: 0,
  });

  assert.equal(quality.imageQuality, 'inadequate');
  assert.deepEqual(quality.reasons, ['resolution']);
});
