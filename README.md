# Xưởng Dịch Vụ VinFast Phúc Lợi - Hệ Thống Theo Dõi Xe Vào/Ra

**Địa chỉ:** 55 Phúc Lợi, Long Biên, Hà Nội
**Hotline:** 0922 35 35 35

Hệ thống tự động theo dõi xe vào/ra xưởng thông qua Zalo OA + OCR biển số + Google Sheets.

---

## Tính Năng

### Cốt lõi
- Ghi nhận xe vào/ra bằng ảnh chụp biển số qua Zalo
- OCR tự động nhận dạng biển số Việt Nam (Google Cloud Vision)
- Ghép cặp xe vào/ra, tính thời gian lưu xưởng
- Cảnh báo xe lưu quá lâu (4h cảnh báo, 8h khẩn)

### Tra cứu & Báo cáo
- **TRACUU** - Tra cứu trạng thái xe theo biển số
- **BAOCAO** - Báo cáo tổng hợp xe trong xưởng
- **Báo cáo tự động** - Gửi tổng hợp cuối ngày cho quản lý

### Quản lý sửa chữa
- **CAPNHAT** - Cập nhật tiến độ sửa chữa theo biển số
- Timeline tiến độ cho từng xe trong Google Sheets

### Quản lý khách hàng
- **DANGKY** - Đăng ký SĐT khách hàng theo biển số
- Tự động thông báo quản lý gọi khách khi xe ra

### Thông báo proactive
- Cảnh báo quản lý qua Zalo khi xe lưu quá lâu
- Thông báo cập nhật tiến độ cho quản lý
- Thông báo khi xe ra để gọi khách lấy xe

### Quản lý nhân viên
- Nhận diện bảo vệ/kỹ thuật theo Zalo ID
- Hiển thị tên nhân viên thay vì Zalo ID trong log

---

## Kiến Trúc Hệ Thống

```
Bảo vệ (Zalo)                   Server (Node.js)                   Google Sheets
┌──────────┐    Webhook     ┌──────────────────────┐         ┌──────────────────┐
│ Gửi ảnh  │───────────────>│  /webhook/zalo       │         │ DANH SÁCH CHÍNH  │
│ + VAO/RA │                │  ├─ Verify signature │────────>│ NHẬT KÝ GHI NHẬN │
│          │<───────────────│  ├─ OCR (Vision API) │         │ CẦN KIỂM TRA    │
│ Nhận TL  │    Zalo API    │  ├─ Business logic   │         │ TIẾN ĐỘ SỬA CHỮA│
└──────────┘                │  └─ Reply Zalo       │         │ NHÂN VIÊN        │
                            └──────────────────────┘         │ KHÁCH HÀNG       │
                                     │                       └──────────────────┘
                            Google Cloud Vision API
```

---

## Các Lệnh Zalo

### Ghi nhận xe (cần ảnh)
| Lệnh | Mô tả |
|-------|--------|
| `VAO` + ảnh | Ghi nhận xe vào xưởng |
| `RA` + ảnh | Ghi nhận xe ra xưởng |
| `VAO \| xe tải` + ảnh | Ghi xe vào kèm loại xe |

### Tra cứu (chỉ text)
| Lệnh | Mô tả |
|-------|--------|
| `TRACUU 30A-12345` | Xem trạng thái + lịch sử + tiến độ sửa chữa |
| `BAOCAO` | Báo cáo tổng hợp: xe vào/ra hôm nay, đang trong xưởng |

### Cập nhật tiến độ (chỉ text)
| Lệnh | Mô tả |
|-------|--------|
| `CAPNHAT 30A-12345 \| Đang kiểm tra` | Cập nhật tiến độ sửa chữa |
| `CAPNHAT 30A-12345 \| Chờ phụ tùng` | Ghi nhận chờ phụ tùng |
| `CAPNHAT 30A-12345 \| Hoàn thành` | Ghi nhận hoàn thành |

### Khách hàng (chỉ text)
| Lệnh | Mô tả |
|-------|--------|
| `DANGKY 30A-12345 \| 0901234567` | Đăng ký SĐT khách hàng |
| `DANGKY 30A-12345 \| 0901234567 \| Nguyễn Văn A` | Đăng ký kèm tên |

### Hỗ trợ
| Lệnh | Mô tả |
|-------|--------|
| `HUONGDAN` hoặc `HELP` | Xem hướng dẫn tất cả lệnh |

---

## Cấu Trúc Thư Mục

```
├── src/
│   ├── server.js      # Express server, webhook endpoint, daily report scheduler
│   ├── config.js      # Đọc ENV, validate config
│   ├── logger.js      # Winston logger
│   ├── ocr.js         # Google Cloud Vision - nhận dạng biển số
│   ├── sheets.js      # Google Sheets API - CRUD 6 tab
│   ├── matcher.js     # Logic nghiệp vụ: VAO/RA, TRACUU, CAPNHAT, BAOCAO, alerts
│   ├── zalo.js        # Zalo OA: verify webhook, reply message
│   └── utils.js       # ID gen, time format, plate normalize, message parse
│   └── scripts/
│       └── check-alerts.js  # Script chạy cron kiểm tra cảnh báo
├── test/
│   └── utils.test.js  # Unit tests (30+ test cases)
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
| `MANAGER_ZALO_IDS` | Không | Zalo ID quản lý, cách nhau bằng dấu phẩy |
| `DAILY_REPORT_HOUR` | Không | Giờ gửi báo cáo tự động (mặc định: 18) |
| `CUSTOMER_NOTIFY_ON_EXIT` | Không | Thông báo khách khi xe ra (mặc định: true) |
| `TIMEZONE` | Không | Timezone (mặc định: Asia/Ho_Chi_Minh) |

## Hướng Dẫn Cài Đặt

### 1. Chuẩn bị Google Sheets

1. Tạo Google Sheet mới
2. Copy Sheet ID từ URL: `https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit`
3. Hệ thống sẽ tự tạo 6 tab khi khởi động

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

## API Endpoints

| Method | URL | Mô tả |
|--------|-----|-------|
| GET | `/health` | Health check |
| GET | `/webhook/zalo` | Zalo webhook verification |
| POST | `/webhook/zalo` | Zalo webhook (main entry) |
| POST | `/admin/check-alerts` | Trigger kiểm tra cảnh báo |
| POST | `/admin/daily-report` | Trigger báo cáo tổng hợp |

## Google Sheets - Cấu Trúc 6 Tab

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
| Ghi chú | Text (cập nhật tiến độ mới nhất) |
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
| Người gửi | Tên nhân viên hoặc Zalo user ID |
| Tin nhắn gốc | [MSG_ID:xxx] + text gốc |
| Kết quả xử lý | Đã ghi / Đã ghép cặp / Lỗi... |

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

### Tab: TIẾN ĐỘ SỬA CHỮA (Mới)
| Cột | Mô tả |
|-----|-------|
| Mã cập nhật | CN-YYMMDDHHmmss-XXXX |
| Mã lượt xe | Liên kết với DANH SÁCH CHÍNH |
| Biển số | Biển số xe |
| Thời điểm | dd/MM/yyyy HH:mm:ss |
| Nội dung cập nhật | VD: Đang kiểm tra, Chờ phụ tùng, Hoàn thành |
| Người cập nhật | Tên nhân viên hoặc Zalo ID |

### Tab: NHÂN VIÊN (Mới)
| Cột | Mô tả |
|-----|-------|
| Zalo ID | ID Zalo của nhân viên |
| Tên nhân viên | Tên hiển thị |
| Vai trò | Bảo vệ / Quản lý / Kỹ thuật |
| Trạng thái | Hoạt động / Ngừng |
| Ngày thêm | dd/MM/yyyy HH:mm:ss |

### Tab: KHÁCH HÀNG (Mới)
| Cột | Mô tả |
|-----|-------|
| Biển số | Biển số xe |
| SĐT khách hàng | Số điện thoại |
| Tên khách hàng | Tên (tùy chọn) |
| Ngày đăng ký | dd/MM/yyyy HH:mm:ss |
| Ghi chú | Text |

## Test Plan (17 Cases)

| # | Scenario | Input | Expected |
|---|----------|-------|----------|
| 1 | Xe vào bình thường | Ảnh rõ + "VAO" | Ghi DANH SÁCH CHÍNH, trạng thái "Đang trong xưởng", reply OK |
| 2 | Xe ra bình thường | Ảnh rõ + "RA" (có lượt vào) | Ghép cặp, tính thời gian, trạng thái "Đã ra xưởng" |
| 3 | RA trước VAO | Ảnh rõ + "RA" (không có lượt vào) | Ghi CẦN KIỂM TRA, reply lỗi |
| 4 | Thiếu từ khóa | Ảnh + "xin chào" | Ghi CẦN KIỂM TRA, reply hướng dẫn |
| 5 | OCR mờ | Ảnh mờ + "VAO" | Ghi CẦN KIỂM TRA, reply "chụp lại" |
| 6 | Trùng message | Gửi cùng message_id 2 lần | Lần 2 bị bỏ qua |
| 7 | 2 lượt VAO cùng biển | Cùng biển, 2 lần "VAO" | Lượt cũ → "Trùng/nghi trùng" |
| 8 | Không có ảnh | Chỉ text "VAO" | Reply hướng dẫn gửi ảnh |
| 9 | Cảnh báo quá giờ | Xe > 4h | priority → "Cảnh báo" + Zalo alert |
| 10 | Khẩn quá giờ | Xe > 8h | priority → "Khẩn" + Zalo alert |
| 11 | TRACUU | "TRACUU 30A-12345" | Reply trạng thái + lịch sử + tiến độ |
| 12 | CAPNHAT | "CAPNHAT 30A-12345 \| Đang sửa" | Ghi TIẾN ĐỘ + reply OK |
| 13 | DANGKY | "DANGKY 30A-12345 \| 0901234567" | Ghi KHÁCH HÀNG + reply OK |
| 14 | BAOCAO | "BAOCAO" | Reply thống kê tổng hợp |
| 15 | HUONGDAN | "HELP" | Reply danh sách lệnh |
| 16 | Xe ra + có khách | Xe ra, có SĐT đã đăng ký | Thông báo quản lý gọi khách |
| 17 | Nhân viên có tên | Gửi từ Zalo ID có trong tab NHÂN VIÊN | Log hiển thị tên thay vì ID |
