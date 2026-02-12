# Xưởng Dịch Vụ VinFast Phúc Lợi - Hệ Thống Theo Dõi Xe Vào/Ra

**Địa chỉ:** 55 Phúc Lợi, Long Biên, Hà Nội
**Hotline:** 0922 35 35 35

Hệ thống tự động theo dõi xe vào/ra xưởng thông qua Zalo OA + OCR biển số + Google Sheets.

---

## Kiến Trúc Hệ Thống

```
Bảo vệ (Zalo)                   Server (Node.js)                   Google Sheets
┌──────────┐    Webhook     ┌──────────────────────┐         ┌──────────────────┐
│ Gửi ảnh  │───────────────>│  /webhook/zalo       │         │ DANH SÁCH CHÍNH  │
│ + VAO/RA │                │  ├─ Verify signature │────────>│ NHẬT KÝ GHI NHẬN │
│          │<───────────────│  ├─ OCR (Vision API) │         │ CẦN KIỂM TRA    │
│ Nhận TL  │    Zalo API    │  ├─ Business logic   │         └──────────────────┘
└──────────┘                │  └─ Reply Zalo       │
                            └──────────────────────┘
                                     │
                            Google Cloud Vision API
```

### Luồng xử lý chi tiết

```
1. Bảo vệ gửi ảnh + "VAO" hoặc "RA" vào Zalo OA
2. Zalo OA gửi webhook → Server
3. Server verify signature + check idempotency (message_id)
4. Server tải ảnh → Google Cloud Vision OCR → biển số + confidence
5. Ghi NHẬT KÝ GHI NHẬN (luôn ghi, dù lỗi)
6. Kiểm tra lỗi: thiếu từ khóa? OCR mờ? biển số sai format?
   → Nếu lỗi: ghi CẦN KIỂM TRA + reply Zalo thông báo lỗi
7. Nếu "VAO": tạo lượt mới trong DANH SÁCH CHÍNH
   Nếu "RA": tìm lượt vào cùng biển số → ghép cặp
8. Reply Zalo xác nhận
9. Check cảnh báo thời gian lưu (mỗi event + mỗi 30 phút)
```

## Cấu Trúc Thư Mục

```
├── src/
│   ├── server.js      # Express server, webhook endpoint
│   ├── config.js      # Đọc ENV, validate config
│   ├── logger.js      # Winston logger
│   ├── ocr.js         # Google Cloud Vision - nhận dạng biển số
│   ├── sheets.js      # Google Sheets API - CRUD 3 tab
│   ├── matcher.js     # Logic nghiệp vụ: ghép cặp VAO/RA, cảnh báo
│   ├── zalo.js        # Zalo OA: verify webhook, reply message
│   └── utils.js       # ID gen, time format, plate normalize
│   └── scripts/
│       └── check-alerts.js  # Script chạy cron kiểm tra cảnh báo
├── test/
│   └── utils.test.js  # Unit tests
├── package.json
├── .env.example
└── .gitignore
```

## Biến Môi Trường (ENV)

| Biến | Bắt buộc | Mô tả |
|------|----------|-------|
| `PORT` | Không | Port server (mặc định: 3000) |
| `ZALO_OA_ACCESS_TOKEN` | Có | Token Zalo OA |
| `ZALO_OA_SECRET_KEY` | Có | Secret key Zalo OA |
| `ZALO_WEBHOOK_VERIFY_TOKEN` | Không | Token verify webhook |
| `GOOGLE_SHEET_ID` | Có | ID Google Sheet |
| `GOOGLE_CREDENTIALS_JSON` | Có | Service Account credentials (JSON string) |
| `GOOGLE_VISION_CREDENTIALS_JSON` | Không | Credentials riêng cho Vision API |
| `OCR_CONFIDENCE_HIGH` | Không | Ngưỡng "Rõ" (mặc định: 0.8) |
| `OCR_CONFIDENCE_MEDIUM` | Không | Ngưỡng "Tạm được" (mặc định: 0.5) |
| `ALERT_HOURS_WARNING` | Không | Giờ cảnh báo (mặc định: 4) |
| `ALERT_HOURS_URGENT` | Không | Giờ khẩn (mặc định: 8) |
| `TIMEZONE` | Không | Timezone (mặc định: Asia/Ho_Chi_Minh) |

## Hướng Dẫn Cài Đặt

### 1. Chuẩn bị Google Sheets

1. Tạo Google Sheet mới
2. Copy Sheet ID từ URL: `https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit`
3. Hệ thống sẽ tự tạo 3 tab khi khởi động

### 2. Chuẩn bị Google Cloud

1. Tạo project trên Google Cloud Console
2. Bật **Google Sheets API** + **Cloud Vision API**
3. Tạo Service Account → tải JSON key
4. Share Google Sheet cho email Service Account (Editor)

### 3. Chuẩn bị Zalo OA

1. Tạo Zalo Official Account tại [oa.zalo.me](https://oa.zalo.me)
2. Đăng ký webhook URL: `https://your-domain.com/webhook/zalo`
3. Lấy Access Token + Secret Key

### 4. Chạy Local

```bash
# Clone repo
git clone <repo-url>
cd xuong-vinfast-phuc-loi

# Cài dependencies
npm install

# Copy và điền config
cp .env.example .env
# Sửa file .env với thông tin thực

# Chạy dev
npm run dev

# Hoặc chạy production
npm start
```

### 5. Test

```bash
npm test
```

### 6. Deploy lên Render / Railway

**Render:**
1. Kết nối GitHub repo
2. Build Command: `npm install`
3. Start Command: `npm start`
4. Thêm ENV vars trong Render dashboard

**Railway:**
1. Kết nối GitHub repo
2. Thêm ENV vars
3. Deploy tự động

**VPS (Ubuntu):**
```bash
# Cài Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone + setup
git clone <repo-url> /opt/xuong-vinfast
cd /opt/xuong-vinfast
npm install --production
cp .env.example .env
nano .env  # điền config

# Chạy với PM2
npm install -g pm2
pm2 start src/server.js --name xuong-vinfast
pm2 save
pm2 startup

# Cron check alerts (mỗi 30 phút)
crontab -e
# Thêm: */30 * * * * cd /opt/xuong-vinfast && node src/scripts/check-alerts.js >> /var/log/xuong-alerts.log 2>&1
```

## Test Plan (10 Cases)

| # | Scenario | Input | Expected |
|---|----------|-------|----------|
| 1 | Xe vào bình thường | Ảnh rõ + "VAO" | Ghi DANH SÁCH CHÍNH, trạng thái "Đang trong xưởng", reply OK |
| 2 | Xe ra bình thường | Ảnh rõ + "RA" (có lượt vào) | Ghép cặp, tính thời gian, trạng thái "Đã ra xưởng" |
| 3 | RA trước VAO | Ảnh rõ + "RA" (không có lượt vào) | Ghi CẦN KIỂM TRA, lý do "Không tìm thấy lượt Xe vào" |
| 4 | Thiếu từ khóa | Ảnh + "xin chào" | Ghi CẦN KIỂM TRA, lý do "Thiếu từ khóa", reply hướng dẫn |
| 5 | OCR mờ | Ảnh mờ + "VAO" | confidence < 0.5, ghi CẦN KIỂM TRA, reply "chụp lại" |
| 6 | Trùng message | Gửi cùng message_id 2 lần | Lần 2 bị bỏ qua (idempotency) |
| 7 | 2 lượt VAO liên tiếp cùng biển | Cùng biển, 2 lần "VAO" | Lượt cũ → "Trùng/nghi trùng", ghi CẦN KIỂM TRA |
| 8 | Không có ảnh | Chỉ text "VAO" | Reply hướng dẫn gửi ảnh |
| 9 | Cảnh báo quá giờ | Xe trong xưởng > 4h | Mức ưu tiên → "Cảnh báo" |
| 10 | Khẩn quá giờ | Xe trong xưởng > 8h | Mức ưu tiên → "Khẩn" |

## Google Sheets - Cấu Trúc 3 Tab

### Tab: DANH SÁCH CHÍNH
| Cột | Mô tả |
|-----|-------|
| Mã lượt xe | LX-YYMMDDHHmmss-XXXX |
| Biển số | Biển số chuẩn hóa |
| Loại xe | xe con / xe tải / ... |
| Giờ vào | dd/MM/yyyy HH:mm:ss |
| Giờ ra | dd/MM/yyyy HH:mm:ss |
| Lưu trong xưởng (phút) | Tự tính |
| Ảnh lúc vào | URL ảnh |
| Ảnh lúc ra | URL ảnh |
| Trạng thái | Đang trong xưởng / Đã ra xưởng / Cần kiểm tra / Trùng / nghi trùng / Hủy |
| Mức ưu tiên | Bình thường / Cảnh báo / Khẩn |
| Ghi chú | Text |
| Cập nhật lúc | dd/MM/yyyy HH:mm:ss |

### Tab: NHẬT KÝ GHI NHẬN
| Cột | Mô tả |
|-----|-------|
| Mã sự kiện | SK-YYMMDDHHmmss-XXXX |
| Thời điểm | dd/MM/yyyy HH:mm:ss |
| Loại ghi nhận | Xe vào / Xe ra / Không xác định |
| Biển số (AI đọc) | Kết quả OCR |
| Chất lượng nhận dạng | Rõ / Tạm được / Mờ / không chắc |
| Ảnh | URL ảnh |
| Người gửi | Zalo user ID |
| Tin nhắn gốc | [MSG_ID:xxx] + text gốc |
| Kết quả xử lý | Đã ghi vào danh sách / Đã ghép cặp thành công / ... |

### Tab: CẦN KIỂM TRA
| Cột | Mô tả |
|-----|-------|
| Mã lỗi | ERR-YYMMDDHHmmss-XXXX |
| Mã sự kiện | Liên kết với NHẬT KÝ |
| Thời điểm | dd/MM/yyyy HH:mm:ss |
| Ảnh | URL ảnh |
| Biển số (AI đọc) | Kết quả OCR |
| Lý do | Dropdown 7 lý do |
| Hướng xử lý | Dropdown 5 hướng |
| Trạng thái xử lý | Chưa xử lý / Đã xử lý |
| Ghi chú người kiểm tra | Text |
