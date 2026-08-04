# TDD evidence: multi-page scheduling

## Source and user journey

No plan file was supplied. The journey was derived from the requested behavior:

> As a marketing operator, I want to schedule the same content for multiple pages in one action, so that I do not have to repeat the form for every page.

Each selected page receives an independent scheduled post with the same content, media, time, campaign, approval status, and publish mode.

## RED / GREEN evidence

| Stage | Command | Result | Evidence |
|---|---|---|---|
| RED | `node --test test/multi-page-schedule.test.mjs` | Expected failure | `ERR_MODULE_NOT_FOUND` for the not-yet-created `js/schedule-batch.js` helper. Checkpoint: `ff98214`. |
| GREEN | `node --test test/multi-page-schedule.test.mjs` | 6/6 passed | Batch construction, selection validation, duplicate cross-post protection, isolated failures, and UI wiring passed. Checkpoint: `3a319a4`. |
| Regression | `npm test` | 124/124 passed | All repository tests passed with no skipped or failed tests. |
| Coverage | `node --experimental-test-coverage --test test/multi-page-schedule.test.mjs` | Passed | `schedule-batch.js`: 100% lines, 88.10% branches, 100% functions. |
| Build | `WRANGLER_LOG_PATH=/tmp/mkt-hub-multi-page-deploy-check.log npm run deploy:check` | Passed | 36 assets read; Worker bundle and bindings validated with `wrangler deploy --dry-run`. |

## Test specification

| # | What is guaranteed | Test / check | Type | Result |
|---|---|---|---|---|
| 1 | Every selected page receives its own payload with the same scheduling fields and an isolated media array. | `buildEntries creates one independent schedule...` | Unit | PASS |
| 2 | Saving with no selected page is rejected. | `validateSelection requires at least one page...` | Unit | PASS |
| 3 | If any selected Instagram page has upload/base64 media or video, the batch is rejected with the affected page name. | `validateSelection requires at least one page...` | Unit | PASS |
| 4 | Selecting a Facebook page and its paired Instagram destination while Facebook cross-posting is enabled is blocked to prevent duplicate Instagram posts. | `validateSelection blocks duplicate Instagram delivery...` | Unit | PASS |
| 5 | Safe test mode still requires the backend and supports only Facebook/Instagram. | `validateSelection keeps safe testing limited...` | Unit | PASS |
| 6 | A failure on one page does not stop schedules for the remaining pages, and both result groups are reported. | `execute continues after one page fails...` | Unit | PASS |
| 7 | The manual modal loads the batch helper and exposes checkboxes plus select-all controls. | `manual schedule UI exposes multi-page selection...` | UI contract | PASS |

## Browser QA

The app was served locally with reversible UI sample data. No save/publish action was performed.

- Desktop 1200px: initial `1/3` selection became `3/3` after **Chọn tất cả**; save label changed from `Lưu 1 lịch đăng` to `Lưu 3 lịch đăng`; no horizontal overflow or console exception.
- Mobile 375x812: selector rendered as one column, modal stayed inside the viewport, footer remained present, and clearing the selection produced `0/3` plus `Lưu 0 lịch đăng`.
- Visual regression baseline: none, so pixel-level regression comparison is inconclusive; structural and responsive checks passed.

## Known gaps

- Browser QA intentionally did not press **Lưu** because a full UI submission is a mutating action. Payload creation and partial-failure behavior are covered by unit tests.
- The feature uses the existing per-post API. Successful pages remain saved if another page fails; the UI deselects successes so retrying does not duplicate them.
- No database migration or dependency change is required.
