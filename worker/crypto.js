const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64 = (bytes) => {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
};

const fromBase64 = (value) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export const toBase64Url = (value) => toBase64(
  typeof value === 'string' ? encoder.encode(value) : value
).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const fromBase64Url = (value, asText = false) => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const bytes = fromBase64(padded);
  return asText ? decoder.decode(bytes) : bytes;
};

const sha256 = (value) => crypto.subtle.digest('SHA-256', encoder.encode(value));

export const encrypt = async (value, secret) => {
  if (!value) return '';
  const key = await crypto.subtle.importKey('raw', await sha256(secret), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    encoder.encode(value)
  ));
  return `${toBase64(iv)}.${toBase64(encrypted)}`;
};

export const decrypt = async (value, secret) => {
  if (!value) return '';
  const [ivRaw, encryptedRaw] = value.split('.');
  if (!ivRaw || !encryptedRaw) throw new Error('Encrypted token has an invalid format.');
  const key = await crypto.subtle.importKey('raw', await sha256(secret), 'AES-GCM', false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivRaw), tagLength: 128 },
    key,
    fromBase64(encryptedRaw)
  );
  return decoder.decode(decrypted);
};

export const sign = async (value, secret) => {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
};

export const safeEqual = (left, right) => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};
