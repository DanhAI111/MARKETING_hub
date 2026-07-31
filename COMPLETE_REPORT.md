# COMPLETE REPORT — Revenue-Driven Marketing Planner + AI Budget Allocation

Station: **COMPLETE** (cuối pipeline) · Date: 2026-07-28 · Branch: `feature/mkt-revenue-planner`
Product code: **NOT modified** (station chỉ xác nhận + báo cáo).

## 1. Tóm tắt feature

Người dùng nhập **doanh thu mục tiêu** (trực tiếp, hoặc DT năm trước × %tăng trưởng).
Hệ thống tính ngược:

- **Ngân sách MKT** = DT mục tiêu × tỷ lệ chi phí.
- **Funnel** Lead → SQL → Đơn hàng → Khách hàng, và **CPS** (cost per sale).
- **Phân bổ đa tầng** T1 (tạo KH/thương hiệu) → T2 (cốt lõi/mới/thử nghiệm) →
  T3 (Digital/Traditional) → T4 (hạng mục chi tiết) + kênh + nội dung.
- **Rải theo tháng** ngân sách + mục tiêu DT theo hệ số MoM, normalize giữ tổng đúng.
- Nút **"AI gợi ý phân bổ"**: gọi Claude (`claude-opus-5`) đề xuất tỷ trọng theo
  ngành/mục tiêu; **luôn có fallback công thức** khi thiếu key / API lỗi.

Engine tính **thuần** (`shared/revenue-planner.mjs`), tách khỏi I/O — dùng chung cho
Express, Cloudflare Worker và test. AI là lớp gợi ý mỏng, không đọc env (nhận `apiKey`
từ caller).

## 2. Định nghĩa hoàn thành (FEATURE_BRIEF.md §"Định nghĩa hoàn thành")

| # | Tiêu chí | Trạng thái | Bằng chứng |
|---|---|---|---|
| 1 | Nhập DT mục tiêu → bảng ngân sách + funnel + phân bổ đa tầng + rải tháng | ✅ ĐẠT | `computePlan()` (`shared/revenue-planner.mjs`) + UI `js/pages/planner.js` |
| 2 | Nút "AI gợi ý phân bổ" hoạt động (có fallback công thức) | ✅ ĐẠT | `suggestAllocation()` (`shared/ai-allocation.mjs`) → `suggestWeightsHeuristic` fallback |
| 3 | Migration + repository + API endpoint + UI wired | ✅ ĐẠT | `marketingPlans` whitelist ở `server/repository.js` + `worker/repository.js`; route `compute` + `ai-suggest`; UI + sidebar + PAGE_META |
| 4 | `npm test` xanh + test cho engine | ✅ ĐẠT | **94/94 pass**; `test/revenue-planner*.test.mjs`, `test/ai-allocation.test.mjs` |

Số DAVA khớp chính xác (tolerance 1e-3): target `1.501.500.000`, ngân sách `600.600.000`,
funnel `100.1 / 200.2 / 667.33`, CPS `4.800.000`.

> Ghi chú storage: dùng generic collection `marketingPlans` trên `app_items` (không tạo
> bảng riêng — YAGNI, theo PLAN §2). "Migration" = whitelist collection, không đổi schema.

## 3. Xác nhận chất lượng / bảo mật

- **`npm test`**: `# tests 94 · # pass 94 · # fail 0` — **XANH**.
- **Không secret hardcode**: grep `sk-ant` / `apiKey='...'` = 0 hit. Key đọc từ env —
  Express `process.env.ANTHROPIC_API_KEY`, Worker `env.ANTHROPIC_API_KEY`. `.env.example`
  và `.dev.vars.example` để trống, có ghi chú `wrangler secret put`.
- **Validate ở boundary**: `validateInputs()` gate mọi entry — route `compute`/`ai-suggest`
  (Express + Worker) gọi `assertPlannerInputs` → `400` khi lỗi; `computePlan` `throw` nếu
  input không hợp lệ (không tính bừa). Input rỗng → 400; có field xấu → errors rõ ràng.
- **Không nuốt lỗi**: AI lỗi/timeout → `onError` callback log `console.error('AI allocation
  failed; using fallback: …')` rồi trả fallback có warning `AI_UNAVAILABLE` — thất bại
  hiển thị, không im lặng.
- **Prompt-injection guard**: `industry`/`goal` được đánh dấu "dữ liệu không đáng tin cậy";
  giá trị bị cắt độ dài; `sanitizeWeightOverrides` chỉ nhận key trong schema + ép số + clamp [0,1].
- **Rate limit**: route `ai-suggest` giới hạn 20 req/60s (Express + Worker) chống lạm dụng token.

## 4. File tạo / sửa (diff `master...HEAD`)

### Tạo mới
| Path | Vai trò |
|---|---|
| `shared/revenue-planner.mjs` | Engine thuần: funnel, ngân sách, phân bổ đa tầng, rải tháng, validate, heuristic |
| `shared/ai-allocation.mjs` | Lớp AI: gọi Anthropic, parse/sanitize weights, fallback heuristic |
| `server/ai-allocation.js` | Shim CJS cho Express (dynamic import ESM) |
| `js/pages/planner.js` | Trang UI vanilla: form → tính → render bảng/funnel/phân bổ/tháng + nút AI |
| `css/planner.css` | Style trang planner |
| `test/revenue-planner.test.mjs` | Test engine (funnel, allocation, monthly, validate) |
| `test/revenue-planner-dava.test.mjs` | Test khớp số DAVA thật (station TEST thêm) |
| `test/revenue-planner-wiring.test.mjs` | Test wiring FE/route |
| `test/ai-allocation.test.mjs` | Test AI fallback (thiếu key → heuristic, shape đúng) |
| `docs/features/revenue-driven-marketing-planner.tdd.md` | Tài liệu TDD |

### Sửa
| Path | Thay đổi |
|---|---|
| `server/index.js` | Route `POST /api/marketing-plans/compute` + `.../ai-suggest` |
| `worker/index.js` | Mirror 2 route trên (dùng `env.ANTHROPIC_API_KEY`) |
| `server/repository.js` · `worker/repository.js` | Thêm `marketingPlans` vào `APP_COLLECTIONS` |
| `js/store.js` · `js/api.js` | Thêm `marketingPlans` vào REMOTE/SYNC collections + sub-API |
| `js/app.js` · `js/components/sidebar.js` | `PAGE_META.planner` + NAV item "Kế hoạch doanh thu" |
| `js/utils.js` | Helper bổ trợ (format) |
| `manage_MKT.html` | `<script src="js/pages/planner.js">` + link CSS |
| `.env.example` · `.dev.vars.example` | `ANTHROPIC_API_KEY=` (trống) + `ANTHROPIC_MODEL=claude-opus-5` |
| `wrangler.jsonc` | Khai báo var `ANTHROPIC_MODEL` (key là secret, không đặt ở đây) |
| `test/no-emoji-ui.test.mjs` | Cập nhật cho nav item mới |

Tổng: **23 file, +1979 / −4**.

## 5. Cách chạy thử

```bash
# (tùy chọn) bật AI thật: tạo .env từ .env.example rồi điền ANTHROPIC_API_KEY.
# Không có key → nút AI vẫn chạy, dùng fallback công thức.

npm test          # xác nhận 94/94 xanh
npm run dev:node  # khởi động Express tại http://localhost:3000
```

Trong trình duyệt → mở `http://localhost:3000` → sidebar **"Kế hoạch doanh thu"** (📈):

1. Nhập **DT mục tiêu** (hoặc DT năm trước + %tăng trưởng), AOV, tỷ lệ MKT, SQL/Lead,
   Order/SQL, MoM, ngành.
2. Bấm **"Tính kế hoạch"** → xem thẻ tổng (DT mục tiêu / ngân sách / CPS), funnel,
   bảng phân bổ đa tầng T1→T4 + kênh/nội dung, bảng 12 tháng.
3. Bấm **"AI gợi ý phân bổ"** → nạp tỷ trọng đề xuất + lý do; badge `source` (AI /
   công thức); banner cảnh báo nếu tổng ≠ 100% / CPS bất hợp lý.
4. **"Lưu kế hoạch"** → lưu qua collection `marketingPlans`; load lại từ danh sách.

Worker (Cloudflare): `npm run build:assets` rồi `npm run dev`; key production đặt qua
`wrangler secret put ANTHROPIC_API_KEY`.

## 6. Hạng mục thiếu

Không có hạng mục bắt buộc nào thiếu — cả 4 tiêu chí "Định nghĩa hoàn thành" đều đạt.

Ghi nhận phạm vi cố ý hoãn (YAGNI, đã ghi trong PLAN — không phải nợ chặn merge):

- **Chưa có bảng riêng** cho plan; dùng `app_items` collection. Upgrade path (khi cần
  query theo tháng/report): thêm DDL `server/db.js` + nhánh PG + `migrations/0009_*.sql`
  + repo methods chuyên biệt.
- **Chưa có E2E** (Playwright) cho luồng UI; hiện phủ bằng unit + wiring test. Thêm khi
  cần bảo chứng luồng trình duyệt.
- AI đề xuất **override một phần** tỷ trọng (không sinh toàn bộ schema tự do) — có chủ ý
  để giữ ổn định + dễ validate.

## 7. Lệnh git merge `feature/mkt-revenue-planner` → `master`

> Đây là thao tác hợp nhất — chạy tuần tự và kiểm tra ở từng bước. Station này KHÔNG merge.

```bash
# 1. Đảm bảo test xanh trên nhánh feature trước khi merge.
git checkout feature/mkt-revenue-planner
npm test

# 2. Cập nhật master mới nhất.
git checkout master
git pull origin master

# 3. Merge (giữ lịch sử feature bằng merge commit).
git merge --no-ff feature/mkt-revenue-planner -m "feat: revenue-driven marketing planner + AI budget allocation"

# 4. Chạy lại test trên master sau merge để chắc chắn.
npm test

# 5. Đẩy master và (tùy chọn) xóa nhánh feature.
git push origin master
git branch -d feature/mkt-revenue-planner
git push origin --delete feature/mkt-revenue-planner   # nếu nhánh đã đẩy lên remote
```

Thay bằng workflow PR nếu repo yêu cầu review trước merge:

```bash
git push -u origin feature/mkt-revenue-planner
gh pr create --base master --head feature/mkt-revenue-planner \
  --title "feat: revenue-driven marketing planner + AI budget allocation" \
  --body-file COMPLETE_REPORT.md
```
