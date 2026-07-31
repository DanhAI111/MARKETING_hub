# Enhancement: chỉ số đầu vào + dẫn xuất theo chuẩn ngành

## Cơ sở (nghiên cứu bảng KH marketing thật)
- **LTV:CAC ≥ 3:1** = khỏe; < 1 = lỗ mỗi khách. Chỉ số "sức khỏe" số 1.
- **CAC payback** = số kỳ thu hồi chi phí tạo 1 khách; < 12 tháng là tốt.
- LTV **phải** dựa trên **gross margin** (không phải doanh thu thô) mới thật.
- Cần thêm **retention** + **tần suất mua** để ra LTV.

## Thêm 3 đầu vào (engine đã validate sẵn retentionRate)
| Field | Ý nghĩa | Default | Khoảng |
|---|---|---|---|
| `grossMargin` | Biên lợi nhuận gộp | 0.3 | (0,1] |
| `retentionRate` | Tỷ lệ giữ chân/kỳ | 0 | [0,1] |
| `purchaseFrequency` | Số đơn/khách/kỳ | 1 | >0 |

Tất cả optional → **backward compatible** (thiếu = default, plan cũ vẫn chạy).

## Dẫn xuất (không nhập, tính + hiển thị)
- `cac` = customerBudget / customers  *(đã có dưới tên cps — tái dùng)*
- `ltv` = (aov × purchaseFrequency × grossMargin) / (1 − retentionRate)
  - retention=0 → ltv = aov × freq × grossMargin
- `ltvCacRatio` = ltv / cac
- `paybackPeriods` = cac / (aov × purchaseFrequency × grossMargin)
- `grossProfit` = targetRevenue × grossMargin

## Cảnh báo mới (nối vào businessWarnings hiện có)
- `LTV_CAC_LOW`: ltvCacRatio < 3 → "Tỷ lệ LTV:CAC là X, dưới ngưỡng khỏe 3:1."
- `MARGIN_BELOW_MKT`: grossMargin < mktRatio → "Biên lợi nhuận gộp thấp hơn tỷ lệ chi marketing; rủi ro lỗ."

## Đổi file
1. `shared/revenue-planner.mjs`
   - `validateInputs`: thêm grossMargin (0,1], purchaseFrequency >0. retentionRate đã có.
   - `computeFunnel`: tính ltv/cac/ltvCacRatio/paybackPeriods/grossProfit vào output funnel.
   - `businessWarnings`: thêm LTV_CAC_LOW, MARGIN_BELOW_MKT.
2. `js/pages/planner.js`
   - Form: 3 ô nhập mới (grossMargin %, retentionRate %, purchaseFrequency số).
   - `collectInputs`: đọc 3 field (÷100 cho %).
   - `fillForm`: điền lại khi load plan.
   - Stat-grid: thêm card **LTV** + card **LTV:CAC** (màu theo ngưỡng 3:1).
3. `test/revenue-planner-unit-econ.test.mjs` (mới): LTV/CAC/ratio/payback đúng số; cảnh báo bật đúng; thiếu field = default (backward compat).

## Định nghĩa hoàn thành
- npm test xanh (thêm test unit-econ).
- Nhập biên + retention → thấy LTV, LTV:CAC; ratio<3 hiện cảnh báo đỏ.
- Plan cũ (không có field mới) vẫn tính ra kết quả như trước.
- Không hardcode secret; validate ở boundary; không nuốt lỗi.
