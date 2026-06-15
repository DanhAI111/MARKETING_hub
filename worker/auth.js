import { fromBase64Url, safeEqual, sign, toBase64Url } from './crypto.js';

const COOKIE_NAME = 'mh_session';
const ONE_WEEK_SECONDS = 60 * 60 * 24 * 7;

const splitList = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

const parseCookies = (request) => Object.fromEntries(String(request.headers.get('cookie') || '')
  .split(';')
  .map((part) => part.trim())
  .filter(Boolean)
  .map((part) => {
    const index = part.indexOf('=');
    return index === -1 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

export class AuthService {
  constructor(env, repo, request) {
    this.env = env;
    this.repo = repo;
    this.request = request;
    this.origin = new URL(request.url).origin;
  }

  required() {
    return this.env.AUTH_REQUIRED === '1' || this.googleConfigured() || !!this.env.ADMIN_PASSWORD;
  }

  googleConfigured() {
    return !!(this.env.GOOGLE_CLIENT_ID && this.env.GOOGLE_CLIENT_SECRET);
  }

  baseUrl() {
    return this.env.PUBLIC_BASE_URL || this.origin;
  }

  callbackUrl() {
    return this.env.GOOGLE_CALLBACK_URL || `${this.baseUrl()}/auth/google/callback`;
  }

  sessionSecret() {
    return this.env.SESSION_SECRET || this.env.TOKEN_ENCRYPTION_KEY || 'local-dev-session-secret';
  }

  safeNext(value) {
    const next = String(value || '/');
    return next.startsWith('/') && !next.startsWith('//') ? next : '/';
  }

  isAllowedUser(email) {
    const normalized = String(email || '').toLowerCase();
    const allowedEmails = splitList(this.env.ALLOWED_EMAILS);
    const allowedDomains = splitList(this.env.ALLOWED_EMAIL_DOMAINS);
    if (!allowedEmails.length && !allowedDomains.length) return true;
    const domain = normalized.split('@')[1] || '';
    return allowedEmails.includes(normalized) || allowedDomains.includes(domain);
  }

  async readSession() {
    const value = parseCookies(this.request)[COOKIE_NAME];
    if (!value || !value.includes('.')) return null;
    const separator = value.lastIndexOf('.');
    const payload = value.slice(0, separator);
    const signature = value.slice(separator + 1);
    const expected = await sign(payload, this.sessionSecret());
    if (!safeEqual(signature, expected)) return null;
    try {
      const session = JSON.parse(fromBase64Url(payload, true));
      if (session.expiresAt && Date.now() > session.expiresAt) return null;
      return session.user || null;
    } catch {
      return null;
    }
  }

  async sessionCookie(user) {
    const payload = toBase64Url(JSON.stringify({
      user,
      createdAt: Date.now(),
      expiresAt: Date.now() + ONE_WEEK_SECONDS * 1000
    }));
    const signature = await sign(payload, this.sessionSecret());
    return `${COOKIE_NAME}=${payload}.${signature}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${ONE_WEEK_SECONDS}`;
  }

  clearCookie() {
    return `${COOKIE_NAME}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`;
  }

  loginHtml(error = '', next = '/') {
    return `<!doctype html>
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
    form { display: grid; gap: 10px; }
    label { color: #cbd5e1; font-weight: 700; }
    input { box-sizing: border-box; width: 100%; min-height: 48px; border: 1px solid #334155; border-radius: 10px; padding: 0 14px; background: #0f172a; color: #f8fafc; font: inherit; }
    button, a { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; width: 100%; min-height: 48px; border: 0; border-radius: 10px; background: #22c55e; color: #052e16; font: inherit; font-weight: 800; text-decoration: none; cursor: pointer; }
    .google { margin-top: 12px; background: #f8fafc; color: #0f172a; }
    .error { margin-bottom: 18px; padding: 12px; border: 1px solid #f87171; border-radius: 10px; background: rgba(248,113,113,.08); color: #fecaca; }
  </style>
</head>
<body>
  <main>
    <h1>Marketing Hub</h1>
    <p>Đăng nhập bằng tài khoản Google công ty để sử dụng dữ liệu chung.</p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    ${this.env.ADMIN_PASSWORD ? `
      <form method="post" action="/login">
        <input type="hidden" name="next" value="${escapeHtml(this.safeNext(next))}">
        <label for="password">Mật khẩu quản trị</label>
        <input id="password" name="password" type="password" required autocomplete="current-password">
        <button type="submit">Đăng nhập</button>
      </form>` : ''}
    ${this.googleConfigured()
      ? `<a class="google" href="/auth/google/start?next=${encodeURIComponent(this.safeNext(next))}">Đăng nhập với Google</a>`
      : ''}
    ${!this.env.ADMIN_PASSWORD && !this.googleConfigured()
      ? '<div class="error">Chưa cấu hình phương thức đăng nhập trên Cloudflare.</div>'
      : ''}
  </main>
</body>
</html>`;
  }

  async startGoogle(url) {
    if (!this.googleConfigured()) return Response.redirect(`${this.origin}/login?error=Google%20OAuth%20chua%20duoc%20cau%20hinh`, 302);
    const state = crypto.randomUUID();
    await this.repo.saveOAuthState('google', state, { next: this.safeNext(url.searchParams.get('next')) });
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', this.env.GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', this.callbackUrl());
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid email profile');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('prompt', 'select_account');
    return Response.redirect(authUrl.toString(), 302);
  }

  async finishPassword() {
    if (!this.env.ADMIN_PASSWORD) {
      return Response.redirect(`${this.origin}/login?error=Mat%20khau%20quan%20tri%20chua%20duoc%20cau%20hinh`, 302);
    }
    const form = await this.request.formData();
    const supplied = String(form.get('password') || '');
    const [suppliedSignature, expectedSignature] = await Promise.all([
      sign('marketing-hub-admin', supplied),
      sign('marketing-hub-admin', this.env.ADMIN_PASSWORD)
    ]);
    if (!safeEqual(suppliedSignature, expectedSignature)) {
      return Response.redirect(`${this.origin}/login?error=${encodeURIComponent('Mật khẩu không đúng')}&next=${encodeURIComponent(this.safeNext(form.get('next')))}`, 302);
    }
    const headers = new Headers({ Location: new URL(this.safeNext(form.get('next')), this.origin).toString() });
    headers.append('Set-Cookie', await this.sessionCookie({ email: 'admin@marketing-hub.local', name: 'Administrator', picture: '' }));
    return new Response(null, { status: 302, headers });
  }

  async finishGoogle(url) {
    try {
      const state = await this.repo.consumeOAuthState('google', url.searchParams.get('state'));
      const code = url.searchParams.get('code');
      if (!code || !state) throw new Error('Phiên đăng nhập đã hết hạn.');
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: this.env.GOOGLE_CLIENT_ID,
          client_secret: this.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: this.callbackUrl(),
          grant_type: 'authorization_code'
        })
      });
      const tokenBody = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok) throw new Error(tokenBody.error_description || 'Không thể đổi mã Google OAuth.');
      const userResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenBody.access_token}` }
      });
      const profile = await userResponse.json().catch(() => ({}));
      if (!userResponse.ok || !profile.email) throw new Error('Không thể đọc thông tin tài khoản Google.');
      if (profile.email_verified === false) throw new Error('Email Google chưa được xác minh.');
      if (!this.isAllowedUser(profile.email)) {
        throw new Error('Tài khoản này không nằm trong danh sách được phép truy cập.');
      }
      const headers = new Headers({ Location: new URL(state.next || '/', this.origin).toString() });
      headers.append('Set-Cookie', await this.sessionCookie({
        email: profile.email,
        name: profile.name || profile.email,
        picture: profile.picture || ''
      }));
      return new Response(null, { status: 302, headers });
    } catch (error) {
      return Response.redirect(`${this.origin}/login?error=${encodeURIComponent(error.message || 'Không thể đăng nhập bằng Google')}`, 302);
    }
  }
}
