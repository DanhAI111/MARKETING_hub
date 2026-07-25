const crypto = require('node:crypto');
const { readRequiredSecret } = require('./security');

const COOKIE_NAME = 'mh_session';
const CSRF_COOKIE_NAME = 'mh_csrf';
const ONE_WEEK_SECONDS = 60 * 60 * 24 * 7;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const required = () => process.env.AUTH_REQUIRED === '1' || !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const configured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const baseUrl = () => process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://${process.env.HOST || 'localhost'}:${process.env.PORT || 3000}`;
const callbackUrl = () => process.env.GOOGLE_CALLBACK_URL || `${baseUrl()}/auth/google/callback`;
const sessionSecret = () => readRequiredSecret('SESSION_SECRET', process.env.TOKEN_ENCRYPTION_KEY || 'local-dev-session-secret');

const splitList = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

const encode = (value) => Buffer.from(value).toString('base64url');
const decode = (value) => Buffer.from(value, 'base64url').toString('utf8');
const sign = (payload) => crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');

const parseCookies = (req) => Object.fromEntries(String(req.headers.cookie || '')
  .split(';')
  .map((part) => part.trim())
  .filter(Boolean)
  .map((part) => {
    const index = part.indexOf('=');
    return index === -1 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));

const readSession = (req) => {
  const value = parseCookies(req)[COOKIE_NAME];
  if (!value || !value.includes('.')) return null;
  const [payload, signature] = value.split('.');
  const expected = sign(payload);
  if (
    Buffer.byteLength(signature) !== Buffer.byteLength(expected) ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    const session = JSON.parse(decode(payload));
    if (session.expiresAt && Date.now() > session.expiresAt) return null;
    return session.user || null;
  } catch {
    return null;
  }
};

const cookieOptions = ({ httpOnly = true, maxAge = ONE_WEEK_SECONDS } = {}) => {
  // Set TRUST_PROXY=1 when behind a TLS-terminating proxy so cookies stay Secure
  // even though baseUrl()/req is plaintext http on the internal hop.
  const secure = baseUrl().startsWith('https://')
    || process.env.NODE_ENV === 'production'
    || process.env.TRUST_PROXY === '1';
  return [
    httpOnly ? 'HttpOnly' : '',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    secure ? 'Secure' : ''
  ].filter(Boolean).join('; ');
};

const setSession = (res, user) => {
  const payload = encode(JSON.stringify({
    user,
    createdAt: Date.now(),
    expiresAt: Date.now() + ONE_WEEK_SECONDS * 1000
  }));
  const csrfToken = crypto.randomBytes(24).toString('base64url');
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=${payload}.${sign(payload)}; ${cookieOptions({ httpOnly: true })}`,
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(csrfToken)}; ${cookieOptions({ httpOnly: false })}`
  ]);
};

const clearSession = (res) => {
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=; ${cookieOptions({ httpOnly: true, maxAge: 0 })}`,
    `${CSRF_COOKIE_NAME}=; ${cookieOptions({ httpOnly: false, maxAge: 0 })}`
  ]);
};

const verifyCsrf = (req) => {
  if (!MUTATING_METHODS.has(req.method) || !req.path.startsWith('/api/')) {
    return true;
  }
  const cookies = parseCookies(req);
  const cookieToken = cookies[CSRF_COOKIE_NAME] || '';
  const headerToken = String(req.headers['x-csrf-token'] || '');
  const valid = cookieToken && headerToken
    && Buffer.byteLength(cookieToken) === Buffer.byteLength(headerToken)
    && crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken));
  if (valid) return true;
  const error = new Error('CSRF token không hợp lệ');
  error.status = 403;
  throw error;
};

let warnedAllowAll = false;

const isAllowedUser = async (email) => {
  const normalized = String(email || '').toLowerCase();
  if (!normalized) return false;
  const allowedEmails = splitList(process.env.ALLOWED_EMAILS);
  const allowedDomains = splitList(process.env.ALLOWED_EMAIL_DOMAINS);
  const allowEmployeeEmails = process.env.ALLOW_EMPLOYEE_EMAILS === '1';
  const domain = normalized.split('@')[1] || '';
  if (allowedEmails.includes(normalized) || allowedDomains.includes(domain)) return true;
  if (allowEmployeeEmails) {
    const employees = await require('./repository').listAppItems('employees').catch(() => []);
    if (employees.some((employee) => String(employee.email || '').trim().toLowerCase() === normalized)) return true;
  }
  // Fail-closed: with no allowlist configured, deny by default. Opt in to the
  // old allow-any-Google behavior with ALLOW_ALL_AUTHENTICATED=1 (single-user setups).
  if (!allowedEmails.length && !allowedDomains.length && !allowEmployeeEmails) {
    if (process.env.ALLOW_ALL_AUTHENTICATED === '1') {
      if (!warnedAllowAll) {
        console.warn('[auth] ALLOW_ALL_AUTHENTICATED=1: any verified Google account is admitted. Set ALLOWED_EMAILS to restrict access.');
        warnedAllowAll = true;
      }
      return true;
    }
    console.warn('[auth] No allowlist configured (ALLOWED_EMAILS / ALLOWED_EMAIL_DOMAINS / ALLOW_EMPLOYEE_EMAILS). Denying login. Set ALLOW_ALL_AUTHENTICATED=1 to allow any verified Google account.');
  }
  return false;
};

const publicPath = (path) => (
  path === '/login' ||
  path === '/auth/google/start' ||
  path === '/auth/google/callback' ||
  path === '/auth/logout' ||
  path === '/api/health' ||
  path === '/api/me'
);

const safeNext = (value) => {
  const next = String(value || '/');
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
};

const html = (error = '', next = '/') => `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Đăng nhập Marketing Hub</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #071022; color: #f8fafc; }
    main { width: min(420px, calc(100vw - 32px)); border: 1px solid #24364f; border-radius: 14px; padding: 32px; background: #111c2e; box-shadow: 0 24px 80px rgba(0,0,0,.3); }
    h1 { margin: 0 0 10px; font-size: 28px; }
    p { color: #94a3b8; line-height: 1.6; margin: 0 0 24px; }
    a { display: inline-flex; align-items: center; justify-content: center; width: 100%; min-height: 48px; border-radius: 10px; background: #22c55e; color: #052e16; font-weight: 800; text-decoration: none; }
    .error { margin-bottom: 18px; padding: 12px; border: 1px solid #f87171; border-radius: 10px; background: rgba(248,113,113,.08); color: #fecaca; }
  </style>
</head>
<body>
  <main>
    <h1>Marketing Hub</h1>
    <p>Đăng nhập bằng Gmail cá nhân hoặc tài khoản Google được cấp quyền để sử dụng dữ liệu chung.</p>
    ${error ? `<div class="error">${error}</div>` : ''}
    ${configured()
      ? `<a href="/auth/google/start?next=${encodeURIComponent(next)}">Đăng nhập với Google</a>`
      : '<div class="error">Google OAuth chưa được cấu hình trên server.</div>'}
  </main>
</body>
</html>`;

const installRoutes = (app) => {
  app.get('/login', (req, res) => {
    res.type('html').send(html(req.query.error || '', safeNext(req.query.next)));
  });

  app.get('/api/me', (req, res) => {
    const user = readSession(req);
    res.json({ authenticated: !!user, user, authRequired: required() });
  });

  app.get('/auth/google/start', async (req, res) => {
    if (!configured()) {
      res.redirect('/login?error=Google%20OAuth%20chua%20duoc%20cau%20hinh');
      return;
    }
    try {
      const state = crypto.randomBytes(16).toString('hex');
      await require('./repository').saveOAuthState('google', state, { next: safeNext(req.query.next) });
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
      url.searchParams.set('redirect_uri', callbackUrl());
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'openid email profile');
      url.searchParams.set('state', state);
      url.searchParams.set('prompt', 'select_account');
      res.redirect(url.toString());
    } catch (err) {
      res.redirect(`/login?error=${encodeURIComponent(err.message || 'Không thể bắt đầu đăng nhập Google')}`);
    }
  });

  app.get('/auth/google/callback', async (req, res, next) => {
    try {
      const state = await require('./repository').consumeOAuthState('google', req.query.state);
      if (!req.query.code || !state) {
        res.redirect('/login?error=Phien%20dang%20nhap%20da%20het%20han');
        return;
      }
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: req.query.code,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: callbackUrl(),
          grant_type: 'authorization_code'
        })
      });
      const tokenBody = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok) throw new Error(tokenBody.error_description || 'Không thể đổi mã Google OAuth.');

      const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenBody.access_token}` }
      });
      const profile = await userRes.json().catch(() => ({}));
      if (!userRes.ok || !profile.email) throw new Error('Không thể đọc thông tin tài khoản Google.');
      if (profile.email_verified === false) throw new Error('Email Google chưa được xác minh.');
      if (!(await isAllowedUser(profile.email))) throw new Error('Tài khoản này không nằm trong danh sách được phép truy cập.');

      setSession(res, {
        email: profile.email,
        name: profile.name || profile.email,
        picture: profile.picture || ''
      });
      res.redirect(state.next || '/');
    } catch (err) {
      res.redirect(`/login?error=${encodeURIComponent(err.message || 'Không thể đăng nhập bằng Google')}`);
    }
  });

  app.get('/auth/logout', (req, res) => {
    clearSession(res);
    res.redirect('/login');
  });
};

const middleware = (req, res, next) => {
  const user = readSession(req);
  req.user = user;
  if (!required() || user || publicPath(req.path)) {
    if (user) verifyCsrf(req);
    next();
    return;
  }
  if (req.path.startsWith('/api/')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl || '/')}`);
};

module.exports = {
  installRoutes,
  middleware,
  required,
  configured,
  readSession,
  verifyCsrf
};
