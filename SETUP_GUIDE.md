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

### **3. Tạo Google Service Account**
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
# Server
PORT=3000
NODE_ENV=production

# Telegram Bot Token (từ BotFather)
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz

# Server URL (để bot set webhook, bỏ trống nếu chỉ dùng polling)
TELEGRAM_WEBHOOK_URL=https://your-app-domain.com

# Google Sheet ID (từ URL sheet)
GOOGLE_SHEET_ID=1abc2def3ghi4jkl5mno6pqr7stu8vwxyz

# Google Credentials JSON (copy từ file Service Account)
GOOGLE_CREDENTIALS_JSON={"type":"service_account","project_id":"your-project","private_key":"-----BEGIN PRIVATE KEY-----\n...","client_email":"xuong-vinfast-bot@your-project.iam.gserviceaccount.com"}

# OCR Confidence Thresholds
OCR_CONFIDENCE_HIGH=0.8
OCR_CONFIDENCE_MEDIUM=0.5

# Canh bao
ALERT_HOURS_WARNING=24
ALERT_HOURS_URGENT=48

# Telegram Chat ID Quản Lý (nhận cảnh báo)
# Cách lấy: gửi /start cho @userinfobot trong Telegram
MANAGER_CHAT_IDS=123456789,987654321

# Giờ gửi báo cáo tổng hợp (0-23, 18 = 6PM)
DAILY_REPORT_HOUR=18

# Timezone
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
