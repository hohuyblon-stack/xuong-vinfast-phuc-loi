# DEPLOYMENT CHECKLIST - Hệ Thống Tracking VinFast

**Branch:** `claude/vehicle-tracking-zalo-ocr-3ERhn`
**Status:** Code sẵn sàng, chờ setup + deploy
**Date:** 2026-02-25

---

## BƯỚC 1: TELEGRAM BOT SETUP

### 1a. Tạo Telegram Bot
- [ ] Mở Telegram, tìm `@BotFather`
- [ ] Gửi lệnh `/newbot`
- [ ] Đặt tên bot: `XuongVinFastBot` (hoặc tên khác)
- [ ] Đặt username: `xuong_vinfast_bot` (phải unique)
- [ ] **Sao chép Bot Token** (dạng: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

**Lưu token vào:** `TELEGRAM_BOT_TOKEN`
```
TELEGRAM_BOT_TOKEN=<token_tu_BotFather>
```

---

## BƯỚC 2: GOOGLE SHEETS SETUP

### 2a. Tạo Google Sheet
- [ ] Vào https://sheets.google.com
- [ ] Click **+ New Spreadsheet**
- [ ] Đặt tên: `Xưởng VinFast Phúc Lợi` (hoặc tên khác)
- [ ] **Sao chép Sheet ID từ URL:**
  - URL dạng: `https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit`
  - Lấy phần `{SHEET_ID}`

**Lưu Sheet ID vào:** `GOOGLE_SHEET_ID`
```
GOOGLE_SHEET_ID=<sheet_id>
```

### 2b. Tạo 3 sheet tabs với tên chính xác

**Tab 1: DANH SACH CHINH**
- [ ] Click **+** để thêm sheet
- [ ] Đặt tên: `DANH SACH CHINH` (CHÍNH XÁC)
- [ ] Tạo headers (dòng 1):
  ```
  vehicleId | plate | timeIn | timeOut | duration | imageIn | imageOut | status | priority | note | updatedAt
  ```

**Tab 2: NHAT KY**
- [ ] Click **+** để thêm sheet
- [ ] Đặt tên: `NHAT KY` (CHÍNH XÁC)
- [ ] Tạo headers (dòng 1):
  ```
  eventId | timestamp | recordType | plateAI | confidenceLabel | imageUrl | sender | originalMessage | result
  ```

**Tab 3: CAN KIEM TRA**
- [ ] Click **+** để thêm sheet
- [ ] Đặt tên: `CAN KIEM TRA` (CHÍNH XÁC)
- [ ] Tạo headers (dòng 1):
  ```
  errorId | eventId | timestamp | imageUrl | plateAI | reason | suggestion | reviewStatus
  ```

---

## BƯỚC 3: GOOGLE CLOUD SERVICE ACCOUNT SETUP

### 3a. Vào Google Cloud Console
- [ ] Truy cập https://console.cloud.google.com
- [ ] Đăng nhập tài khoản Google
- [ ] Tạo project mới hoặc chọn project cũ

### 3b. Bật APIs
- [ ] Vào **APIs & Services** → **Library**
- [ ] Tìm và bật:
  - [ ] **Google Sheets API**
  - [ ] **Cloud Vision API**

### 3c. Tạo Service Account
- [ ] Vào **APIs & Services** → **Credentials**
- [ ] Click **+ Create Credentials** → **Service Account**
- [ ] **Service account details:**
  - Service account name: `xuong-vinfast-bot`
  - Service account ID: (tự động)
  - Description: `Xe theo dõi VinFast Phúc Lợi`
  - Click **Create and Continue**
- [ ] **Grant roles** (optional, có thể bỏ qua)
  - Click **Continue** → **Done**

### 3d. Tạo JSON Key
- [ ] Vào trang Service Account vừa tạo
- [ ] Click tab **Keys**
- [ ] Click **Add Key** → **Create new key**
- [ ] Chọn **JSON**
- [ ] Click **Create** → **Tự động download file JSON**
- [ ] **Mở file JSON, copy toàn bộ nội dung**

**Lưu credentials vào:** `GOOGLE_CREDENTIALS_JSON`
```
GOOGLE_CREDENTIALS_JSON=<toàn bộ nội dung file JSON, copy từ đầu đến cuối>
```

### 3e. Share Google Sheet với Service Account
- [ ] Lấy email của Service Account từ file JSON:
  - Tìm dòng `"client_email": "xuong-vinfast-bot@<project-id>.iam.gserviceaccount.com"`
  - Copy email này
- [ ] Vào Google Sheet (DANH SACH CHINH)
- [ ] Click **Share** (góc trên phải)
- [ ] Paste email Service Account
- [ ] Chọn **Editor**
- [ ] Click **Share**

---

## BƯỚC 4: ENVIRONMENT VARIABLES

### Chuẩn bị file .env
Tạo file `.env` tại root repo với nội dung:

```env
# Server
PORT=3000
NODE_ENV=production

# Telegram Bot Token (từ BotFather)
TELEGRAM_BOT_TOKEN=<your_bot_token>

# Server URL (để bot set webhook)
# Sẽ được cập nhật sau khi deploy (vd: https://xuong-vinfast-bot.onrender.com)
TELEGRAM_WEBHOOK_URL=

# Google Sheet ID
GOOGLE_SHEET_ID=<your_sheet_id>

# Google Service Account Credentials (JSON string, copy từ file JSON)
GOOGLE_CREDENTIALS_JSON=<paste_json_content_here>

# OCR Confidence Thresholds
OCR_CONFIDENCE_HIGH=0.8
OCR_CONFIDENCE_MEDIUM=0.5

# Cảnh báo thời gian lưu (giờ)
ALERT_HOURS_WARNING=24
ALERT_HOURS_URGENT=48

# Manager Chat IDs (optional, nhận cảnh báo)
# Cách lấy: gửi /start cho @userinfobot trong Telegram
MANAGER_CHAT_IDS=

# Giờ gửi báo cáo tổng hợp (0-23, 18 = 6PM)
DAILY_REPORT_HOUR=18

# Timezone
TIMEZONE=Asia/Ho_Chi_Minh
```

### Verify .env tại local (trước khi deploy)
- [ ] Kiểm tra file `.env` có đúng định dạng JSON cho `GOOGLE_CREDENTIALS_JSON`
- [ ] Test chạy local:
  ```bash
  npm install
  npm start
  ```
- [ ] Kiểm tra server start thành công (logs: "Server started on port 3000")

---

## BƯỚC 5: DEPLOY TO CLOUD

### Option A: RENDER.COM (Recommended)

- [ ] Truy cập https://render.com
- [ ] Đăng nhập hoặc đăng ký
- [ ] Click **New +** → **Web Service**
- [ ] **Connect Repository:**
  - Link GitHub: `https://github.com/your-username/xuong-vinfast-phuc-loi`
  - Hoặc Public URL: có thể upload manual
- [ ] **Build Settings:**
  - Name: `xuong-vinfast-bot`
  - Environment: `Node`
  - Region: `Singapore` (gần Việt Nam)
  - Build Command: `npm install`
  - Start Command: `npm start`
- [ ] **Add Environment Variables:**
  - Paste tất cả variables từ `.env` (vì Render sẽ ăn từ ENV)
  - Quan trọng: `TELEGRAM_BOT_TOKEN`, `GOOGLE_SHEET_ID`, `GOOGLE_CREDENTIALS_JSON`
- [ ] **Free Tier Settings:**
  - Auto Spin Down: tắt (để bot luôn chạy)
  - Nếu có credit, có thể nâng lên Starter plan
- [ ] Click **Deploy**
- [ ] **Chờ 3-5 phút deploy xong**
- [ ] **Lấy domain từ Render:**
  - Dạng: `https://xuong-vinfast-bot.onrender.com`
  - **Lưu URL này!**

**Sau khi deploy:**
- [ ] Cập nhật `TELEGRAM_WEBHOOK_URL` = `https://xuong-vinfast-bot.onrender.com`
- [ ] Render sẽ tự restart, webhook sẽ được set tự động

### Option B: RAILWAY.APP

- [ ] Truy cập https://railway.app
- [ ] Click **New Project** → **Deploy from GitHub**
- [ ] Kết nối GitHub repo
- [ ] **Add Environment Variables** từ `.env`
- [ ] Auto-deploy (chờ build xong)
- [ ] **Lấy domain:**
  - Vào **Deployments** → tìm public domain
  - Dạng: `https://your-project-xxxxx.railway.app`

### Option C: VPS RIÊNG (Nâng cao)

- [ ] SSH vào server: `ssh user@your-server-ip`
- [ ] Clone repo:
  ```bash
  git clone https://github.com/your-username/xuong-vinfast-phuc-loi.git
  cd xuong-vinfast-phuc-loi
  ```
- [ ] Tạo `.env` file
- [ ] Cài đặt:
  ```bash
  npm install
  npm start
  ```
- [ ] Setup PM2 (để bot chạy liên tục):
  ```bash
  npm install -g pm2
  pm2 start src/server.js --name "xuong-vinfast"
  pm2 startup
  pm2 save
  ```

---

## BƯỚC 6: TEST BOT

### 6a. Health Check
- [ ] Curl health endpoint:
  ```bash
  curl https://your-app-domain.com/health
  ```
- [ ] Response: `{"status":"ok","service":"xuong-vinfast-phuc-loi","time":"..."}`

### 6b. Telegram Bot Commands
- [ ] Mở Telegram, tìm bot vừa tạo
- [ ] Gửi `/start`
  - Bot phải trả lời (hoặc không, tùy code)
- [ ] Gửi `HELP`
  - Bot phải trả lời hướng dẫn

### 6c. Test OCR (Gửi ảnh biển số)
- [ ] Chụp ảnh biển số xe (rõ, sáng)
- [ ] Gửi ảnh vào bot
- [ ] Bot phải trả lời:
  - Lần 1: `ĐÃ GHI VÀO: 30A-12345 lúc 14:30:05`
  - Lần 2 (xe sau): `ĐÃ GHI RA: 30A-12345 lúc 14:45:20, Lưu xh 15 phút`
- [ ] Kiểm tra Google Sheets:
  - Tab **DANH SACH CHINH**: xuất hiện xe mới
  - Tab **NHAT KY**: xuất hiện log chụp ảnh
  - Tab **CAN KIEM TRA**: nếu OCR không đọc được sẽ có ở đây

### 6d. Test TONKHO Command
- [ ] Gửi `TONKHO`
- [ ] Bot trả lời danh sách xe đang trong xưởng

---

## BƯỚC 7: VERIFY & DOCUMENT

### 7a. Confirm kết quả
- [ ] Telegram Bot Token: `_______________`
- [ ] Google Sheet ID: `_______________`
- [ ] Server URL: `_______________`
- [ ] Test Results:
  - [ ] `/start` command: OK ✓
  - [ ] `HELP` command: OK ✓
  - [ ] License plate image: OK ✓
  - [ ] Google Sheets updated: OK ✓
  - [ ] Second photo (RA): OK ✓

### 7b. Tạo report file
Lưu report vào file `DEPLOYMENT_REPORT.md`

---

## TROUBLESHOOTING

### Bot không phản hồi
- [ ] Check logs: `curl https://your-app.com/health`
- [ ] Verify `TELEGRAM_BOT_TOKEN` đúng không
- [ ] Verify Telegram webhook set thành công:
  - Check Render/Railway logs
  - Phải có log: `Telegram webhook set: https://...`

### OCR không đọc được
- [ ] Kiểm tra ảnh chụp thẳng, sáng, rõ ràng
- [ ] Verify **Cloud Vision API** bật trong GCP
- [ ] Verify Service Account có quyền Vision API

### Google Sheets không update
- [ ] Verify **Google Sheets API** bật
- [ ] Verify Service Account được share Editor trên Sheet
- [ ] Check logs: có thể có lỗi parse JSON credentials

### Server tự dừng (Free tier)
- [ ] Render Free: auto spin down sau 15 phút không dùng
- [ ] Solution:
  - Nâng lên Starter plan
  - Hoặc dùng Railway.app (có free tier $5/month)
  - Hoặc VPS riêng

---

## QUY TRÌNH HƯỚNG DẪN BẢO VỆ

Sau khi bot chạy thành công, dạy bảo vệ:

1. **Mở Telegram bot** vừa tạo
2. **Chụp ảnh biển số xe** (chụp trực tiếp vào biển số)
3. **Gửi ảnh vào bot** (không cần gõ lệnh)
   - Bot tự xác định **VAO** hay **RA**
   - Trả lời: `ĐÃ GHI VÀO: 30A-12345 lúc 14:30:05`
   - Lần 2 cùng xe: `ĐÃ GHI RA: 30A-12345 lúc 14:45:20, Lưu xh 15 phút`
4. **Xem tồn kho**: Gõ `TONKHO`
5. **Xem hướng dẫn**: Gõ `HELP`

---

## NOTES

- **Bảo mật:** Không commit `.env` vào git (đã trong `.gitignore`)
- **Credentials:** Giữ file JSON Service Account an toàn
- **Webhook:** Được set tự động từ code nếu có `TELEGRAM_WEBHOOK_URL`
- **Timezone:** Mặc định `Asia/Ho_Chi_Minh`, cảnh báo sử dụng timezone này
- **Support:** Nếu có lỗi, kiểm tra logs từ Render/Railway/VPS

---

**Status:** ⏳ Chờ setup manual + deploy
**Next Steps:** Làm theo từng bước trong checklist này
