# TEST REPORT — Revenue-Driven Marketing Planner

Station: **TEST** · Date: 2026-07-28 · Runner: `node --test` (`npm test`)
Product code: **NOT modified** (test-only station).

## Result

```
# tests 94
# pass  94
# fail  0
# duration_ms ~196
```

**PASS — all 94 tests green.**

## Scope reviewed

Engine `shared/revenue-planner.mjs` + AI layer `shared/ai-allocation.mjs`.
Existing tests already covered: funnel (direct target), derived target,
allocation tier sums, monthly spread, immutability, input validation, weight
warnings, heuristic fallback, AI parse/merge, AI error → fallback.

## Added tests — `test/revenue-planner-dava.test.mjs`

Gap: existing derived-target test only asserted `targetRevenue`, not the full
funnel. Added exact DAVA reference check through `computePlan` (float tolerance
1e-3, since `1_365_000_000 * 1.1` carries binary rounding).

Verified against spec numbers (`prevRevenue:1365000000, growth:1.1,
mktRatio:0.4, aov:15000000, sqlPerLead:0.3, orderPerSql:0.5, monthlyMoM:0.05,
months:3`):

| field | expected | actual | ok |
|---|---|---|---|
| targetRevenue | ≈1 501 500 000 | 1 501 500 000.0000002 | ✅ |
| mktBudget | ≈600 600 000 | 600 600 000.0000001 | ✅ |
| customers | ≈100.1 | 100.10000000000002 | ✅ |
| sql | ≈200.2 | 200.20000000000005 | ✅ |
| leads | ≈667.33 | 667.3333333333335 | ✅ |
| customerBudget | ≈480 480 000 | 480 480 000.0000001 | ✅ |
| cps | ≈4 800 000 | 4 800 000 | ✅ |

Plus: `months:3` honored; monthly budget/revenue sums reconcile to funnel;
all 6 allocation tiers (tier1–4, channels, content) weights sum = 1.0 and
amounts sum = mktBudget.

## Fallback / validation coverage (pre-existing, confirmed passing)

- Missing API key → heuristic fallback, no `fetch` call, `source:'fallback'`,
  weights normalized. (`test/ai-allocation.test.mjs`)
- AI HTTP 503 → `onError` fired, `AI_UNAVAILABLE` warning, fallback returned.
- Bad input (`targetRevenue:0`, `aov:-1`, `mktRatio:1`, `sqlPerLead:0`,
  `orderPerSql:1.1`, `null`) → `validateInputs` rejects; `computePlan` throws.
  (`test/revenue-planner.test.mjs`)

## Notes

- Float tolerance used throughout (`1e-3` / `1e-6` / `1e-9` / `1e-12`), no
  exact-equality on derived floats — correct given `prev*growth` rounding.
- No product code changed. Only added `test/revenue-planner-dava.test.mjs`.
