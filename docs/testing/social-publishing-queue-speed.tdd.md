# TDD evidence: faster and recoverable social publishing queue

## Production incident and user journey

> As a marketing operator, I want posts scheduled for the same time to publish promptly and leave the `Đang đăng` state if a run is interrupted, so that a multi-page campaign does not remain stuck indefinitely.

Production D1 evidence for the 15:00 batch on 04/08/2026 showed seven approved posts claimed together at `08:06:16Z`. Two Facebook posts were actually created by Meta at `08:06:28Z` and `08:06:43Z`, but the Worker run stopped before persisting or processing the rest. One scheduled row was later reconciled by Meta sync; six rows remained `publishing` without an error.

The contributing behaviors were:

- the Worker claimed up to ten posts and processed them one at a time;
- scheduled publishing waited for Google Sheets synchronization first;
- a claimed row had no lease expiry or interrupted-run recovery.

## RED / GREEN evidence

| Stage | Command | Result | Evidence |
|---|---|---|---|
| RED | `node --test test/publish-queue.test.mjs test/campaign-approval.test.mjs` | Expected failure (5/9 passed) | Missing concurrency helper and stale-lease repository method; cron still waited for Sheet sync. Checkpoint: `dff880e`. |
| GREEN | Same focused command | 9/9 passed | Three-way bounded concurrency, independent cron tasks, and stale lease failure recovery passed. Checkpoint: `b9f35f8`. |
| Boundary coverage | `node --experimental-test-coverage --test test/publish-queue.test.mjs` | 4/4 passed | `publish-queue.cjs`: 100% lines, 92.31% branches, 100% functions. Checkpoint: `d4c2bb2`. |
| Regression | `npm test` | 136/136 passed | No failed, skipped, or cancelled repository tests. |
| Build | `WRANGLER_LOG_PATH=/tmp/mkt-hub-publisher-speed-deploy-check.log npm run deploy:check` | Passed | 37 assets and the Worker bundle validated by Wrangler dry-run. |
| Production dependency audit | `npm audit --omit=dev --audit-level=high` | Passed | Zero production dependency vulnerabilities. |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Up to three claimed posts execute concurrently, while returned results retain input order. | `processWithConcurrency runs three posts at once...` | Unit | PASS |
| 2 | Empty and iterable queues are handled safely, and an invalid limit falls back to one worker. | `processWithConcurrency handles empty and iterable queues...` | Unit | PASS |
| 3 | Worker and Node runtimes use the same bounded-concurrency helper. | `worker and server publishing queues use...` | Runtime contract | PASS |
| 4 | Cron starts publishing immediately instead of waiting for Google Sheets synchronization. | `scheduled worker starts publishing without waiting...` | Runtime contract | PASS |
| 5 | A `publishing` lease older than ten minutes becomes `failed` with a retry message, while a recent lease is untouched. | `stale publishing posts become failed...` | Repository integration | PASS |

## Operational behavior and known gaps

- The concurrency limit is intentionally three, not unbounded, to reduce Meta API pressure while cutting a same-time batch into parallel waves.
- Sheet schedules imported during the current tick become eligible on the next one-minute cron tick; existing due posts no longer wait behind Sheet fetches.
- Stale posts are marked failed instead of being automatically republished. This avoids creating a duplicate when Meta accepted a post but the Worker stopped before saving its external ID.
- Incident recovery must reconcile any already-created Meta post before retrying the remaining rows. Production inspection identified the Tuệ Tĩnh Facebook post as already live; it must not be republished.
- No schema migration or credential change is required.
