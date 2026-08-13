# Instagram checkpoint backoff — TDD evidence

## Source and user journey

This fix was derived from production D1 evidence on 2026-08-13; no external plan file was used.

As a scheduler, I want each successful Instagram carousel checkpoint to resume on the next cron tick, so that adding more images does not introduce an exponential error backoff.

## Task report

### RED

- Test target: `test/meta-publish.test.mjs`
- Command: `node --test --test-name-pattern "durable Instagram carousel checkpoints|routine carousel checkpoints" test/meta-publish.test.mjs`
- Result before the fix: 0 passed, 2 failed.
- Evidence: a successful child checkpoint waited `899999ms`, and the first real transient error after successful checkpoints waited `900000ms`.
- Checkpoint commit: `13d9ded test: reproduce Instagram checkpoint backoff delay`

### GREEN

- Implementation: routine durable deferrals now use the initial short polling delay; real errors calculate exponential backoff from prior error attempts rather than successful checkpoints.
- Targeted command: `node --test --test-name-pattern "durable Instagram carousel checkpoints|routine carousel checkpoints" test/meta-publish.test.mjs`
- Result: 2 passed, 0 failed.
- Full command: `npm run test:coverage`
- Result: 187 passed, 0 failed; line coverage 90.17%.
- Packaging command: `npm run deploy:check`
- Result: Cloudflare Worker and 37 static assets packaged successfully in dry-run mode.
- Checkpoint commit: `383d272 fix: prevent successful Instagram checkpoints from backing off`

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A successful Instagram carousel child checkpoint with a high historical attempt count is eligible again after the initial short delay, not 15 minutes. | `durable Instagram carousel checkpoints exactly one child per tick and resumes from saved children` | Unit/integration | PASS |
| 2 | The first real retryable Meta error uses the initial error backoff even after many successful media checkpoints. | `routine carousel checkpoints do not consume the retry budget for a transient Meta error` | Unit/integration | PASS |
| 3 | Existing publishing, recovery, duplicate-prevention, scheduling, and security behavior remains green. | `npm run test:coverage` | Regression | PASS (187/187) |
| 4 | The production Worker bundle can be assembled with its configured bindings. | `npm run deploy:check` | Build | PASS |

## Coverage and known gaps

- Overall line coverage: 90.17% (configured threshold: 80%).
- Overall branch coverage: 78.45%; the project does not currently enforce a branch threshold.
- This local verification does not publish a real Instagram post. A production canary must be observed after deployment.

## Merge evidence

- RED: `13d9ded` proves the former 15-minute delay.
- GREEN: `383d272` proves the short-delay implementation passes the focused and full regression suites.
