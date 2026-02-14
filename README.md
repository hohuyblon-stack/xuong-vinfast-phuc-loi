# Xuong Dich Vu VinFast Phuc Loi - He Thong Theo Doi Xe Vao/Ra

**Dia chi:** 55 Phuc Loi, Long Bien, Ha Noi
**Hotline:** 0922 35 35 35

He thong tu dong theo doi xe vao/ra xuong thong qua Telegram Bot + OCR bien so + Google Sheets.

---

## Tinh Nang

- Ghi nhan xe vao/ra bang anh chup bien so qua Telegram
- OCR tu dong nhan dang bien so Viet Nam (Google Cloud Vision)
- Ghep cap xe vao/ra, tinh thoi gian luu xuong
- Canh bao xe luu qua lau (24h canh bao, 48h khan)
- Xem ton kho xe trong xuong qua Telegram hoac Google Sheets
- Ghi chu thu cong cho xe luu qua 48h
- Bao cao tu dong cuoi ngay cho quan ly

---

## Kien Truc He Thong

```
Bao ve (Telegram)                Server (Node.js)                Google Sheets
+------------+    Webhook     +----------------------+         +----------------+
| Gui anh    |--------------->|  /webhook/telegram   |         | DANH SACH CHINH|
| + VAO/RA   |                |  +- OCR (Vision API) |-------->| NHAT KY        |
|            |<---------------|  +- Business logic   |         | CAN KIEM TRA   |
| Nhan TL    |  Telegram API  |  +- Reply Telegram   |         +----------------+
+------------+                +----------------------+
                                       |
                              Google Cloud Vision API
```

---

## Cac Lenh Telegram

| Lenh | Mo ta |
|------|-------|
| `VAO` + anh | Ghi nhan xe vao xuong |
| `RA` + anh | Ghi nhan xe ra xuong |
| `TONKHO` | Xem danh sach xe dang trong xuong |
| `GHICHU 30A-12345 \| Ly do` | Them ghi chu cho xe |
| `HELP` | Xem huong dan |

---

## Cau Truc Thu Muc

```
src/
+-- server.js        # Express server, Telegram webhook
+-- config.js        # Doc ENV, validate config
+-- logger.js        # Winston logger
+-- telegram.js      # Telegram Bot API
+-- ocr.js           # Google Cloud Vision - nhan dang bien so
+-- sheets.js        # Google Sheets API - CRUD 3 tab
+-- matcher.js       # Logic nghiep vu: VAO/RA, TONKHO, GHICHU, alerts
+-- utils.js         # ID gen, time format, plate normalize, message parse
+-- scripts/
    +-- check-alerts.js  # Script chay cron kiem tra canh bao
test/
+-- utils.test.js    # Unit tests
```

## Bien Moi Truong (ENV)

| Bien | Bat buoc | Mo ta |
|------|----------|-------|
| `TELEGRAM_BOT_TOKEN` | Co | Token Telegram Bot (lay tu @BotFather) |
| `TELEGRAM_WEBHOOK_URL` | Khong | URL server de tu dong set webhook |
| `GOOGLE_SHEET_ID` | Co | ID Google Sheet |
| `GOOGLE_CREDENTIALS_JSON` | Co | Service Account credentials (JSON string) |
| `GOOGLE_VISION_CREDENTIALS_JSON` | Khong | Credentials rieng cho Vision API |
| `ALERT_HOURS_WARNING` | Khong | Gio canh bao (mac dinh: 24) |
| `ALERT_HOURS_URGENT` | Khong | Gio khan (mac dinh: 48) |
| `MANAGER_CHAT_IDS` | Khong | Telegram chat ID quan ly |
| `DAILY_REPORT_HOUR` | Khong | Gio gui bao cao tu dong (mac dinh: 18) |

## Huong Dan Cai Dat

### 1. Tao Telegram Bot

1. Mo Telegram, tim `@BotFather`
2. Gui `/newbot`, dat ten bot
3. Copy token (VD: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
4. Them bot vao group bao ve (hoac chat truc tiep)

### 2. Chuan bi Google Cloud

1. Tao project tren Google Cloud Console
2. Bat **Google Sheets API** + **Cloud Vision API**
3. Tao Service Account, tai JSON key
4. Share Google Sheet cho email Service Account (Editor)

### 3. Chay

```bash
npm install
cp .env.example .env
# Sua file .env voi thong tin thuc

npm start        # Production
npm run dev      # Development (hot-reload)
npm test         # Chay tests
```

### 4. Deploy (Render / Railway)

1. Ket noi GitHub repo
2. Build Command: `npm install`
3. Start Command: `npm start`
4. Them ENV vars trong dashboard

## API Endpoints

| Method | URL | Mo ta |
|--------|-----|-------|
| GET | `/health` | Health check |
| POST | `/webhook/telegram` | Telegram webhook |
| POST | `/admin/check-alerts` | Trigger kiem tra canh bao |
| POST | `/admin/daily-report` | Trigger bao cao tong hop |

## Google Sheets - 3 Tab

### DANH SACH CHINH
Ma luot xe | Bien so | Gio vao | Gio ra | Luu (phut) | Anh vao | Anh ra | Trang thai | Muc uu tien | Ghi chu | Cap nhat luc

### NHAT KY
Ma su kien | Thoi diem | Loai | Bien so (AI) | Chat luong | Anh | Nguoi gui | Tin nhan goc | Ket qua

### CAN KIEM TRA
Ma loi | Ma su kien | Thoi diem | Anh | Bien so (AI) | Ly do | Huong xu ly | Trang thai | Ghi chu
