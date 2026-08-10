# Two-month post retention and thumbnail recovery — TDD evidence

Date: 2026-08-10

## Scope

- Keep published post history inside a rolling two-calendar-month window.
- Preserve scheduled, failed, tested, and publishing queue records regardless of age.
- Soft-delete expired published records so Google Sheet row identity remains recoverable.
- Prevent Meta sync from importing expired Facebook or Instagram history again.
- Fill Facebook video/album thumbnails from attachment media and provide display-safe UI fallbacks.

## RED

Focused command:

`node --test test/post-retention.test.mjs test/content-media-performance.test.mjs`

Result: 10 tests, 5 passed, 5 failed. Missing behavior was the shared cutoff helper, repository cleanup in Node and Worker, Meta retention filtering, and thumbnail preview/fallback binding.

An additional thumbnail RED run covered Facebook `attachments` and failed 2 focused assertions before implementation.

## GREEN

- Focused retention/thumbnail/Meta suite: 42/42 passed.
- Full suite: 168/168 passed.
- Focused coverage: 99.60% for the retention test, 100% for the content contract test, 97.80% for Meta publishing tests; aggregate 57.37% because the focused run imports the full repositories.
- `npm run deploy:check`: dry-run completed with 37 assets.
- `npm audit --omit=dev`: 0 vulnerabilities.
- Independent correctness review: no findings; reviewer focused run 47/47 passed.

## Production read-only baseline

Cutoff: `2026-06-10T00:00:00.000Z`.

- 469 active published rows are older than the cutoff.
- No active scheduled, failed, tested, or publishing rows exist at the Gate 2 snapshot.
- Recent published rows: Facebook 915 (19 without stored media), Instagram 89 (0 missing), scheduled 1, scheduled-sheet 3.
- The thumbnail UI now guarantees a visible image path even for those 19 text-only Facebook posts, while subsequent Meta sync can enrich video/album rows from attachment media.

No commit, deploy, or production mutation was performed before Gate 2 approval.
