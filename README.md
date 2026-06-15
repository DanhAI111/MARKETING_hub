# Marketing Hub

Marketing dashboard with shared data, Google login, Meta sync, and scheduled Facebook/Instagram publishing. Production runs on Cloudflare Workers with D1 and a one-minute Cron Trigger.

## Cloudflare Deployment

The free deployment uses:

- Cloudflare Workers for the API and static frontend;
- Cloudflare D1 for persistent shared data;
- Cron Triggers every minute for scheduled publishing;
- Workers secrets for OAuth credentials and encryption keys.

### 1. Install and authenticate

```bash
npm install
npx wrangler login
```

### 2. D1 database

This repository is configured for the existing `marketing-hub` D1 database. To create a replacement database in another Cloudflare account, run:

```bash
npm run d1:create
```

Copy the returned `database_id` into `wrangler.jsonc`, then run:

```bash
npm run d1:migrate:remote
```

### 3. Add secrets

Generate two long random values and keep `TOKEN_ENCRYPTION_KEY` unchanged after Meta is connected:

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put META_APP_ID
npx wrangler secret put META_APP_SECRET
```

`ADMIN_PASSWORD` enables immediate password login. Google OAuth is optional; omit its two secrets until a Google OAuth client is available. Set `ALLOWED_EMAIL_DOMAINS` in `wrangler.jsonc` or add it as a secret when enabling Google login.

### 4. Deploy

```bash
npm run deploy
```

The current production URL is:

```text
https://marketing-hub.danhai111.workers.dev
```

### 5. Configure OAuth callbacks

Google OAuth authorized redirect URI:

```text
https://marketing-hub.danhai111.workers.dev/auth/google/callback
```

Meta Facebook Login redirect URI:

```text
https://marketing-hub.danhai111.workers.dev/auth/meta/callback
```

If a custom domain is added, set these optional Worker variables to the custom HTTPS URL:

- `PUBLIC_BASE_URL`
- `GOOGLE_CALLBACK_URL`
- `META_REDIRECT_URI`

If you keep the default `workers.dev` deployment, nothing else needs to be edited in code or config.

## Local Cloudflare Development

```bash
cp .dev.vars.example .dev.vars
npm run d1:migrate:local
npm run dev
```

Open the local URL printed by Wrangler. The original Node/SQLite server remains available with `npm run dev:node` for migration or fallback testing.

## Existing Browser Data

On first login, the frontend imports existing Marketing Hub data from browser `localStorage` into D1 once. SQLite/PostgreSQL migration is not required for browser-local data.

## Meta Publishing Notes

- Facebook supports text, public image URLs, and uploaded base64 images stored with a scheduled post.
- Inline uploads are limited to 1MB per fanpage image or 1MB total per scheduled post to stay within D1's row-size limit. Public image URLs do not use that inline storage.
- Instagram Graph publishing requires a public image URL.
- Connect Meta again after deployment so page tokens are encrypted with the production `TOKEN_ENCRYPTION_KEY`.
- Reconnect Meta after changing `META_SCOPES`; existing page tokens do not automatically gain newly requested permissions.
- The Cron Trigger checks due posts every minute and refreshes connected Meta pages every 15 minutes.
