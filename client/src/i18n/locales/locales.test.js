import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test('English and Telugu catalogs expose the same translation keys', async () => {
  const englishPath = new URL('./en.json', import.meta.url);
  const teluguPath = new URL('./te.json', import.meta.url);
  const [englishText, teluguText] = await Promise.all([
    readFile(fileURLToPath(englishPath), 'utf8'),
    readFile(fileURLToPath(teluguPath), 'utf8'),
  ]);
  const english = JSON.parse(englishText);
  const telugu = JSON.parse(teluguText);

  function flattenKeys(value, prefix = '') {
    return Object.entries(value).flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof child === 'object' && child !== null ? flattenKeys(child, path) : [path];
    });
  }

  assert.deepEqual(flattenKeys(english).sort(), flattenKeys(telugu).sort());
});

test('screening copy distinguishes low confidence from missing model weights', async () => {
  const [english, telugu] = await Promise.all(
    ['en', 'te'].map(async (language) =>
      JSON.parse(
        await readFile(fileURLToPath(new URL(`./${language}.json`, import.meta.url)), 'utf8'),
      ),
    ),
  );

  for (const catalog of [english, telugu]) {
    assert.ok(catalog.screening.analysisLowConfidence);
    assert.ok(catalog.screening.analysisPoorQuality);
    assert.match(catalog.screening.photoLowQualitySaveNote, /private|ప్రైవేట్/i);
    assert.doesNotMatch(catalog.screening.limitationsText, /No validated model weights are present/i);
  }
});

test('all supported login languages label the four sign-in methods', async () => {
  const [english, telugu, hindi] = await Promise.all(
    ['en', 'te', 'hi'].map(async (language) =>
      JSON.parse(
        await readFile(fileURLToPath(new URL(`./${language}.json`, import.meta.url)), 'utf8'),
      ),
    ),
  );
  const keys = ['passwordLogin', 'mobileOtpLogin', 'abhaLogin', 'aadhaarQrLogin', 'mobileFallback'];

  for (const catalog of [english, telugu, hindi]) {
    for (const key of keys) {
      assert.equal(typeof catalog.auth[key], 'string');
      assert.ok(catalog.auth[key].length > 0);
    }
  }
});
