# PLAN — Revenue-Driven Marketing Planner + AI Budget Allocation

Spec: `FEATURE_BRIEF.md`. Repo bị tách worktree: file nguồn nằm trong repo `update/`
(đường dẫn dưới đây là repo-relative: `server/`, `worker/`, `shared/`, `js/`, `css/`,
`migrations/`, `test/`). PLAN này ghi ở worktree `feature-mkt-revenue-planner/`.

Nguyên tắc: engine tính toán THUẦN, tách khỏi I/O → test bằng `node --test`. AI chỉ
là lớp gợi ý tỷ trọng, LUÔN có fallback công thức. Không thêm framework FE. Không
hardcode key. Validate ở boundary. Lưu qua collection generic `marketingPlans`
(app_items) — không cần bảng riêng.

---

## 0. Quyết định kiến trúc (chốt trước khi build)

- **Storage**: dùng generic collection `marketingPlans` trên bảng `app_items` sẵn có
  (JSON blob per plan). KHÔNG tạo bảng riêng → không đụng schema SQLite/PG/D1 phức tạp,
  chỉ whitelist thêm 1 collection. Mỗi plan = 1 doc `{ id, name, inputs, result, createdAt, updatedAt }`.
  `result` là output engine (cache), luôn tính lại được từ `inputs`.
- **Engine THUẦN**: `shared/revenue-planner.mjs` — ESM, export hàm thuần, KHÔNG import
  I/O, KHÔNG đọc env. Cả Express (qua dynamic `import()` như `google-sheets.mjs`) lẫn
  Worker (import trực tiếp ESM) lẫn test đều dùng chung 1 file này.
- **AI**: `shared/ai-allocation.mjs` — nhận `inputs` + `apiKey` (đọc env ở caller, KHÔNG
  đọc trong module thuần-ish này). Nếu thiếu key hoặc API lỗi → gọi engine fallback
  (`suggestWeightsHeuristic`) trả tỷ trọng mặc định + lý do. Trả cùng shape dù AI hay fallback.
- **Weights nguồn chân lý**: các hằng T1..T4 + kênh/nội dung + MoM đặt trong
  `revenue-planner.mjs` (DEFAULT_WEIGHTS). AI chỉ override một phần các tỷ trọng đó.

---

## 1. Files cần tạo / sửa

### Tạo mới
| Path | Vai trò |
|---|---|
| `shared/revenue-planner.mjs` | Engine THUẦN: funnel + ngân sách + phân bổ đa tầng + rải tháng + validate + heuristic suggest. Export ESM. |
| `shared/ai-allocation.mjs` | Lớp AI: gọi Anthropic (fetch), parse tỷ trọng, fallback về heuristic của engine. Nhận `{ inputs, apiKey, model }`. |
| `server/ai-allocation.js` | Shim CommonJS cho Express: `require`-able wrapper dynamic-import `shared/ai-allocation.mjs` (giống cách `server/index.js` import `../shared/google-sheets.mjs`). |
| `js/pages/planner.js` | Trang UI vanilla IIFE: form input → gọi API tính → render bảng ngân sách/funnel/phân bổ/tháng + nút "AI gợi ý phân bổ". `App.registerPage('planner', PlannerPage)`. |
| `test/revenue-planner.test.mjs` | Test engine: funnel math, tổng tỷ trọng=1, phân bổ đa tầng, rải MoM, validate cảnh báo ≠100%/CPS xấu. |
| `test/ai-allocation.test.mjs` | Test lớp AI fallback: thiếu key → dùng heuristic, shape đúng, tổng≈1. |

### Sửa
| Path | Thay đổi |
|---|---|
| `server/repository.js` | Thêm `'marketingPlans'` vào `APP_COLLECTIONS`. |
| `worker/repository.js` | Thêm `'marketingPlans'` vào `APP_COLLECTIONS` (mirror). |
| `server/index.js` | Thêm route `POST /api/marketing-plans/compute` (tính engine, không lưu) + `POST /api/marketing-plans/ai-suggest` (gợi ý tỷ trọng). CRUD lưu plan dùng route generic `/api/collections/marketingPlans` sẵn có. |
| `worker/index.js` | Mirror 2 route trên (đặt trước block generic collections hoặc sau, miễn match path cụ thể trước). Dùng `env.ANTHROPIC_API_KEY`. |
| `js/store.js` | Thêm `marketingPlans` vào `REMOTE_COLLECTIONS` + sub-API (giống `campaigns`). |
| `js/api.js` | Thêm `marketingPlans` vào `SYNC_COLLECTIONS` (để hydrate danh sách plan đã lưu). |
| `js/app.js` | Thêm entry `planner` vào `PAGE_META` (title/subtitle tiếng Việt). |
| `js/components/sidebar.js` | Thêm `{ id:'planner', label:'Kế hoạch doanh thu', icon:'📈' }` vào `NAV_ITEMS`. |
| `manage_MKT.html` | Thêm `<script src="js/pages/planner.js">` (sau các page khác) + link `css/planner.css` nếu tách CSS. |
| `css/pages.css` (hoặc `css/planner.css` mới) | Style form + bảng phân bổ + funnel. Dùng biến màu sẵn có. |
| `.env.example` | Thêm `ANTHROPIC_API_KEY=` và `ANTHROPIC_MODEL=claude-opus-5`. |
| `.dev.vars.example` | Thêm `ANTHROPIC_API_KEY=` và `ANTHROPIC_MODEL=claude-opus-5` (Worker). |
| `wrangler.toml` (nếu liệt kê vars) | Khai báo `ANTHROPIC_MODEL` (KHÔNG đặt key ở đây — key là secret qua `wrangler secret put`). |

---

## 2. Schema / Migration

**Không cần bảng mới.** Lưu qua `app_items` (đã có ở SQLite `server/db.js`, PG
`initPostgres()`, D1 migrations). Chỉ whitelist collection:

- `server/repository.js`: `APP_COLLECTIONS = [... , 'marketingPlans']`
- `worker/repository.js`: `APP_COLLECTIONS = [... , 'marketingPlans']`

Doc shape lưu trong `app_items.data` (JSON):
```
{ id, name, inputs:{...}, result:{...cache...}, createdAt, updatedAt }
```
`ensureColumn`/DDL: không đổi. Nếu sau này cần query theo tháng/report → mới cân nhắc
bảng riêng + migration `migrations/0009_marketing_plans.sql`. Hiện tại YAGNI.

> Ghi chú: nếu reviewer yêu cầu bảng riêng, upgrade path = thêm DDL vào `server/db.js`,
> nhánh PG trong `initPostgres()`, file `migrations/0009_*.sql` cho D1, + repo methods
> `listMarketingPlans/upsertMarketingPlan/...`. Không làm ở vòng này.

---

## 3. Engine THUẦN — `shared/revenue-planner.mjs`

Export (tất cả thuần, in→out, không side effect):

```
export const DEFAULT_WEIGHTS = {
  tier1: { core: 0.8, brand: 0.2 },
  tier2: { core: 0.7, newStrategy: 0.2, experiment: 0.1 },
  tier3: { digital: 0.7, traditional: 0.3 },
  tier4: { seoSocial:0.20, digitalAds:0.15, emailAuto:0.10, martech:0.10,
           fair:0.05, printing:0.05, pressOOH:0.05,
           abm:0.07, influencer:0.07, roadshow:0.06,
           chatbot:0.03, podcast:0.03, gift:0.04 },
  channels: { metaAds:0.2, tiktok:0.1, fb:0.05 },
  content:  { customerService:0.4, promo:0.3, /* ... */ },
  monthlyMoM: 0.05,
};
```

Hàm:
- `computeFunnel(inputs)` → từ DT mục tiêu ngược lên:
  - `targetRevenue = inputs.prevRevenue * inputs.growth` (hoặc dùng `inputs.targetRevenue` nếu nhập trực tiếp)
  - `mktBudget = targetRevenue * inputs.mktRatio`
  - `customers = targetRevenue / inputs.aov`
  - `sql = customers / inputs.orderPerSql`
  - `leads = sql / inputs.sqlPerLead`
  - `customerBudget = mktBudget * tier1.core`, `cps = customerBudget / customers`
- `allocateBudget(mktBudget, weights)` → object đa tầng T1→T4 + kênh + nội dung, mỗi
  node có `{ ratio, amount }`. Amount = mktBudget × tích tỷ trọng theo nhánh.
- `spreadMonthly(mktBudget, targetRevenue, mom, months=12)` → mảng 12 tháng, mỗi phần
  tử `{ month, budget, revenueTarget }`; phân bổ theo hệ số `(1+mom)^i` rồi normalize
  để tổng = mktBudget / targetRevenue (giữ tổng đúng, không lệch do làm tròn).
- `computePlan(inputs, weights=DEFAULT_WEIGHTS)` → gộp: `{ targetRevenue, mktBudget,
  funnel, allocation, monthly, warnings }`. Đây là hàm engine chính API gọi.
- `validateInputs(inputs)` → throw/`{ errors:[] }` khi thiếu/âm/0 ở field bắt buộc
  (aov>0, orderPerSql∈(0,1], sqlPerLead∈(0,1], mktRatio∈(0,1), có prevRevenue×growth
  hoặc targetRevenue).
- `validateWeights(weights)` → `warnings[]`: tổng mỗi tầng ≠ 1 (±0.001), CPS > AOV
  (bất hợp lý), mktRatio quá cao. Dùng cho cảnh báo (brief mục "AI cảnh báo").
- `suggestWeightsHeuristic(inputs)` → trả DEFAULT_WEIGHTS (có thể nhẹ nhàng nudge theo
  ngành nếu `inputs.industry`), + `reasons[]` giải thích ngắn. Đây là FALLBACK khi
  không có AI.

Đặc tính test: thuần → import trực tiếp trong `test/*.mjs`, không eval/regex như
`test/utils-csv.test.mjs` (vì file này có export thật).

---

## 4. API endpoints

CRUD lưu plan: **tái dùng route generic** — không viết mới:
- `GET/POST /api/collections/marketingPlans`
- `PUT/DELETE /api/collections/marketingPlans/:id`

Thêm 2 route chuyên biệt (Express `server/index.js`, mirror Worker `worker/index.js`):

1. `POST /api/marketing-plans/compute`
   - Body: `inputs`. Gọi `validateInputs` → 400 nếu lỗi. Gọi `computePlan(inputs)`.
   - Trả `{ ...result }`. KHÔNG lưu (client tự lưu qua collection nếu muốn).
   - Express: dynamic `import('../shared/revenue-planner.mjs')` (pattern có sẵn).
   - Bọc `asyncHandler`, lỗi validate set `err.status=400`.

2. `POST /api/marketing-plans/ai-suggest`
   - Body: `inputs` (+ optional `industry`, `goal`).
   - Đọc key: Express `process.env.ANTHROPIC_API_KEY`; Worker `env.ANTHROPIC_API_KEY`.
     Model: `ANTHROPIC_MODEL` fallback `claude-opus-5`.
   - Gọi `suggestAllocation({ inputs, apiKey, model })` từ `shared/ai-allocation.mjs`.
   - Trả `{ weights, reasons, warnings, source:'ai'|'fallback' }`.
   - Rate limit như các route khác (`rateLimit('ai-suggest',{limit:20,windowSeconds:60})`
     ở Express; `requireRateLimit` ở Worker) để tránh lạm dụng token API.

Đặt route match path cụ thể TRƯỚC block generic `^/api/collections/...` trong Worker
để không bị nuốt (path khác prefix nên an toàn, nhưng đặt sớm cho rõ).

---

## 5. Lớp AI — `shared/ai-allocation.mjs`

```
export async function suggestAllocation({ inputs, apiKey, model }) {
  if (!apiKey) return { ...heuristic(inputs), source: 'fallback' };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{ 'x-api-key': apiKey, 'anthropic-version':'2023-06-01',
                'content-type':'application/json' },
      body: JSON.stringify({ model, max_tokens: 1024, messages:[{ role:'user',
        content: buildPrompt(inputs) }] })
    });
    if (!res.ok) throw new Error('AI HTTP '+res.status);
    const data = await res.json();
    const weights = parseWeights(data);          // strict: chỉ nhận số, validate tổng
    const merged = mergeWithDefaults(weights);    // AI chỉ override 1 phần
    const warnings = validateWeights(merged);     // từ engine
    return { weights: merged, reasons: parseReasons(data), warnings, source:'ai' };
  } catch {
    return { ...heuristic(inputs), source: 'fallback' };  // KHÔNG nuốt im lặng → log ở caller
  }
}
```
- Prompt yêu cầu Claude trả JSON tỷ trọng theo đúng schema DEFAULT_WEIGHTS + giải thích
  ngắn từng tầng (brief: "giải thích tại sao").
- `parseWeights` validate nghiêm: bỏ field lạ, ép số, clamp [0,1]; nếu parse fail →
  ném lỗi → rơi vào fallback.
- `heuristic` = `suggestWeightsHeuristic` từ engine. Fallback trả `source:'fallback'`
  để UI hiển thị "đang dùng công thức mặc định".
- KHÔNG đọc env trong file này (nhận `apiKey` từ caller) → dễ test, không phụ thuộc I/O.
- `server/ai-allocation.js`: wrapper CJS `module.exports = { suggestAllocation: (...a)=>
  import('../shared/ai-allocation.mjs').then(m=>m.suggestAllocation(...a)) }`.

Bảo mật: key chỉ từ env (`.env` / Worker secret). `.env.example`/`.dev.vars.example`
để trống. Không log key. Lỗi API → message chung, không leak.

---

## 6. UI vanilla — `js/pages/planner.js`

Theo template IIFE của `js/pages/expenses.js`:
- `render(el)`: form nhập (DT năm trước / hoặc DT mục tiêu, %growth, mktRatio, AOV,
  SQL/Lead, Order/SQL, MoM, industry). Nút **"Tính kế hoạch"** → `POST /api/marketing-plans/compute`.
- Render output: (a) thẻ tổng (DT mục tiêu, ngân sách MKT, CPS); (b) funnel Lead→SQL→
  Order→KH (dùng `Chart.drawBar` nếu có); (c) bảng phân bổ đa tầng T1→T4 + kênh/nội dung
  (`Utils.formatVND`); (d) bảng 12 tháng (budget + revenueTarget), donut tỷ trọng
  (`Chart.drawDonut`).
- Nút **"AI gợi ý phân bổ"** → `POST /api/marketing-plans/ai-suggest` → nạp weights vào
  state, tính lại, hiển thị `reasons` (tooltip/list) + badge `source` (AI / công thức) +
  `warnings` (banner vàng nếu tổng≠100% hoặc CPS xấu).
- Nút **"Lưu kế hoạch"** → `Store.marketingPlans.create/update` (qua collection generic).
  Danh sách plan đã lưu để load lại (hydrate từ `SYNC_COLLECTIONS`).
- Escape mọi giá trị người dùng qua `Utils.escapeHtml`. Validate số ở client trước khi
  gọi (fail fast), server vẫn validate lại (boundary thật).
- Wiring: `App.registerPage('planner', PlannerPage)`; `PAGE_META.planner`; `NAV_ITEMS`;
  `<script>` trong `manage_MKT.html`.

CSS: thêm `css/planner.css` (link trong HTML) hoặc block trong `css/pages.css`. Dùng
biến màu/spacing sẵn có, không thêm lib.

---

## 7. Thứ tự build

1. **Engine** `shared/revenue-planner.mjs` (thuần, không phụ thuộc gì).
2. **Test engine** `test/revenue-planner.test.mjs` → `npm test` xanh (TDD: viết test
   funnel/allocation/monthly/validate trước hoặc song song). Đây là "định nghĩa hoàn
   thành #4".
3. **AI module** `shared/ai-allocation.mjs` + `server/ai-allocation.js` shim.
4. **Test AI fallback** `test/ai-allocation.test.mjs` (không key → heuristic, shape đúng).
5. **Repo whitelist**: thêm `marketingPlans` vào `APP_COLLECTIONS` (server + worker).
6. **API**: route `compute` + `ai-suggest` ở `server/index.js`, mirror `worker/index.js`.
   Test thủ công qua curl.
7. **FE store/api**: `REMOTE_COLLECTIONS`/`SYNC_COLLECTIONS` + sub-API `marketingPlans`.
8. **UI page** `js/pages/planner.js` + wiring (`app.js` PAGE_META, `sidebar.js` NAV_ITEMS,
   `manage_MKT.html` script/CSS) + `css`.
9. **Env examples**: `.env.example`, `.dev.vars.example` (+ `wrangler.toml` var, secret
   qua `wrangler secret put ANTHROPIC_API_KEY`).
10. **Chạy**: `npm test` (xanh), `npm run dev:node`, thử luồng: nhập DT → Tính → AI gợi ý
    (có/không key) → Lưu → Load lại. `npm run build:assets` cho Worker.

---

## Định nghĩa hoàn thành (map với brief)
- [x] Nhập DT mục tiêu → bảng ngân sách + funnel + phân bổ đa tầng + rải tháng → `computePlan` + UI.
- [x] Nút "AI gợi ý phân bổ" có fallback công thức → `suggestAllocation` + `heuristic`.
- [x] Migration(whitelist)+repository+API+UI wired.
- [x] `npm test` xanh + test cho engine → `test/revenue-planner.test.mjs`.
