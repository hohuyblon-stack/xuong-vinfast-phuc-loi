# PROJECT SNAPSHOT — Hệ Thống Tracking Xe Xưởng VinFast Phúc Lợi

**Ngày tạo:** 2026-04-06
**Trạng thái:** LIVE (từ 2026-03-28)
**Repo:** xuong-vinfast-phuc-loi (private)

---

## 1. HỆ THỐNG LÀM GÌ?

Hệ thống tự động **theo dõi xe vào/ra xưởng dịch vụ VinFast Phúc Lợi** (55 Phúc Lợi, Long Biên, Hà Nội).

**Quy trình vận hành:**
1. Bảo vệ chụp ảnh biển số xe → gửi vào Telegram bot
2. Bot tự động OCR nhận dạng biển số + xác định xe **VÀO** hay **RA**
3. Dữ liệu lưu vào **Supabase PostgreSQL** (source of truth)
4. Đồng bộ async sang **Google Sheets** (mirror read-only cho quản lý xem)
5. Cảnh báo tự động: xe lưu >24h (cảnh báo), >48h (khẩn), >72h (auto-close)
6. Báo cáo tự động cuối ngày + morning briefing cho quản lý

**Kết quả:** Không cần nhập liệu thủ công. Tracking hoàn toàn tự động.

---

## 2. TECH STACK

| Thành phần | Công nghệ | Vai trò |
|------------|-----------|---------|
| Backend | **Node.js 18+** / Express.js | Web server, webhook handler |
| Bot | **Telegram Bot API** (webhook) | Giao diện cho bảo vệ |
| OCR | **Poe API** (GPT-4o-mini) | Nhận dạng biển số từ ảnh |
| Database | **Supabase PostgreSQL** | Source of truth, transaction-safe |
| Mirror | **Google Sheets API** | Read-only mirror cho quản lý |
| Hosting | **Render.com** (free tier) | Web service |
| Logging | **Winston** | Structured logging |
| Cron | **node-cron** | Scheduled jobs (alerts, reports) |

### Tại sao chọn stack này?
- **Poe API thay Google Cloud Vision:** Giảm chi phí OCR đáng kể (đã migrate từ Vision sang Poe)
- **Supabase thay Google Sheets làm DB:** Transaction safety với `SELECT FOR UPDATE` — xử lý đúng khi 2 bảo vệ gửi ảnh cùng lúc
- **Sheets vẫn giữ:** Quản lý quen xem Sheets, nhưng chỉ là mirror (write-only từ server)

---

## 3. KIẾN TRÚC

```
Bảo vệ (Telegram)          Server (Node.js/Express)
┌──────────────┐   webhook   ┌──────────────────────────┐
│ Gửi ảnh      │────────────>│ /webhook/telegram        │
│ biển số      │             │   ├─ OCR (Poe API)       │
│              │<────────────│   ├─ Business logic       │
│ Nhận reply   │  Telegram   │   └─ Reply               │
└──────────────┘    API      └──────────┬───────────────┘
                                        │
                              ┌─────────┴─────────┐
                              │                   │
                     ┌────────▼────────┐  ┌───────▼───────┐
                     │ Supabase (PG)   │  │ Google Sheets │
                     │ SOURCE OF TRUTH │  │ READ-ONLY     │
                     │ - vehicles      │  │ MIRROR        │
                     │ - events        │  │ (async sync)  │
                     │ - reviews       │  │               │
                     └─────────────────┘  └───────────────┘
```

### Data Flow
1. **Telegram webhook** → Express route → parse message
2. **OCR**: download ảnh → gửi Poe API → extract biển số + loại xe VinFast
3. **DB decision** (atomic): `process_vehicle()` RPC — SELECT FOR UPDATE → quyết định VÀO/RA
4. **Sheets sync**: fire-and-forget, không block bot
5. **Reply**: gửi kết quả về Telegram

### Xử lý concurrent:
- Supabase RPC `process_vehicle()` dùng `SELECT FOR UPDATE` → serialized ở DB level
- Không cần mutex trong app — đúng cả khi 2 ảnh cùng biển số gửi cùng lúc
- Idempotency: `message_key` unique index → cùng 1 message không xử lý 2 lần

---

## 4. DATABASE SCHEMA (Supabase)

### Bảng `vehicles` (ĐANG TRONG XƯỞNG / ĐÃ RA)
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| vehicle_id | TEXT UNIQUE | ID xe (format: VH-yyyyMMdd-xxx) |
| plate | TEXT | Biển số (normalize: "30A-12345") |
| time_in | TIMESTAMPTZ | Thời gian vào |
| time_out | TIMESTAMPTZ | Thời gian ra (null nếu còn trong xưởng) |
| duration_minutes | INTEGER | Thời gian lưu (tính khi ra) |
| status | TEXT | "Đang trong xưởng" / "Đã ra xưởng" |
| priority | TEXT | "Bình thường" / "Cảnh báo" / "Khẩn" |
| vehicle_model | TEXT | Loại xe VinFast (VF 5, VF 8, etc.) |
| image_in_url, image_out_url | TEXT | URL ảnh biển số |

### Bảng `events` (NHẬT KÝ)
- Mọi sự kiện OCR đều được log (kể cả thất bại)
- `message_key` unique index cho idempotency

### Bảng `reviews` (CẦN KIỂM TRA)
- OCR confidence thấp → tạo review record
- Quản lý review trên Sheets hoặc direct

---

## 5. CÁC LỆNH TELEGRAM

| Lệnh | Chức năng |
|-------|-----------|
| Gửi ảnh (không caption) | Auto detect VÀO/RA |
| `TONKHO` | Danh sách xe đang trong xưởng |
| `GHICHU 30A-12345 \| Lý do` | Thêm ghi chú cho xe |
| `XRA 30A-12345` | Xuất xe thủ công (không cần ảnh) |
| `BAOCAO` | Báo cáo tổng hợp cuối ngày |
| `SANLUONG` | Báo cáo năng suất |
| `KETOAN` | Báo cáo kế toán (cần file Excel Cyber) |
| `BAOCAODAY` | Báo cáo đầy đủ + phân tích thông minh |
| `HELP` | Hướng dẫn sử dụng |

---

## 6. TÍNH NĂNG TỰ ĐỘNG (Cron Jobs)

| Job | Lịch | Chức năng |
|-----|------|-----------|
| Check alerts | Mỗi giờ | Cảnh báo xe lưu >24h/48h |
| Auto-close | Mỗi giờ | Tự đóng xe lưu >72h |
| Morning briefing | 7:00 sáng | Tóm tắt tình hình xưởng |
| Daily report | 18:00 | Báo cáo cuối ngày |
| Full report | 18:15 | Báo cáo chi tiết + phân tích |
| End-of-day reminder | 20:00 | Nhắc xe chưa ra xưởng |
| Webhook self-heal | Mỗi 30 phút | Kiểm tra + tự set lại webhook |
| Stale vehicle expire | Mỗi 6 giờ | Expire xe >30 ngày |

---

## 7. CẤU TRÚC CODE

```
src/
├── server.js          # Express server, routes, cron setup, bootstrap
├── config.js          # Đọc ENV, validate
├── db.js              # Supabase client — CRUD vehicles/events/reviews
├── ocr.js             # Poe API OCR — nhận dạng biển số + loại xe
├── matcher.js         # Business logic: VÀO/RA, TONKHO, reports, alerts
├── telegram.js        # Telegram Bot API wrapper
├── sheets.js          # Google Sheets API (low-level read/write)
├── sheets-sync.js     # Async write-only mirror (fire-and-forget)
├── sheets-format.js   # Sheets formatting helpers
├── accounting.js      # Báo cáo kế toán (match file Excel Cyber)
├── report-intelligence.js  # Phân tích thông minh cho báo cáo
├── excel.js           # Parse Excel file (lệnh sửa chữa từ Cyber)
├── middleware.js       # Auth middleware (webhook secret, admin key)
├── utils.js           # Tiện ích: normalize plate, format time, parse message
├── logger.js          # Winston logger config
└── scripts/
    ├── check-alerts.js         # Standalone alert checker
    ├── cron-db-check.js        # DB health check
    ├── retry-failed-ocr.js     # Retry OCR thất bại
    ├── retry-failed-ocr-standalone.js
    └── sync-recovered-to-sheets.js  # Sync dữ liệu recovered

scripts/               # Dev/deploy scripts
├── deploy.sh, deploy-checklist.sh
├── db-check.js
├── check-ocr-rate.js
├── diagnose-phantom-ra.js, diagnose-tonkho.js
├── check_anomalies.js, check_anomalies_simplified.js
├── migrate-sheets-to-supabase.js
├── reset-workshop.js
├── quick-setup.sh
└── hook-*.sh          # Git hooks

test/                  # 15 test files, ~4,900 lines
                       # Coverage: ~89%
```

**Tổng code:** ~5,600 dòng (src) + ~4,900 dòng (test)

---

## 8. API ENDPOINTS

| Method | Path | Auth | Chức năng |
|--------|------|------|-----------|
| GET | `/health` | None | Health check |
| POST | `/webhook/telegram` | Webhook secret | Telegram webhook |
| POST | `/admin/check-alerts` | Admin API key | Trigger kiểm tra cảnh báo |
| POST | `/admin/daily-report` | Admin API key | Trigger báo cáo |

---

## 9. CHI PHÍ VẬN HÀNH

| Dịch vụ | Plan | Chi phí |
|---------|------|---------|
| Render.com | Free tier | $0/tháng |
| Supabase | Free tier | $0/tháng |
| Google Sheets API | Free quota | $0/tháng |
| Poe API | Pay-per-use | ~$5-10/tháng (ước tính) |
| Telegram Bot API | Free | $0/tháng |

**Tổng ước tính:** ~$5-10/tháng (chủ yếu là Poe OCR)

---

## 10. ĐIỂM MẠNH HIỆN TẠI

1. **Race-condition-safe:** Supabase RPC với SELECT FOR UPDATE — không bao giờ sai khi concurrent
2. **Idempotent:** Message key unique — không xử lý trùng
3. **Resilient:** Sheets sync fire-and-forget — Sheets chết không ảnh hưởng bot
4. **Test coverage ~89%:** 15 file test, bao phủ hầu hết business logic
5. **Tự phục hồi:** Webhook self-heal, OCR retry (3 lần), auto-close xe quá lâu
6. **Chi phí thấp:** Gần như $0 trừ OCR

---

## 11. VẤN ĐỀ VÀ RỦI RO CẦN CẢI THIỆN

### Kỹ thuật
- **Render free tier:** Server sleep sau 15 phút idle → cold start ~30s → bảo vệ phải đợi
- **Poe API dependency:** Phụ thuộc 1 provider OCR duy nhất, không có fallback
- **Không có CI/CD:** Không có pipeline test tự động khi push
- **Không có monitoring/alerting:** Không biết khi nào server chết (ngoài webhook self-heal)
- **Google Sheets rate limit:** 60 req/phút — nếu nhiều xe cùng lúc có thể bị throttle

### Vận hành
- **Single point of failure:** 1 server duy nhất, không có replica
- **Không có backup strategy:** Supabase free tier không có point-in-time recovery
- **Không có staging environment:** Test trực tiếp trên production
- **Quản lý review thủ công:** OCR lỗi phải review bằng tay trên Sheets

### Business
- **Phụ thuộc Telegram:** Nếu bảo vệ không quen Telegram → cần training
- **Không có dashboard UI:** Quản lý chỉ xem được qua Sheets hoặc Telegram commands
- **Không tích hợp hệ thống sửa chữa (DMS):** Kế toán phải export Excel riêng từ Cyber
- **Chưa có phân quyền:** Ai cũng gửi được lệnh, không phân biệt bảo vệ/quản lý

---

## 12. GỢI Ý CẢI THIỆN (ĐỂ TRAO ĐỔI VỚI CỐ VẤN)

### Ưu tiên cao (ảnh hưởng vận hành trực tiếp)
1. **Upgrade Render từ free → starter ($7/tháng):** Không sleep, response nhanh hơn
2. **Thêm OCR fallback:** Nếu Poe chết → fallback Google Vision hoặc local Tesseract
3. **Backup Supabase tự động:** pg_dump hàng ngày → lưu Google Drive hoặc S3
4. **Setup CI/CD:** GitHub Actions chạy test trước khi deploy

### Ưu tiên trung bình
5. **Dashboard web đơn giản:** Thay Sheets bằng UI (Next.js / Retool / Appsmith)
6. **Monitoring:** Uptime check (UptimeRobot miễn phí) + error alerting (Sentry free)
7. **Phân quyền Telegram:** Whitelist chat ID cho bảo vệ vs quản lý
8. **Tích hợp DMS (Cyber):** API hoặc auto-import thay vì upload Excel thủ công

### Ưu tiên thấp (nice-to-have)
9. **Multi-xưởng:** Mở rộng cho nhiều xưởng VinFast
10. **Analytics:** Dashboard theo dõi throughput, thời gian sửa trung bình, etc.
11. **OCR accuracy tracking:** Đo tỷ lệ đúng/sai tự động
12. **Mobile app cho bảo vệ:** Thay Telegram bằng app riêng (khó cần thiết)

---

## 13. LỊCH SỬ PHÁT TRIỂN

| Mốc | Nội dung |
|-----|----------|
| Feb 2026 | v1: Zalo OA + Google Vision + Google Sheets |
| Feb 2026 | v1.1: Migrate Zalo → Telegram (dễ hơn cho bảo vệ) |
| Mar 2026 | v1.5: Thêm Supabase làm DB chính, Sheets thành mirror |
| Mar 2026 | v2.0: Swap Google Vision → Poe API (tiết kiệm chi phí) |
| Mar 2026 | Nhận diện loại xe VinFast, báo cáo thông minh, kế toán |
| Mar 28, 2026 | **GO LIVE** — 89 xe đang tracking |
| Apr 2026 | Auto-close 72h, fuzzy plate matching, test coverage 89% |

**Tổng commits:** 72 | **Contributors:** 1

---

*Document này được tạo để mang đi trao đổi với cố vấn. Mọi thông tin kỹ thuật đã được verify từ source code ngày 2026-04-06.*
