# Deployment Guide — Xưởng VinFast Phúc Lợi Bot

## Yêu cầu trước khi deploy

- [ ] Telegram Bot Token (từ @BotFather)
- [ ] Google Sheet ID + Service Account credentials (JSON)
- [ ] Google Sheet đã share cho Service Account (Editor)
- [ ] Supabase project (URL + Service Key)
- [ ] Poe API Key (cho OCR)

---

## 1. Tạo Telegram Bot

1. Mở Telegram, tìm `@BotFather`
2. Gửi `/newbot`, đặt tên bot
3. Copy token (VD: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
4. Thêm bot vào group bảo vệ

## 2. Setup Google Sheets

1. Tạo Google Sheet mới
2. Tạo 5 tabs:
   - `ĐANG TRONG XƯỞNG` — xe đang trong xưởng
   - `ĐÃ RA XƯỞNG` — lịch sử xe đã ra
   - `NHẬT KÝ` — log mọi sự kiện
   - `CẦN KIỂM TRA` — OCR cần review
   - `BÁO CÁO HÀNG NGÀY` — báo cáo tự động
3. Google Cloud Console → bật Sheets API
4. Tạo Service Account → tải JSON key
5. Share Sheet cho email Service Account (Editor)

## 3. Setup Supabase

1. Tạo project tại https://supabase.com
2. Chạy SQL trong `supabase/schema.sql` tại SQL Editor
3. Copy Project URL + Service Role Key

## 4. Deploy lên Render.com

File `render.yaml` đã có sẵn config. Cách deploy:

1. Đăng nhập https://render.com (dùng GitHub login)
2. **New +** → **Web Service** → kết nối repo
3. Render sẽ tự detect `render.yaml`
4. Điền ENV vars trong dashboard (xem `.env.example`)
5. Deploy

### Health check
```bash
curl https://<your-app>.onrender.com/health
```

## 5. Cấu hình ENV

Xem `.env.example` cho danh sách đầy đủ. Các biến bắt buộc:

| Biến | Mô tả |
|------|-------|
| `TELEGRAM_BOT_TOKEN` | Token bot Telegram |
| `GOOGLE_SHEET_ID` | ID của Google Sheet |
| `GOOGLE_CREDENTIALS_JSON` | Service Account JSON |
| `POE_API_KEY` | API key cho OCR (Poe) |
| `SUPABASE_URL` | URL project Supabase |
| `SUPABASE_SERVICE_KEY` | Service Role key |

## 6. Kiểm tra sau deploy

- [ ] `/health` trả về `{"status":"ok"}`
- [ ] Webhook Telegram đã set (log hiện "Webhook set")
- [ ] Gửi ảnh biển số → bot reply đúng
- [ ] Dữ liệu xuất hiện trong Supabase + Google Sheets
- [ ] Lệnh `TONKHO` hoạt động
- [ ] Cảnh báo 24h/48h hoạt động (kiểm tra cron)
