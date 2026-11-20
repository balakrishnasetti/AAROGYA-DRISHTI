import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';

function encryptionKey(secret = process.env.DATA_ENCRYPTION_KEY || process.env.JWT_ACCESS_SECRET) {
  if (!secret || secret.length < 32) {
    throw new Error('A 32-character data encryption key is required.');
  }
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptField(value, secret) {
  if (value === null || value === undefined || value === '') return value;
  const text = String(value);
  if (text.startsWith(PREFIX)) return text;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptField(value, secret) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
  const [ivPart, tagPart, encryptedPart] = value.slice(PREFIX.length).split(':');
  if (!ivPart || !tagPart || !encryptedPart) {
    throw new Error('Encrypted field has an invalid format.');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

