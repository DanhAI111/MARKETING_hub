# TDD evidence: Instagram publish/sync identity race

## Source and user journeys

No standalone plan file was supplied. The scope came from the production incident
for post `563f58ec-ec2e-4b6e-ad13-4962bfac02bc` on 14/08/2026.

- As an operator, I want a post that Meta already published to finish as
  `published` even when Instagram sync has already inserted the same media ID.
- As an operator, I want the original scheduled post ID, caption, campaign links,
  publish job, and attempt history preserved while the duplicate sync row is
  retired for audit.
- As an operator, I want the final Meta media ID checkpointed before local post
  finalization so an interrupted Worker can recover without calling
  `media_publish` again.
- As a deployer, I want the D1 migration to finish before the new Worker starts.

## RED and GREEN evidence

| Stage | Command | Result | Evidence |
|---|---|---|---|
| D1 RED | `node --test test/worker-publish-reconciliation.test.mjs` | 0/1 passed | Existing Worker finalization threw `UNIQUE constraint failed: posts.source, posts.externalPostId`. |
| Server RED | `node --test --test-name-pattern="server finalization preserves" test/campaign-approval.test.mjs` | 0/1 passed | SQLite updated the sync row and left the scheduled row in `publishing`. |
| Recovery RED | `node --test --test-name-pattern="D1 recovery finalizes" test/worker-publish-reconciliation.test.mjs` | 0/1 passed | `reconcileCompletedPublishJobs` did not exist. |
| Deploy-order RED | `node --test --test-name-pattern="production deploy command" test/publish-queue.test.mjs` | 0/1 passed | Production deploy did not apply D1 migrations first. |
| Focused GREEN | `node --test test/campaign-approval.test.mjs test/meta-publish.test.mjs test/worker-publish-reconciliation.test.mjs test/publish-queue.test.mjs` | 62/62 passed | Identity merge, durable ID reuse, automatic recovery, runtime parity, and deploy ordering passed. |
| Full regression | `npm test` | 185/185 passed | No failures, skips, or cancellations. |
| Coverage | `npm run test:coverage` | PASS | 90.06% aggregate line coverage; enforced threshold is 80%. |
| Build | `npm run deploy:check` | PASS | Assets built and Wrangler Worker dry-run completed; no deployment occurred. |
| Dependency audit | `npm audit --omit=dev` | PASS | Zero known vulnerabilities. |
| Migration validation | Complete SQLite migration chain plus legacy Facebook fixture | PASS | `publish_jobs.externalPostId` exists and legacy completed Facebook job backfilled to `facebook-post-1`. |
| Review | Correctness and security re-review | PASS | No remaining CRITICAL or HIGH findings. |

## Test specification

| # | Guarantee | Test target | Type | Result |
|---|---|---|---|---|
| 1 | D1 atomically retires the conflicting sync row before assigning its external ID to the scheduled row. | `D1 finalization merges a concurrently synced Instagram row...` | Repository integration | PASS |
| 2 | Scheduled caption/identity and synced permalink/media/engagement survive the merge. | Same D1 test and `server finalization preserves...` | Repository integration | PASS |
| 3 | A completed job with a checkpointed media ID is finalized by cron without another Meta mutation. | `D1 recovery finalizes a completed Instagram job...` | Recovery integration | PASS |
| 4 | Durable Instagram publishing stores the final media ID and reuses it on a revisit. | `durable Instagram publisher checkpoints the media id...` | Service integration | PASS |
| 5 | SQLite uses a transaction and Postgres uses locked ordered updates with a unique-conflict retry. | Server finalization test plus independent correctness review | Database reliability | PASS |
| 6 | Production deploy applies the D1 migration before uploading the Worker. | `the production deploy command always routes...` | Deployment contract | PASS |

## Implementation and operational notes

- D1 uses `db.batch()` so clearing the duplicate external identity and publishing
  the scheduled row commit or roll back together.
- The duplicate sync row is soft-retired and its external ID cleared; it is not
  hard-deleted. The scheduled row remains canonical so job and attempt foreign
  keys stay attached.
- `publish_jobs.externalPostId` is checkpointed at the Meta success boundary.
  Cron reconciles completed jobs before stale-release or queue claiming.
- The migration backfills only Facebook jobs from `parentContainerId`; Instagram
  uses that column for a creation container, not the final media ID.
- PostgreSQL finalization uses `BEGIN`, row locks, ordered updates, rollback, and
  one retry on SQLSTATE `23505` for a concurrent sync insertion.
- The incident-specific production D1 repair, Git commit, push, migration, and
  deployment remain Gate 2 external actions and are not included in this evidence
  file.
