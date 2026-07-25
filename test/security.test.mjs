import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSecurityConfig as assertWorkerSecurityConfig, readRequiredSecret as readWorkerSecret } from '../worker/security.js';
import { AuthService } from '../worker/auth.js';
import serverSecurity from '../server/security.js';
import rateLimitModule from '../server/rate-limit.js';
import serverAuth from '../server/auth.js';

test('worker security config rejects missing production secrets', () => {
  assert.throws(
    () => assertWorkerSecurityConfig({ PUBLIC_BASE_URL: 'https://example.test' }),
    /TOKEN_ENCRYPTION_KEY/
  );
});

test('worker security config allows explicit strong production secrets', () => {
  assert.doesNotThrow(() => assertWorkerSecurityConfig({
    PUBLIC_BASE_URL: 'https://example.test',
    TOKEN_ENCRYPTION_KEY: 't'.repeat(32),
    SESSION_SECRET: 's'.repeat(32)
  }));
});

test('worker security config fails closed unless dev secrets are explicitly allowed', () => {
  // No ALLOW_DEV_SECRETS → must throw even outside production (Workers don't set
  // ENVIRONMENT/NODE_ENV, so silent dev-secret fallback would leak to prod).
  assert.throws(() => readWorkerSecret({}, 'SESSION_SECRET', 'dev-secret'), /SESSION_SECRET/);
});

test('worker security config falls back only with explicit ALLOW_DEV_SECRETS=1', () => {
  assert.equal(
    readWorkerSecret({ ALLOW_DEV_SECRETS: '1' }, 'SESSION_SECRET', 'dev-secret'),
    'dev-secret'
  );
});

test('server security config rejects short production secrets', () => {
  const originalEnv = { ...process.env };
  try {
    process.env.NODE_ENV = 'production';
    process.env.TOKEN_ENCRYPTION_KEY = 'short';
    process.env.SESSION_SECRET = 'also-short';
    assert.throws(() => serverSecurity.assertSecurityConfig(), /TOKEN_ENCRYPTION_KEY/);
  } finally {
    process.env = originalEnv;
  }
});

test('server rate limit blocks requests over the fixed-window threshold', () => {
  const req = { headers: { 'x-forwarded-for': '203.0.113.10' } };
  assert.equal(rateLimitModule.checkRateLimit(req, 'unit-test', { limit: 2, windowSeconds: 60 }).allowed, true);
  assert.equal(rateLimitModule.checkRateLimit(req, 'unit-test', { limit: 2, windowSeconds: 60 }).allowed, true);
  const blocked = rateLimitModule.checkRateLimit(req, 'unit-test', { limit: 2, windowSeconds: 60 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfter > 0, true);
});

test('worker CSRF rejects mutating API requests with a missing token', () => {
  const request = new Request('https://example.test/api/posts', {
    method: 'POST',
    headers: { cookie: 'mh_csrf=token-a' },
    body: '{}'
  });
  const auth = new AuthService({}, {}, request);
  assert.throws(() => auth.verifyCsrf(), /CSRF token/);
});

test('worker CSRF accepts matching double-submit tokens', () => {
  const request = new Request('https://example.test/api/posts', {
    method: 'POST',
    headers: { cookie: 'mh_csrf=token-a', 'x-csrf-token': 'token-a' },
    body: '{}'
  });
  const auth = new AuthService({}, {}, request);
  assert.equal(auth.verifyCsrf(), true);
});

test('worker Google allowlist can use employee Gmail addresses', async () => {
  const request = new Request('https://example.test/login');
  const repo = {
    listAppItems: async (collection) => collection === 'employees'
      ? [{ name: 'Minh', email: 'minh@gmail.com' }]
      : []
  };
  const auth = new AuthService({ ALLOW_EMPLOYEE_EMAILS: '1' }, repo, request);
  assert.equal(await auth.isAllowedUser('minh@gmail.com'), true);
  assert.equal(await auth.isAllowedUser('other@gmail.com'), false);
});

test('server CSRF accepts matching double-submit tokens', () => {
  assert.equal(serverAuth.verifyCsrf({
    method: 'PUT',
    path: '/api/collections/tasks/task-1',
    headers: { cookie: 'mh_csrf=token-b', 'x-csrf-token': 'token-b' },
    socket: {}
  }), true);
});

test('server login page escapes the error query param (no reflected XSS)', () => {
  const out = serverAuth.escapeHtml('<img src=x onerror=alert(1)>');
  assert.equal(out, '&lt;img src=x onerror=alert(1)&gt;');
  assert.ok(!out.includes('<'));
});

test('worker allowlist fails closed with no config, opens only with ALLOW_ALL_AUTHENTICATED', async () => {
  const request = new Request('https://example.test/login');
  const repo = { listAppItems: async () => [] };
  const denied = new AuthService({}, repo, request);
  assert.equal(await denied.isAllowedUser('anyone@gmail.com'), false);
  const opened = new AuthService({ ALLOW_ALL_AUTHENTICATED: '1' }, repo, request);
  assert.equal(await opened.isAllowedUser('anyone@gmail.com'), true);
});
