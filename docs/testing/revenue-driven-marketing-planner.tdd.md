# TDD evidence — Revenue-driven marketing planner

## Source

- Plan: [`PLAN.md`](../../PLAN.md)
- Brief: [`FEATURE_BRIEF.md`](../../FEATURE_BRIEF.md)
- Date: 2026-07-28

## User journeys

1. Người dùng nhập doanh thu mục tiêu hoặc doanh thu năm trước + tăng trưởng để nhận
   ngân sách marketing, funnel, phân bổ đa tầng và kế hoạch 12 tháng.
2. Người dùng yêu cầu AI gợi ý tỷ trọng và vẫn nhận được công thức dự phòng có giải
   thích khi thiếu key hoặc Anthropic lỗi.
3. Người dùng lưu, tải lại, cập nhật và xóa kế hoạch qua collection `marketingPlans`.
4. Cả Express và Cloudflare Worker phải trả cùng kết quả, validate input tại API
   boundary và rate-limit endpoint AI.

## RED / GREEN evidence

| Stage | Command | Evidence |
|---|---|---|
| Engine RED | `node --test test/revenue-planner.test.mjs` | Failed with `ERR_MODULE_NOT_FOUND` for `shared/revenue-planner.mjs`; checkpoint `bf8348a`. |
| Engine GREEN | `node --test test/revenue-planner.test.mjs` | 8/8 passed; checkpoint `e2bf9eb`. |
| AI RED | `node --test test/ai-allocation.test.mjs` | Failed with `ERR_MODULE_NOT_FOUND` for `shared/ai-allocation.mjs`; checkpoint `72bd087`. |
| AI GREEN | `node --test test/ai-allocation.test.mjs test/revenue-planner.test.mjs` | 11/11 passed; checkpoint `3439e70`. |
| Final feature suite | `npm test` | 92/92 passed, 0 failed/skipped. |
| Feature coverage | `node --test --experimental-test-coverage test/revenue-planner.test.mjs test/ai-allocation.test.mjs` | 93.81% lines, 83.24% branches, 97.18% functions. |

## Guarantee matrix

| # | What is guaranteed | Test / validation | Type | Result |
|---|---|---|---|---|
| 1 | Direct target revenue takes precedence and reverse funnel math is correct. | `test/revenue-planner.test.mjs` | Unit | PASS |
| 2 | Previous revenue × growth derives the annual target. | `test/revenue-planner.test.mjs` | Unit | PASS |
| 3 | Tier 1–4 allocation totals match the marketing budget and detailed items retain their groups. | `test/revenue-planner.test.mjs` | Unit | PASS |
| 4 | MoM compounding is normalized to preserve exact annual budget and revenue totals. | `test/revenue-planner.test.mjs` | Unit | PASS |
| 5 | Engine outputs/default weights are immutable and invalid boundaries are rejected. | `test/revenue-planner.test.mjs` | Unit | PASS |
| 6 | Invalid totals, high marketing ratio and CPS above AOV produce visible warnings. | `test/revenue-planner.test.mjs` | Unit | PASS |
| 7 | Missing API key never calls Anthropic and returns a normalized heuristic. | `test/ai-allocation.test.mjs` | Unit | PASS |
| 8 | AI JSON accepts only known numeric keys, merges defaults and rejects bad totals. | `test/ai-allocation.test.mjs` | Unit | PASS |
| 9 | Upstream AI failures call `onError` and return a visible fallback warning. | `test/ai-allocation.test.mjs` | Unit | PASS |
| 10 | Server/Worker whitelist, client CRUD/API, route wiring and empty key examples remain connected. | `test/revenue-planner-wiring.test.mjs` | Integration/static | PASS |
| 11 | Express compute returns 200, invalid input returns 400, no-key AI returns fallback, and generic CRUD returns 201/200/204. | Local `curl` smoke test on port 3105 | Integration | PASS |
| 12 | Vietnamese UI computes 4 KPI cards, 32 allocation rows, 12 monthly rows, applies AI fallback reasons and saves a named plan. | `ego-browser` E2E | E2E | PASS |

## Build and security evidence

- `npm run build:assets`: PASS.
- `npm run deploy:check`: Worker dry-run completed and recognized D1, assets and
  `ANTHROPIC_MODEL`; Wrangler could not write its optional log outside the sandbox.
- `npm audit --audit-level=high`: `found 0 vulnerabilities`.
- Secret scan: no hardcoded Anthropic key; `.env.example` and `.dev.vars.example`
  keep `ANTHROPIC_API_KEY=` empty.
- `git diff --check`: PASS.

## Known gaps

- A live paid Anthropic request was intentionally not sent. Success response parsing
  is covered with a deterministic mocked HTTP response; missing-key and HTTP 503
  fallback paths are covered.
- The first Playwright connector attempt was unavailable because its Chrome extension
  was not installed. The full browser journey was completed with the repository's
  Chromium `ego-browser` harness instead.
