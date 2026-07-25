import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { encrypt as workerEncrypt, decrypt as workerDecrypt } from '../worker/crypto.js';

const SECRET = 'test-key-that-is-long-enough-123456';

const withServerCrypto = (fn) => {
  const require = createRequire(import.meta.url);
  const prevKey = process.env.TOKEN_ENCRYPTION_KEY;
  const prevAllow = process.env.ALLOW_DEV_SECRETS;
  process.env.TOKEN_ENCRYPTION_KEY = SECRET;
  process.env.ALLOW_DEV_SECRETS = '1';
  const secPath = require.resolve('../server/security.js');
  const cryptoPath = require.resolve('../server/crypto.js');
  delete require.cache[secPath];
  delete require.cache[cryptoPath];
  try {
    return fn(require('../server/crypto.js'));
  } finally {
    delete require.cache[secPath];
    delete require.cache[cryptoPath];
    if (prevKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY; else process.env.TOKEN_ENCRYPTION_KEY = prevKey;
    if (prevAllow === undefined) delete process.env.ALLOW_DEV_SECRETS; else process.env.ALLOW_DEV_SECRETS = prevAllow;
  }
};

test('server and worker crypto share the same token format (both directions)', async () => {
  const msg = 'page-access-token-xyz';
  const serverToken = withServerCrypto((c) => c.encrypt(msg));
  assert.equal(serverToken.split('.').length, 2);
  assert.equal(await workerDecrypt(serverToken, SECRET), msg);

  const workerToken = await workerEncrypt(msg, SECRET);
  assert.equal(workerToken.split('.').length, 2);
  assert.equal(withServerCrypto((c) => c.decrypt(workerToken)), msg);
});

test('server crypto still decrypts legacy 3-part tokens', () => {
  const key = crypto.createHash('sha256').update(SECRET).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update('legacy-token', 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const legacy = `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
  assert.equal(withServerCrypto((c) => c.decrypt(legacy)), 'legacy-token');
});
