import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptField, encryptField } from '../services/fieldEncryption.js';

const key = 'field-encryption-test-key-with-32-chars';

test('sensitive values are encrypted at rest and decrypt with the configured key', () => {
  const plaintext = 'patient-sensitive-value';
  const encrypted = encryptField(plaintext, key);

  assert.notEqual(encrypted, plaintext);
  assert.equal(encrypted.startsWith('enc:v1:'), true);
  assert.equal(encrypted.includes(plaintext), false);
  assert.equal(decryptField(encrypted, key), plaintext);
});

test('encrypted values reject tampering and preserve legacy plaintext for migration', () => {
  const encrypted = encryptField('sensitive', key);
  const parts = encrypted.split(':');
  parts[4] = `${parts[4][0] === 'A' ? 'B' : 'A'}${parts[4].slice(1)}`;
  const tampered = parts.join(':');

  assert.throws(() => decryptField(tampered, key));
  assert.equal(decryptField('legacy-value', key), 'legacy-value');
  assert.equal(encryptField(encrypted, key), encrypted);
});
