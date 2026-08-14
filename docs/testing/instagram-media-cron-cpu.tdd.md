# Instagram media validation and cron CPU — TDD evidence

## Source and user journeys

This fix was derived from production D1 records and a Cloudflare `exceededCpu` scheduled-event log on 2026-08-14; no external plan file was used.

- As a scheduler, I want Instagram schedules without public media rejected before they enter the queue, while Facebook text-only schedules remain valid.
- As an operator on the Cloudflare Free plan, I want publishing isolated from bounded maintenance work so an idle cron does not parse the full Meta post history every minute.
- As an editor, I want partial post updates validated against the complete stored post so media requirements cannot be bypassed.

## RED evidence

- Command: `node --test test/multi-page-schedule.test.mjs test/schedule-sheet.test.mjs test/post-media-validation.test.mjs test/post-retention.test.mjs test/publish-queue.test.mjs`
- Result: 20 passed, 6 failed.
- Failures reproduced empty Instagram media accepted by UI/import, missing API validation, unbounded Sheet-sync rows, and unsharded maintenance.
- Partial-update follow-up command: `node --test --test-name-pattern "both API runtimes validate" test/publish-queue.test.mjs`
- Result before merging stored state: 0 passed, 1 failed.
- Checkpoint commit: `7766f3d test: reproduce empty Instagram media and cron CPU regressions`

## GREEN evidence

- Focused command: `node --test test/multi-page-schedule.test.mjs test/schedule-sheet.test.mjs test/post-media-validation.test.mjs test/post-retention.test.mjs test/publish-queue.test.mjs`
- Result: 27 passed, 0 failed.
- Full command: `npm test`
- Result: 191 passed, 0 failed.
- Coverage command: `npm run test:coverage`
- Result: 191 passed, 0 failed; overall line coverage 90.28%.
- Packaging command: `npm run deploy:check`
- Result: Worker and 37 static assets packaged successfully in dry-run mode.
- Dependency command: `npm audit --omit=dev`
- Result: 0 vulnerabilities.
- Production-shape read: the optimized Sheet-sync predicate selects 322 rows instead of all 1,673 posts (about 81% fewer rows for Worker-side parsing).
- Checkpoint commit: `848c03d fix: validate Instagram media and shard cron maintenance`

## Test specification

| # | Guarantee | Test | Type | Result |
|---|---|---|---|---|
| 1 | Facebook remains allowed to schedule text-only posts. | `Facebook accepts text-only schedules while Instagram requires public media` | Unit | PASS |
| 2 | Instagram with zero media or inline data is rejected; HTTP media is accepted. | `test/post-media-validation.test.mjs` | Unit | PASS |
| 3 | Manual multi-page scheduling rejects an empty Instagram destination before saving any batch entry. | `validateSelection requires at least one page and applies Instagram media constraints to the whole selection` | Unit/UI | PASS |
| 4 | Sheet import rejects an Instagram row without media. | `marks an Instagram schedule without media invalid before it enters the queue` | Unit/integration | PASS |
| 5 | Worker and Node POST/PUT routes validate media, including partial updates merged with stored state. | `both API runtimes validate platform media before persisting post mutations` | Boundary | PASS |
| 6 | Sheet synchronization retains linked/deferred candidates but excludes unrelated Meta history. | `SQLite retention soft-deletes only active published posts strictly older than the cutoff` | Integration | PASS |
| 7 | Idle cron maintenance is split across distinct five-minute slots instead of launching all tasks together. | `scheduled worker isolates publishing from maintenance workloads` | Architecture regression | PASS |

## Coverage and known gaps

- Overall line coverage: 90.28% (configured threshold: 80%).
- Overall branch coverage: 78.77%; the project does not currently enforce a branch threshold.
- Dry-run does not prove the Free-plan 10 ms CPU envelope. Production cron logs must be monitored after deployment.
- The three already-failed Instagram rows still contain no media; they require editing/recreation with a public image/video URL before retrying.

## Merge evidence

- RED: `7766f3d`
- GREEN: `848c03d`
