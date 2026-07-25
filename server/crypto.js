const crypto = require('node:crypto');
const { readRequiredSecret } = require('./security');

const algorithm = 'aes-256-gcm';

const getKey = () => {
  const configured = readRequiredSecret('TOKEN_ENCRYPTION_KEY', 'dev-only-marketing-hub-token-key');
  return crypto.createHash('sha256').update(configured).digest();
};

const TAG_LENGTH = 16;

// Format is shared with worker/crypto.js (WebCrypto AES-GCM): `iv.(ciphertext||tag)`,
// tag appended to the ciphertext. This keeps tokens interchangeable between the
// Node server and the Cloudflare Worker across a SQLite→D1 migration.
const encrypt = (value) => {
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${Buffer.concat([encrypted, tag]).toString('base64')}`;
};

const decrypt = (value) => {
  if (!value) return '';
  const parts = value.split('.');
  const key = getKey();
  if (parts.length === 3) {
    // Legacy Node format: iv.tag.ciphertext (separate tag). Still read old tokens.
    const [ivRaw, tagRaw, encryptedRaw] = parts;
    const decipher = crypto.createDecipheriv(algorithm, key, Buffer.from(ivRaw, 'base64'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, 'base64')),
      decipher.final()
    ]).toString('utf8');
  }
  const [ivRaw, payloadRaw] = parts;
  if (!ivRaw || !payloadRaw) throw new Error('Encrypted token has an invalid format.');
  const payload = Buffer.from(payloadRaw, 'base64');
  const tag = payload.subarray(payload.length - TAG_LENGTH);
  const encrypted = payload.subarray(0, payload.length - TAG_LENGTH);
  const decipher = crypto.createDecipheriv(algorithm, key, Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
};

module.exports = { encrypt, decrypt };
