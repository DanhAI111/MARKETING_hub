# Safe social publishing — TDD evidence

## Source and journeys

Plan derived from the approved conversation plan.

- A marketer can run a manual Facebook test post without making it public.
- A paired Instagram account is validated through media-container creation without calling `media_publish`.
- Safe-test posts cannot be promoted to live or counted as published through client payloads, retries, cron, or queue processing.
- Completed tests remain visible as test history but are excluded from production KPI and pending-queue selectors.

## RED and GREEN evidence

| Behavior | RED evidence | GREEN evidence |
|---|---|---|
| Facebook unpublished + Instagram container-only | `node --test test/meta-publish.test.mjs test/safe-publish-ui.test.mjs` failed because `testScheduledPost` and the UX/API were missing | Feature tests pass and assert Facebook `published=false` plus zero Instagram `/media_publish` calls |
| Persistence and terminal queue behavior | Repository tests initially failed after the new fields were introduced into writes but not test schemas | `test/campaign-approval.test.mjs` and `test/repository-sheet.test.mjs` pass with mode/result round trips |
| API mutation boundary | `node --test test/campaign-approval.test.mjs` failed because shared `normalizePostMutation` did not exist | The same test passes and proves safe posts remain `safe_test`, approved, and non-published |

## Test specification

| # | Guarantee | Test | Type | Result |
|---|---|---|---|---|
| 1 | Facebook image and video tests use `published=false` | `test/meta-publish.test.mjs` | Unit/integration | PASS |
| 2 | Instagram test creates and checks a container but never publishes it | `test/meta-publish.test.mjs` | Unit/integration | PASS |
| 3 | A safe-test mutation cannot become live or client-marked as published | `test/campaign-approval.test.mjs` | Unit | PASS |
| 4 | Test mode, result JSON, individual claim, and pending exclusion persist correctly | `test/campaign-approval.test.mjs` | Repository integration | PASS |
| 5 | Manual UX and post-specific API wiring are present and tested posts are terminal locally | `test/safe-publish-ui.test.mjs` | UI contract | PASS |
| 6 | Existing application behavior remains green | `npm test` | Regression | PASS (118/118 at final GREEN gate) |

## Coverage and known gaps

- Focused coverage command: `node --test --experimental-test-coverage test/meta-publish.test.mjs test/campaign-approval.test.mjs test/safe-publish-ui.test.mjs`.
- Feature test files report 98–100% line coverage; aggregate imported-module coverage is 55.17% because the repository and Meta modules contain unrelated sync/auth/database paths outside this feature.
- Automated visual Browser QA was inconclusive because the required Playwright Chrome extension is not installed in the environment. DOM contracts, responsive CSS, JavaScript syntax, asset build, and Worker dry-run build were used instead.
