# TDD evidence: resilient dashboard thumbnails

## User journey and root cause

> As a marketing operator, I want scheduled-post thumbnails to remain visible on the dashboard, so that I can recognize each post without seeing a broken-image icon.

The dashboard previously rendered the legacy `mediaUrl` directly. It did not read the ordered `mediaItems` collection, convert Google Drive publish URLs into display-safe preview URLs, or recover when a remote image could not be loaded.

## RED / GREEN evidence

| Stage | Command | Result | Evidence |
|---|---|---|---|
| RED | `node --test test/dashboard-thumbnail.test.mjs` | Expected failure (0/2 passed) | Missing `mediaItems` lookup, `MediaGallery.previewUrl`, and image-error fallback. Checkpoint: `6344687`. |
| GREEN | `node --test test/dashboard-thumbnail.test.mjs` | 2/2 passed | Dashboard thumbnails now use the first image item, a display preview URL, and a local fallback. Checkpoint: `6be6735`. |
| Regression | `npm test` | 131/131 passed | No failed, skipped, or cancelled repository tests. |
| Coverage | `node --experimental-test-coverage --test test/media-gallery.test.mjs test/dashboard-thumbnail.test.mjs` | Passed | 100% lines, 95.35% branches, and 100% functions across the focused coverage run. |
| Build | `WRANGLER_LOG_PATH=/tmp/mkt-hub-dashboard-thumbnail-deploy-check.log npm run deploy:check` | Passed | 37 assets validated by `wrangler deploy --dry-run`. |
| Production dependency audit | `npm audit --omit=dev --audit-level=high` | Passed | No production dependency vulnerabilities found. |

## Test specification

| # | What is guaranteed | Test / check | Type | Result |
|---|---|---|---|---|
| 1 | The dashboard prefers the first image in ordered `mediaItems` and ignores video items. | `dashboard scheduled thumbnails use the first image media item...` | UI contract | PASS |
| 2 | Google Drive publish/download URLs are converted through `MediaGallery.previewUrl` before display. | Dashboard thumbnail contract + media gallery unit test | Unit / UI contract | PASS |
| 3 | Failed remote images are replaced once with a bundled local image instead of remaining broken. | `dashboard scheduled and approval thumbnails fall back...` | UI contract | PASS |
| 4 | Both today's schedule and the approval queue use the same resilient thumbnail behavior. | Dashboard thumbnail contract | UI contract | PASS |

## Browser QA

Browser QA ran against a local static server with three scheduled posts: a Google Drive download URL, a normal image URL, and an intentionally missing URL.

- Desktop 1200px: three 38×38 thumbnails rendered; the normal URL loaded at 512×512 natural size; the inaccessible Drive URL and intentionally missing URL both switched to valid 512×512 local fallbacks; no JavaScript error or horizontal overflow appeared.
- Mobile 375×812: the dashboard panel remained within the 375px viewport, all three thumbnails retained positive natural width, and no horizontal overflow appeared.
- The Drive URL was confirmed to convert to `https://drive.google.com/thumbnail?...`. The test file itself was not accessible from the isolated QA browser, so the fallback path was exercised successfully.
- Automated screenshot capture timed out. DOM, responsive layout, URL conversion, and image-load state passed; pixel-level visual comparison remains inconclusive.
- All QA-only records were removed after the check, and the isolated browser task space was closed.

## Security and known gaps

- Thumbnail and fallback values are HTML-escaped before insertion. The fallback source is restricted to bundled local assets.
- `npm audit` reports one high and two moderate findings in the development-only Wrangler/Miniflare/Undici chain. Fixing them requires a breaking Wrangler downgrade; production dependencies report zero vulnerabilities, so dependency versions were not changed in this scoped UI fix.
- A private, expired, or hotlink-blocked image cannot reveal its real thumbnail in the browser. It now shows a stable local fallback rather than a broken-image icon.
- No API, database, dependency, or social publishing behavior changed.
