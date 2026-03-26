# 🚗 Hướng Dẫn Deploy Hệ Thống Tracking VinFast

## Tình Huống
Hệ thống tracking xe vào/ra xưởng VinFast Phúc Lợi đã sẵn sàng về code. Bạn cần setup môi trường và deploy để bảo vệ có thể bắt đầu sử dụng.

**Cách hoạt động:** Bảo vệ chụp ảnh biển số → gửi vào Telegram bot → bot tự động xác định xe VAO hay RA, lưu vào Google Sheets.

---

## ✅ Yêu Cầu Công Việc

### **1. Tạo Telegram Bot**
- Mở Telegram, tìm **@BotFather**
- Gõ `/newbot`
- Đặt tên bot (vd: "XuongVinFastBot")
- Đặt username bot (vd: "@xuong_vinfast_bot")
- **Lưu Bot Token** (dạng: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### **2. Tạo Google Sheet**
- Vào https://sheets.google.com → New Spreadsheet
- Tạo 3 sheet tabs với tên chính xác:
  - `DANH SACH CHINH` (cột: vehicleId, plate, timeIn, timeOut, duration, imageIn, imageOut, status, priority, note, updatedAt)
  - `NHAT KY` (cột: eventId, timestamp, recordType, plateAI, confidenceLabel, imageUrl, sender, originalMessage, result)
  - `CAN KIEM TRA` (cột: errorId, eventId, timestamp, imageUrl, plateAI, reason, suggestion, reviewStatus)
- **Lưu Sheet ID** từ URL: `https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit`

### **3. Tạo Supabase Database (PostgreSQL — Source of Truth)**
- Vào https://supabase.com → **Sign Up** (miễn phí)
- Click **New Project**
  - Tên project: "xuong-vinfast" (hoặc tuỳ chọn)
  - Chọn region: **Singapore** (gần Việt Nam nhất)
  - Đặt mật khẩu database (lưu giữ an toàn!)
- Đợi project tạo xong (~2 phút)
- Vào **Settings** → **API** → Copy:
  - **Project URL** (dạng: `https://xxxxx.supabase.co`)
  - **Service Role Key** (dạng: `eyJhbGc...`)
  - ⚠️ **IMPORTANT**: Service Role Key có quyền admin — giữ bí mật!
- Vào **SQL Editor** → Click **New Query**
- Copy toàn bộ nội dung từ `supabase/migrations/001-init-schema.sql`
- Paste vào SQL editor → Click **Run**
- Đợi cho đến khi thấy "✓ Success"
- **Verify**: Vào **Table Editor** → Nên thấy 3 table: `vehicles`, `events`, `reviews`

### **4. Tạo Google Service Account**
- Vào https://console.cloud.google.com
- Tạo project mới hoặc dùng project cũ
- Bật APIs:
  - **Google Sheets API**
  - **Cloud Vision API**
- Vào **IAM & Admin** → **Service Accounts**
- Click **Create Service Account**
  - Tên: "xuong-vinfast-bot"
  - Click **Create and Continue**
- Click vào service account vừa tạo
- Tab **Keys** → **Add Key** → **Create new key** → **JSON**
  - Tải file JSON (lưu giữ an toàn!)
  - Copy nội dung file JSON
- **Share** Google Sheet cho email của Service Account (quyền **Editor**)
  - Email dạng: `xuong-vinfast-bot@{project-id}.iam.gserviceaccount.com`

### **4. Deploy lên Server**
Chọn 1 trong các option:

**Option A: Render.com (Recommended - Free tier 0.5 credits/hour)**
- Vào https://render.com (login/signup)
- Click **New +** → **Web Service**
- Connect GitHub repo (hoặc upload manual)
- Config:
  - **Environment**: Node
  - **Build Command**: `npm install`
  - **Start Command**: `npm start`
  - **Free tier**: tắt auto-spin down để bot luôn chạy
- Add environment variables (xem bước 5)
- Click **Deploy**
- Copy domain (vd: `https://xuong-vinfast-bot.onrender.com`)

**Option B: Railway.app (Free tier $5/month)**
- Vào https://railway.app
- Click **New Project** → **Deploy from GitHub**
- Connect repo
- Add environment variables (xem bước 5)
- Auto-deploy

**Option C: VPS riêng**
- SSH vào server
- Clone repo: `git clone <repo-url>`
- `npm install`
- Setup `.env` file (xem bước 5)
- Chạy: `npm start` (hoặc dùng PM2: `pm2 start src/server.js`)
- Setup domain + SSL (optional)

### **5. Cấu Hình Environment Variables**

Tạo file `.env` (hoặc set trên platform) với các giá trị:

```env
# ═══════════════════════════════════════════════════════════
# Server Configuration
# ═══════════════════════════════════════════════════════════
PORT=3000
NODE_ENV=production

# ═══════════════════════════════════════════════════════════
# Telegram Bot Token (từ BotFather)
# ═══════════════════════════════════════════════════════════
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz

# Server URL (để bot set webhook, bỏ trống nếu chỉ dùng polling)
TELEGRAM_WEBHOOK_URL=https://your-app-domain.com

# ═══════════════════════════════════════════════════════════
# Supabase PostgreSQL (Source of Truth)
# ═══════════════════════════════════════════════════════════
# Project URL: từ Supabase > Settings > API
# Dạng: https://xxxxx.supabase.co
SUPABASE_URL=https://xxxxx.supabase.co

# Service Role Key: từ Supabase > Settings > API (secret with admin access)
# ⚠️ Keep this secret! Never commit to git.
SUPABASE_SERVICE_KEY=eyJhbGc...

# ═══════════════════════════════════════════════════════════
# Google Sheets (Read-only mirror of Supabase data)
# ═══════════════════════════════════════════════════════════
# Sheet ID: từ URL https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit
GOOGLE_SHEET_ID=1abc2def3ghi4jkl5mno6pqr7stu8vwxyz

# Google Service Account Credentials (JSON)
# Copy từ file JSON Service Account
# ⚠️ Keep this secret! Never commit to git.
GOOGLE_CREDENTIALS_JSON={"type":"service_account","project_id":"your-project","private_key":"-----BEGIN PRIVATE KEY-----\n...","client_email":"xuong-vinfast-bot@your-project.iam.gserviceaccount.com"}

# ═══════════════════════════════════════════════════════════
# OCR Settings (Google Cloud Vision)
# ═══════════════════════════════════════════════════════════
# Confidence threshold for HIGH confidence (0-1.0)
OCR_CONFIDENCE_HIGH=0.8

# Confidence threshold for MEDIUM confidence (0-1.0)
OCR_CONFIDENCE_MEDIUM=0.5

# ═══════════════════════════════════════════════════════════
# Alert Settings
# ═══════════════════════════════════════════════════════════
# Minimum time in workshop before allowing RA (minutes)
# Prevents false RA from burst photos (default: 3 min = 180 sec)
MIN_WORKSHOP_MINUTES=3

# Hours before marking as WARNING (yellow alert)
ALERT_HOURS_WARNING=24

# Hours before marking as URGENT (red alert)
ALERT_HOURS_URGENT=48

# ═══════════════════════════════════════════════════════════
# Manager Notifications
# ═══════════════════════════════════════════════════════════
# Telegram Chat IDs of managers (receive alerts)
# Cách lấy: gửi /start cho @userinfobot trong Telegram
# Comma-separated, no spaces
MANAGER_CHAT_IDS=123456789,987654321

# Hour to send daily report (0-23, 18 = 6PM)
DAILY_REPORT_HOUR=18

# ═══════════════════════════════════════════════════════════
# Timezone
# ═══════════════════════════════════════════════════════════
# https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
TIMEZONE=Asia/Ho_Chi_Minh
```

### **6. Test Bot**
- Sau khi deploy, mở Telegram
- Tìm bot vừa tạo
- Gửi `/start` hoặc `HELP`
- Bot trả lời → OK ✓
- Chụp ảnh biển số → gửi vào bot
- Kiểm tra Google Sheet xem dữ liệu có xuất hiện không

### **7. Hướng Dẫn Bảo Vệ**
- Mở Telegram bot
- **Chụp ảnh biển số xe** (chụp thẳng vào biển số)
- **Gửi ảnh vào bot** (không cần gõ gì)
  - Lần 1: Bot trả lời "ĐÃ GHI VÀO: 30A-12345 lúc 14:30:05"
  - Lần 2 (chiếc xe ngoài): Bot trả lời "ĐÃ GHI RA: 30A-12345 lúc 14:45:20, Lưu xh 15 phút"
- **Xem tồn kho**: Gõ `TONKHO`
- **Xem hướng dẫn**: Gõ `HELP`

---

## 🔍 Kiểm Tra & Xử Lý Sự Cố

### Các tab trong Google Sheet
- **DANH SACH CHINH**: Danh sách xe đang trong xưởng / đã ra
- **NHAT KY**: Log chi tiết từng lần chụp ảnh (OCR confidence, thời gian, ...)
- **CAN KIEM TRA**: Ảnh lỗi cần kiểm tra lại (biển số không rõ, format sai, ...)

### Nếu bot không phản hồi
1. Kiểm tra bot token đúng chưa
2. Kiểm tra logs trên Render/Railway/VPS
3. Test health check: `curl https://your-app.com/health`
4. Kiểm tra Google Sheets API bật chưa

### Nếu OCR không đọc được biển số
- Bảo vệ cần chụp ảnh thẳng, sáng, rõ ràng
- Ảnh lỗi sẽ được lưu vào tab **CAN KIEM TRA** để kiểm tra sau

---

## 📞 Support
- Lỗi gì liên hệ [Tên người phát triển]
- Hỏi hướng dẫn: gõ `HELP` vào bot
