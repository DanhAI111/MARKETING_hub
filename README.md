# MKT_Hub

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

Generate two long random values of at least 32 characters. Production fails fast when `SESSION_SECRET` or `TOKEN_ENCRYPTION_KEY` is missing or too short. Keep `TOKEN_ENCRYPTION_KEY` unchanged after Meta is connected:

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put EMAIL_FROM
npx wrangler secret put META_APP_ID
npx wrangler secret put META_APP_SECRET
```

`ADMIN_PASSWORD` enables immediate password login. Google OAuth is optional; omit its two secrets until a Google OAuth client is available. For personal Gmail login, add each employee Gmail to `ALLOWED_EMAILS`, or set `ALLOW_EMPLOYEE_EMAILS=1` after saving employee Gmail addresses in Settings -> Employees. Avoid allowing the whole `gmail.com` domain unless every Gmail account should be able to access the app. Task email notifications on Cloudflare use Resend: set `RESEND_API_KEY` and `EMAIL_FROM` after verifying the sender domain/address in Resend. Employees also need their Gmail saved in Settings -> Employees so task changes can resolve the recipient.

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

For local Node email notifications, configure SMTP in `.env`. Gmail SMTP works with a Google App Password:

```text
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-sender@gmail.com
SMTP_PASS=your-google-app-password
SMTP_FROM="MKT_Hub <your-sender@gmail.com>"
```

Task notification emails are sent when a task is created, updated, deleted, reassigned, or moved between statuses. If `TASK_DAILY_SUMMARY_ENABLED=1`, the scheduler also sends one daily open-task summary per assignee email.

## Existing Browser Data

On first login, the frontend imports existing MKT_Hub data from browser `localStorage` into D1 once. SQLite/PostgreSQL migration is not required for browser-local data.

## Meta Publishing Notes

- Manual schedules support **Đăng thử — không công khai**. Facebook creates an unpublished Page post; paired Instagram accounts create and validate a media container without calling `media_publish`.
- Safe-test rows use their own terminal `tested` state and are excluded from published KPIs and the live pending queue. A failed Instagram validation can be retried without re-creating the Facebook dark post.
- Facebook supports text, public image URLs, and uploaded base64 images stored with a scheduled post.
- Inline uploads are limited to 1MB per fanpage image or 1MB total per scheduled post to stay within D1's row-size limit. Public image URLs do not use that inline storage.
- Instagram Graph publishing requires a public image URL.
- Connect Meta again after deployment so page tokens are encrypted with the production `TOKEN_ENCRYPTION_KEY`.
- Reconnect Meta after changing `META_SCOPES`; existing page tokens do not automatically gain newly requested permissions.
- The Cron Trigger checks due posts every minute and refreshes connected Meta pages every 15 minutes.
- Google Sheets imported by URL stay linked to scheduled posts. The "Cập nhật hàng đợi" action reloads linked sheets before publishing due posts; add a stable, unique `id` column so rows remain linked when the sheet is reordered.
