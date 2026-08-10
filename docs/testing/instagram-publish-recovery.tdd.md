# TDD evidence: Instagram publish interruption recovery

## Source and user journeys

No plan file was supplied. The journeys were derived from the approved Gate 1
recovery scope and the production incident evidence from 10/08/2026:

- As a marketing operator, I want a hung Meta Graph request to end within a
  bounded deadline so one post cannot strand the publishing queue.
- As a marketing operator, I want a created Instagram container recorded before
  `media_publish` so an interrupted run can resume without losing its identity.
- As a marketing operator, I want creation, status, and publish timeouts to defer
  safely instead of converting recoverable work into a terminal failure.
- As a marketing operator, I want expired containers recreated and already
  published containers treated as terminal without a second publish request.
- As a marketing operator, I want stale rows with a container requeued, rows
  already holding an external post ID finalized, and rows with neither marker
  left failed for manual review.

## RED and GREEN evidence

| Stage | Command | Result | Evidence |
|---|---|---|---|
| RED | `node --test test/meta-publish.test.mjs test/campaign-approval.test.mjs` | Expected failure: 26 passed, 7 failed, 0 cancelled | Stale container row was `failed` instead of `scheduled`; GET and POST mocks were not aborted; persistence order was `publish` instead of `persist,publish`; publish timeout escaped; EXPIRED threw `Expired`; PUBLISHED returned no terminal `recovered` result. |
| GREEN | Same focused command | 35 passed, 0 failed/skipped/cancelled | Initial recovery and existing publishing cases passed. |
| Regression | `npm test` | 162 passed, 0 failed/skipped/cancelled | Final suite after both TDD cycles remained green. |
| Coverage | `node --experimental-test-coverage --test test/meta-publish.test.mjs test/campaign-approval.test.mjs` | 38 passed | Aggregate imported-module coverage: 65.48% lines, 67.16% branches, 77.50% functions; focused test files: 97.79% and 99.67% lines. |
| Build | `WRANGLER_LOG_PATH=/tmp/mkt-hub-instagram-recovery-deploy-check.log npm run deploy:check` | PASS | Asset build read 37 files and Wrangler completed `--dry-run`; no deployment occurred. |
| Static checks | `git diff --check` and `node --check` on the four changed runtime files | PASS | No whitespace or JavaScript syntax errors. |
| Dependency audit | `npm audit --omit=dev --audit-level=high` | PASS | Zero production dependency vulnerabilities. |

The initial timeout mock was given a finite fallback after the first RED run so
Node would execute every test instead of cancelling the remainder when the
unbounded production promise left no event-loop handle. Production code was not
changed until the clean 7-failure RED run above. During GREEN, the PUBLISHED case
was narrowed to the documented `status_code,status` fields; it does not assume
undocumented container metadata.

## Reviewer-fix TDD cycle

The reviewer follow-up used a second tests-first cycle for response-body timeout
coverage, server repository parity, and safe-test stale recovery.

| Stage | Command | Result | Evidence |
|---|---|---|---|
| Reviewer RED | `node --test test/meta-publish.test.mjs test/campaign-approval.test.mjs` | Expected failure: 35 passed, 3 failed, 0 cancelled | Server `upsertPost` returned `''` instead of `ig-container-first`; stale safe-test status was `published` instead of `scheduled`; stalled JSON parsing reported `Missing expected rejection` rather than `META_GRAPH_TIMEOUT`. |
| Reviewer GREEN | Same focused command | 38 passed, 0 failed/skipped/cancelled | GET/POST body parsing stayed bounded, non-JSON fallback remained `{}`, server container IDs round-tripped, and safe-test stale rows requeued. |
| Validation regression | `npm test` | Expected failure: 157 passed, 5 failed | Legacy repository fixtures called `upsertPost` without `repo.init()` and lacked the new SQLite column. An idempotent repository column guard was reused from init/upsert/stale recovery. |
| Final regression | `npm test` | 162 passed, 0 failed/skipped/cancelled | All focused and legacy repository paths passed. |

The Postgres insert was audited as 27 columns, placeholders `$1` through `$27`,
and 27 values in the same order. The SQLite insert uses the corresponding 27
named fields, and both SQLite conflict paths update `igContainerId`.

## Test specification

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | Meta Graph GET and POST calls abort at the configured deadline and expose `META_GRAPH_TIMEOUT`. | `graphGet/graphPost aborts...` | Unit | PASS |
| 2 | A newly created Instagram container is persisted before `media_publish`. | `persists a newly created Instagram container...` | Unit/integration | PASS |
| 3 | A creation timeout defers without inventing a container ID. | `defers safely when Instagram container creation times out...` | Unit | PASS |
| 4 | A status timeout defers with the same parked container ID. | `defers a status-check timeout...` | Unit | PASS |
| 5 | A `media_publish` timeout defers with the already persisted container ID. | `defers with the persisted container when media_publish times out` | Unit/integration | PASS |
| 6 | An EXPIRED parked container is replaced and only the replacement is sent to `media_publish`. | `recreates an EXPIRED parked Instagram container...` | Unit/integration | PASS |
| 7 | A PUBLISHED parked container is terminal and causes no `/media` or `/media_publish` call. | `treats a PUBLISHED parked Instagram container as terminal...` | Unit/integration | PASS |
| 8 | Stale rows classify by durable recovery markers while an active lease remains untouched. | `stale publishing posts requeue recoverable containers...` | Repository integration | PASS |
| 9 | Graph GET and POST timeouts remain active until response JSON parsing finishes. | `graphGet and graphPost keep the timeout active while parsing...` | Unit | PASS |
| 10 | A normal non-JSON response still falls back to an empty object rather than becoming a timeout. | `graphGet and graphPost preserve the empty-object fallback...` | Unit | PASS |
| 11 | Server SQLite insert and update operations persist and return `igContainerId`. | `server upsertPost persists and updates...` | Repository integration | PASS |
| 12 | A stale safe-test row with an unpublished external ID returns to `scheduled`, never `published`. | `stale publishing posts requeue recoverable containers...` | Repository integration | PASS |

## Implementation and operational behavior

- Worker and Node Graph calls use a 15-second default request timeout, optionally
  overridden by `META_GRAPH_TIMEOUT_MS` and capped at 60 seconds. The deadline
  covers connection, headers, and response JSON parsing.
- The production Worker persists a newly created parent/container ID before any
  publish attempt. A timeout while creating a container may leave an unpublished
  orphan at Meta, but retrying creation cannot duplicate a public post.
- A timeout after `media_publish` is deliberately ambiguous. The row retains its
  container ID; the next tick checks lifecycle first. `PUBLISHED` ends the flow
  without sending `media_publish` again.
- Stale rows with `externalPostId` are finalized as published before considering
  `igContainerId`; this ordering avoids retrying work already known to be public.
  Rows with only `igContainerId` return to `scheduled`; rows with neither marker
  stay failed with the interruption message.
- Safe-test rows take precedence over the external-ID rule and return to
  `scheduled`. Their existing unpublished Facebook object can be reused by the
  idempotent safe-test flow without being counted as a production publication.
- Server SQLite callers remain compatible even when they use repository methods
  before `init()`; the container column guard is idempotent. PostgreSQL init adds
  the same quoted column before upsert or stale-recovery queries run.

## Coverage, safety, and known gaps

- Aggregate line coverage is below the TDD skill's 80% target because the imported
  Meta and repository modules include large unrelated auth, sync, CRUD, and
  database-driver surfaces. Every changed Worker recovery branch is exercised by
  a focused test, but the coverage tool does not report changed-line coverage.
- Meta's documented container status response does not provide a reliable
  published media ID or permalink. If a parked container reports `PUBLISHED` and
  the row did not already persist those values, recovery intentionally stores
  blank identifiers rather than risk a duplicate publish. A later sync can create
  a separate local row for the published media; reconciliation remains a known
  follow-up.
- The unrecoverable production row with no container/external ID remains failed by
  design. No content matching was added because it could associate the wrong post.
- No production post was retried, no remote database was changed, no deployment
  was performed, and no commit/checkpoint was created. The TDD skill's checkpoint
  recommendation was superseded by the explicit Gate 2 boundary.
