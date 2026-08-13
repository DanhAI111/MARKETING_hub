# Durable social publishing — TDD evidence

## Source and user journeys

The source plan was approved in the conversation; no standalone plan file was supplied.

- As a scheduler, I want an interrupted Instagram or Facebook carousel to resume from its last confirmed media item so that a Worker timeout does not lose progress.
- As an operator, I want an ambiguous Meta publish result to stop safely so that an automatic retry cannot create a duplicate public post.
- As an operator, I want retry to affect only the selected failed post and expose its stage, attempt count, latest error, heartbeat, and deployed build identity.
- As a maintainer, I want publishing isolated from maintenance work and verified in CI so that unrelated sync work cannot consume the publish invocation budget.

## RED → GREEN task report

| Behavior | RED evidence | GREEN evidence | Guarantee |
|---|---|---|---|
| Durable Instagram carousel and ambiguous result recovery | Commit `caea3c5`; focused run: 7 intended failures | `test/meta-publish.test.mjs`; focused run: 51/51 pass | One child is checkpointed per tick; a `publish_unknown` job is verified and never blindly published twice. |
| Atomic post-specific retry, stale recovery, cron isolation, UI request timeout | Commit `caea3c5`; endpoint/repository/UI assertions failed | `test/campaign-approval.test.mjs`, `test/publish-queue.test.mjs`, `test/safe-publish-ui.test.mjs` pass | A retry queues only the selected failed live post; generic POST/PUT no longer launches the global publisher. |
| Durable Facebook album, Node parity, publisher health, CI, UI progress | Commit `8d50b24`; focused run: 42/47 pass with 5 intended failures | Focused run: 47/47 pass | Facebook albums checkpoint one photo per tick; Node and Worker expose equivalent retry/health behavior; CI validates tests and Worker packaging. |
| Cross-platform job safety | Commit `4e66745`; targeted run: 0/1 pass (`Missing expected rejection`) | Targeted run: 1/1 pass | A completed Facebook job cannot be mistaken for a completed Instagram publish. |

GREEN implementation checkpoint: commit `d5fe4b8` (`fix: make scheduled social publishing resumable`).

## Test specification

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | Instagram carousel resumes from saved child IDs and performs only one Meta mutation per tick | `durable Instagram carousel checkpoints exactly one child per tick...` | Unit/service integration | PASS |
| 2 | An ambiguous Instagram `media_publish` is reconciled by status and is not repeated | `durable Instagram publisher never repeats media_publish...` | Unit/service integration | PASS |
| 3 | Facebook carousel resumes from saved photo IDs and does not create the feed post early | `durable Facebook carousel checkpoints exactly one photo per tick...` | Unit/service integration | PASS |
| 4 | Retry is atomic and idempotent for one selected failed post | `post-specific retry atomically requeues only the selected failed post` | Repository integration (SQLite) | PASS |
| 5 | Durable media/job checkpoints and append-only attempt history round-trip through the repository | `publish jobs persist resumable media checkpoints...` | Repository integration (SQLite) | PASS |
| 6 | Stale jobs resume only when durable progress exists; completed posts are not replayed | `stale publishing posts requeue recoverable containers...` | Repository integration (SQLite) | PASS |
| 7 | Worker cron gives publishing the invocation budget before maintenance | `scheduled worker isolates publishing from maintenance workloads` | Static integration | PASS |
| 8 | UI calls the selected retry endpoint and shows structured progress/error data | `safe-publish-ui.test.mjs` | UI contract | PASS |
| 9 | The full historical regression suite remains green | `npm test` | Unit + integration | PASS — 180/180 |
| 10 | D1 can apply the complete migration chain including `0013` | `npm run d1:migrate:local` | Local database integration | PASS — 12/12 migrations |
| 11 | The Worker bundle and static assets are deployable | `npm run deploy:check` | Build/deploy validation | PASS — dry run only |
| 12 | Production dependencies have no known registry advisories | `npm audit --omit=dev` | Security | PASS — 0 vulnerabilities |
| 13 | The packaged Worker starts against migrated local D1 and exposes publisher health | local `wrangler dev`, then `GET /api/health` | Runtime E2E | PASS — HTTP 200 with build/heartbeat/failure fields |

## Coverage and known gates

`npm run test:coverage -- --test-reporter=spec` passed the enforced 80% line gate with **89.71% line coverage**, 78.48% branch coverage, and 93.88% function coverage. Runtime entrypoints and database/auth adapters are excluded from the line threshold because they are validated through integration, migration, security, and packaging gates; the state-machine and shared business logic remain included.

No public Meta post was created during verification. Remote D1 migration, Worker deployment, GitHub push, and retrying the two existing failed production posts remain explicit external-action gates. Before any public retry, first deploy the migration/code, verify `/api/health` build identity and heartbeat, then use a non-public safe test and manually reconcile any `publish_unknown` record.
