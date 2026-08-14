# Manual platform publishing and application logs — TDD evidence

## User journeys

- As an editor, I want Facebook and Instagram schedules to require media so text-only Facebook posts cannot enter the automatic queue.
- As an editor, I want each checked destination to create one independent schedule, with no implicit Facebook-to-Instagram cross-post.
- As an operator, I want Google Sheet scheduling removed without deleting manual schedules.
- As an operator, I want a menu page that shows recent publisher, cron, Meta, API, and browser errors without exposing credentials.

## RED evidence

- Checkpoint: `b192da0 test: define manual publishing and app log behavior`.
- Focused tests failed because Facebook still accepted text-only schedules, the legacy cross-post path still ran, Sheet scheduling was still wired into both runtimes/UI, and the application-log module/routes/page did not exist.
- A follow-up RED test reproduced the missing `scheduled_publish_failed` application-log event in the Worker cron handler.
- Completion-audit checkpoint: `2934b4f test: prove Sheet scheduling is fully retired`.
- Command: `node --test test/app-logs.test.mjs`.
- Result: 5 passed, 1 failed because callable `listSheetSyncPosts` repository methods and `sheetSync` queue UI handling still remained after the main Sheet feature was removed.
- Cross-post completion checkpoint: `4aa0b49 test: prove cross-post hooks are fully retired`.
- Result: 5 passed, 1 failed because the repository still exposed `getInstagramSiblingFanpage` and Settings still serialized the retired cross-post field.

## GREEN evidence

- Implementation checkpoint: `fd79a83 fix: enforce manual platform publishing and add app logs`.
- Completion-audit fix checkpoint: `5914051 fix: remove remaining Sheet scheduling hooks`.
- Cross-post completion fix checkpoint: `3e10d45 fix: remove remaining cross-post hooks`.
- Focused GREEN commands: `node --test test/app-logs.test.mjs` (6 passed) and `node --test test/post-retention.test.mjs` (4 passed).
- Cross-post focused GREEN: `node --test test/meta-publish.test.mjs test/multi-page-schedule.test.mjs test/retired-sheet-cleanup.test.mjs` (46 passed).
- Full command: `npm test -- --test-reporter=spec`.
- Result: 181 passed, 0 failed.
- Coverage command: `npm run test:coverage`.
- Result: 181 passed, 0 failed; line 89.35%, branch 79.54%, functions 91.21%.
- D1 command: `npm run d1:migrate:local`.
- Result: the full migration chain, including `0014_app_logs.sql`, applied successfully.
- Packaging command: `npm run deploy:check`.
- Result: Worker, D1 binding, build identity, and 38 static assets packaged successfully in dry-run mode.
- Dependency command: `npm audit --omit=dev`.
- Result: 0 vulnerabilities.
- Source hygiene: `git diff --check`, JavaScript syntax checks, and added-line secret scan passed; the only credential-shaped added value is a deliberately fake redaction-test string.

## Test specification

| # | Guarantee | Test target | Result |
|---|---|---|---|
| 1 | Facebook and Instagram reject schedules with no media at UI and API boundaries. | `test/post-media-validation.test.mjs`, `test/multi-page-schedule.test.mjs`, `test/publish-queue.test.mjs` | PASS |
| 2 | Facebook accepts supported inline/public media while Instagram requires HTTP(S) media. | `test/post-media-validation.test.mjs` | PASS |
| 3 | A legacy cross-post flag cannot cause an unselected Instagram publish or safe test; no sibling lookup or Settings hook remains callable. | `test/meta-publish.test.mjs`, `test/app-logs.test.mjs` | PASS |
| 4 | Sheet scheduling routes, runtime imports, callable repository hooks, and queue UI handling are absent. | `test/app-logs.test.mjs`, `test/publish-queue.test.mjs` | PASS |
| 5 | Cleanup deletes only Sheet-owned rows and disables legacy cross-post flags while preserving manual posts. | `test/retired-sheet-cleanup.test.mjs` | PASS |
| 6 | Application logs redact nested secrets, Bearer credentials, and token query parameters. | `test/app-logs.test.mjs` | PASS |
| 7 | Logs support seven-day retention, bounded filters, cursor pagination, and repository cleanup. | `test/app-logs.test.mjs`, `test/app-log-repository.test.mjs` | PASS |
| 8 | Publisher, Meta sync, API, client, audit, maintenance, and scheduled-publisher failures produce application-log events. | static/runtime contract tests plus repository integration | PASS |
| 9 | The menu exposes Log ứng dụng with health/build/heartbeat status and per-post attempt diagnostics. | `test/app-logs.test.mjs` | PASS |

## Known observability boundary

Cloudflare can terminate an isolate for `exceededCpu` without returning control to JavaScript, so that exact termination cannot always write an application-log row. The Log ứng dụng page therefore also compares the persisted publisher heartbeat with the current time and warns when the cron has not completed for more than three minutes; the original Cloudflare event log remains the final source for hard isolate termination.
