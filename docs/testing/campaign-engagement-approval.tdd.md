# Campaign, engagement, and approval TDD evidence

## Source and user journeys

No implementation plan file was present. The journeys were reconstructed from the
unfinished branch diff:

- A marketer can create a campaign and associate posts, ads, events, expenses,
  fanpages, dates, goals, and a budget with it.
- A marketer can see campaign spend, revenue, ROAS, and member counts.
- Deleting a campaign removes its links without deleting its member records.
- A scheduled post that is pending or rejected cannot be claimed by the automatic
  publisher.
- A reviewer can approve or reject a scheduled post from the publishing queue.
- Synced Facebook and Instagram posts retain their organic engagement counts.
- User-controlled text remains safe when rendered in quoted HTML attributes.

## RED and GREEN evidence

| Behavior | RED evidence | GREEN evidence |
|---|---|---|
| Approval gate | `node --test test/campaign-approval.test.mjs` claimed approved, pending, and rejected posts | The same command claims only the approved post |
| Backend campaign unlink | The campaign delete test left `campaignId` on posts and app items | The same test confirms links are cleared and records remain |
| Local campaign unlink | The local store test left all member links intact | The same test confirms posts, ads, events, and expenses are unlinked |
| Attribute escaping | `node --test test/utils-csv.test.mjs` left quote characters unescaped | The same test now escapes double and single quotes as entities |

## Test specification

| # | Guarantee | Test target | Type | Result |
|---|---|---|---|---|
| 1 | Only approved due posts enter the publishing claim | `test/campaign-approval.test.mjs` | Integration | PASS |
| 2 | Campaign deletion preserves members and clears their links | `test/campaign-approval.test.mjs` | Integration | PASS |
| 3 | Local campaign totals and unlink behavior remain correct | `test/campaign-approval.test.mjs` | Unit | PASS |
| 4 | Facebook reactions, comments, and shares are persisted | `test/meta-publish.test.mjs` | Unit | PASS |
| 5 | Instagram likes and comments are persisted | `test/meta-publish.test.mjs` | Unit | PASS |
| 6 | Quoted HTML attributes cannot be broken by user text | `test/utils-csv.test.mjs` | Unit | PASS |
| 7 | Existing repository, sync, publishing, auth, and CSV behavior remains green | `npm test` | Regression | PASS |
| 8 | D1 migrations, including `0008`, apply locally | `npm run d1:migrate:local` | Integration | PASS |
| 9 | Cloudflare build completes without deployment | `npm run deploy:check` | Build | PASS |

## Coverage and known gaps

`node --experimental-test-coverage --test` passed the full suite. Overall measured
line coverage is 65.48%, below the repository skill's 80% target because the
existing Node/Worker auth, repository, and Meta modules have substantial
uncovered legacy paths. The new test file itself measured 99.47% line coverage,
and the changed engagement paths are directly covered. Browser behavior was
smoke-tested with local headless Chrome at desktop and narrow responsive
breakpoints; no committed visual baseline exists, so visual regression status is
inconclusive rather than a formal pass.

## Merge evidence

- RED checkpoint: `1f62533 test: cover campaign unlink and post approval gates`
- GREEN: full test suite, D1 local migration, asset build, Cloudflare dry-run, JS
  syntax checks, `git diff --check`, and dependency audit completed successfully.
