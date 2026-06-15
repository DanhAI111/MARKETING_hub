const crypto = require('node:crypto');

const algorithm = 'aes-256-gcm';

const getKey = () => {
  const configured = process.env.TOKEN_ENCRYPTION_KEY || 'dev-only-marketing-hub-token-key';
  return crypto.createHash('sha256').update(configured).digest();
};

const encrypt = (value) => {
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
};

const decrypt = (value) => {
  if (!value) return '';
  const [ivRaw, tagRaw, encryptedRaw] = value.split('.');
  const decipher = crypto.createDecipheriv(algorithm, getKey(), Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64')),
    decipher.final()
  ]).toString('utf8');
};

module.exports = { encrypt, decrypt };
