# Marketing Hub

Static marketing dashboard with a Node backend for shared company usage, Facebook/Instagram sync, and scheduled publishing. Local development uses SQLite by default; production can use PostgreSQL through `DATABASE_URL`.

## Run Locally

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`.

The original `manage_MKT.html` still works as a static file, but Meta linking and automatic sync require the Node server.

## Deploy on Render

The repository includes a `render.yaml` Blueprint that creates:

- one Starter Node web service in Singapore;
- one Basic 256 MB PostgreSQL database in Singapore;
- generated session and token-encryption secrets;
- private database networking and a `/api/health` health check.

These are paid production resources. The Free web service sleeps after 15 minutes and the Free PostgreSQL database expires after 30 days, so Free is not suitable for scheduled publishing.

1. Push this repository to GitHub or GitLab.
2. In Render, choose **New > Blueprint** and connect the repository.
3. Enter the requested values:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `ALLOWED_EMAIL_DOMAINS` (for example `yourcompany.com`)
   - `META_APP_ID`
   - `META_APP_SECRET`
4. Apply the Blueprint and wait for the first deploy.
5. Copy the deployed Render URL, for example `https://marketing-hub.onrender.com`.
6. Add these OAuth redirect URIs:
   - Google: `https://your-render-url/auth/google/callback`
   - Meta: `https://your-render-url/auth/meta/callback`

The app automatically uses Render's `RENDER_EXTERNAL_URL`, so `PUBLIC_BASE_URL`, `GOOGLE_CALLBACK_URL`, and `META_REDIRECT_URI` are optional unless you add a custom domain. When using a custom domain, set all three values to that domain's HTTPS URLs in the Render service environment.

## Multi-User Company Setup

Use a hosted Node service plus a managed PostgreSQL database so everyone in the company opens the same URL and works on the same data.

Recommended setup:

1. Create a PostgreSQL database on Render, Railway, Supabase, Neon, or another managed provider.
2. Deploy this repository as a Node web service.
   - Build command: `npm install`
   - Start command: `npm start`
3. Set production environment variables:
   - `NODE_ENV=production`
   - `HOST=0.0.0.0`
   - `PORT` from the hosting platform
   - `PUBLIC_BASE_URL=https://your-app-domain.com`
   - `DATABASE_URL=postgres://...`
   - `DATABASE_SSL=1` for most managed PostgreSQL providers
   - `AUTH_REQUIRED=1`
   - `SESSION_SECRET` as a long random string
   - `TOKEN_ENCRYPTION_KEY` as a long random string; keep it unchanged after connecting Meta
4. Create a Google OAuth Client in Google Cloud Console:
   - Application type: Web application
   - Authorized redirect URI: `https://your-app-domain.com/auth/google/callback`
5. Set Google auth variables:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_CALLBACK_URL=https://your-app-domain.com/auth/google/callback`
   - `ALLOWED_EMAIL_DOMAINS=yourcompany.com`
   - Optionally add external users with `ALLOWED_EMAILS=partner@gmail.com,agency@example.com`

After deployment, users visit the app URL and sign in with Google. Access is restricted to the allowed domain/email list.

## Migrating Existing Local Data

If you already have data in `data/marketing_hub.sqlite`, copy the same `TOKEN_ENCRYPTION_KEY` into the production environment and run:

```bash
DATABASE_URL="postgres://..." DATABASE_SSL=1 npm run migrate:postgres
```

Set `SQLITE_DB_PATH=/path/to/marketing_hub.sqlite` if the SQLite file is not in `data/marketing_hub.sqlite`.

## Meta Setup

1. Create a Meta Developer app.
2. Add Facebook Login and configure the redirect URI:
   `http://localhost:3000/auth/meta/callback`
3. Fill these values in `.env`:
   - `META_APP_ID`
   - `META_APP_SECRET`
   - `META_REDIRECT_URI`
   - `META_SCOPES`
   - `TOKEN_ENCRYPTION_KEY`
4. Required permissions for Facebook Page sync:
   - `pages_show_list`
   - `pages_read_engagement`
5. Required permissions for scheduled publishing:
   - `pages_manage_posts` for Facebook Pages
   - `instagram_basic`
   - `instagram_content_publish` for Instagram Business publishing
6. Example scope config:
   `META_SCOPES=pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish`

The app syncs connected Facebook Page posts and Instagram media when the page reloads, when you click **Đồng bộ ngay**, and every 15 minutes while the backend is running.

## Scheduled Publishing

Open **Lịch đăng bài** and click **Lên lịch đăng**. You can enter post content, add media URLs or upload images, and choose the exact publish time. The Node backend checks due posts every minute while it is running.

Notes:
- Facebook publishing supports text, public image URLs, and uploaded image files stored with the schedule.
- Instagram Graph publishing requires a public image URL. Local uploads/base64 images are saved in the schedule, but Instagram will reject them.
- The fanpage/account must be connected through Meta OAuth after the publishing scopes are configured.
