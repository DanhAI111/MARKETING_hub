# Feature: Revenue-Driven Marketing Planner + AI Budget Allocation

## Mục tiêu
Người dùng nhập **doanh thu mục tiêu** (hoặc doanh thu năm trước + % tăng trưởng). Hệ thống tự tính
ngân sách marketing, funnel số liệu, và **phân bổ ngân sách đa tầng có AI hỗ trợ**. Dựa trên tư duy
của bảng kế hoạch DAVA thật (đã phân tích bên dưới).

## Tư duy tính toán (trích từ bảng DAVA thật — GIỮ NGUYÊN logic này)

### Đầu vào
- Doanh thu năm trước (vd 1.365.000.000)
- % tăng trưởng vs năm trước (vd 1.10 = +10%)  → Doanh thu mục tiêu = năm trước × %tăng trưởng
- Tỷ lệ chi phí MKT / doanh thu (vd 0.40)      → Ngân sách MKT = DT mục tiêu × tỷ lệ
- AOV (giá trị đơn TB, vd 15.000.000)
- SQL/Lead (vd 0.30), Order/SQL (vd 0.50)
- % tăng trưởng theo tháng MoM (vd 0.05)
- Thị phần mục tiêu, tỷ lệ giữ chân KH

### Funnel (từ DT mục tiêu ngược lên)
- Số khách hàng = DT mục tiêu / AOV
- SQL = Số KH / (Order/SQL)
- Lead = SQL / (SQL/Lead)
- CPS (cost per sale) = Ngân sách tạo KH / Số KH

### Phân bổ ngân sách (đa tầng, theo Budget Model)
Tầng 1 — mục đích:
- Ngân sách tạo khách hàng (cốt lõi): 0.8
- Ngân sách xây dựng thương hiệu: 0.2

Tầng 2 — nhóm hạng mục:
- Marketing cốt lõi: 0.7 | Chiến lược mới: 0.2 | Thử nghiệm: 0.1

Tầng 3 — Digital vs Traditional: 0.7 / 0.3

Tầng 4 — hạng mục chi tiết (tỷ trọng trong tổng), ví dụ cốt lõi:
- SEO & Social 0.20, Digital Ads 0.15, Email/Automation 0.10, Martech 0.10 (Digital)
- Hội chợ/Triển lãm 0.05, In ấn 0.05, Báo chí/OOH 0.05 (Traditional)
Chiến lược mới: ABM 0.07, Influencer 0.07, Roadshow 0.06
Thử nghiệm: Chatbot AI 0.03, Podcast 0.03, Quà tặng 0.04

Kênh & nội dung có tỷ trọng riêng (Meta Ads 0.2, Tiktok 0.1, FB 0.05; nội dung KH&DV 0.4, KM 0.3...).

### Phân bổ theo tháng
Rải ngân sách + mục tiêu DT theo MoM (vd tháng sau = tháng trước × 1.05).

## Vai trò của AI
- Gợi ý tỷ trọng phân bổ theo ngành/mục tiêu (thay vì bắt user tự điền mọi %).
- Giải thích "tại sao" cho từng phân bổ.
- Cảnh báo khi tỷ lệ tổng ≠ 100% hoặc CPS/ngân sách bất hợp lý.
- Dùng model Claude mới nhất (claude-opus-5 / claude-sonnet-5) qua Anthropic API. KHÔNG hardcode key —
  đọc từ env (xem .dev.vars.example / .env.example). Có fallback tính thuần công thức khi không có API key.

## Ràng buộc kỹ thuật (theo repo hiện tại)
- Backend: Express (`server/`) + Cloudflare Worker (`worker/`) + `shared/`. DB: better-sqlite3 / D1 / Postgres.
- Frontend: vanilla JS (`js/`), CSS (`css/`), build qua `scripts/build-assets.js`. KHÔNG thêm framework.
- Repository pattern có sẵn (`shared/`, `server/`). Migrations trong `migrations/`.
- Test: `node --test` (`npm test`, thư mục `test/`). Cần test cho công thức tính + phân bổ.
- Style: file nhỏ, immutable, validate input ở boundary, không nuốt lỗi. Tiếng Việt cho UI.

## Định nghĩa hoàn thành
1. Nhập DT mục tiêu → ra bảng ngân sách + funnel + phân bổ đa tầng + rải theo tháng.
2. Nút "AI gợi ý phân bổ" hoạt động (có fallback công thức).
3. Migration + repository + API endpoint + UI wired.
4. `npm test` xanh, có test cho engine tính toán.
