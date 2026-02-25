# README DEPLOYMENT - Xuong VinFast Phuc Loi Bot

**Status:** ✅ Code Ready | ⏳ Awaiting Setup & Deploy

---

## OVERVIEW

This is a **Telegram Bot + OCR License Plate Recognition System** for tracking vehicle entry/exit at VinFast workshop in Phuc Loi, Ha Noi.

**Stack:**
- **Backend:** Node.js + Express.js
- **Messaging:** Telegram Bot API
- **OCR:** Google Cloud Vision API (Vietnamese license plate detection)
- **Database:** Google Sheets (3 tabs)
- **Deployment:** Render.com / Railway.app / VPS

---

## QUICK START

### 1. Prerequisites
- Node.js >= 18.0.0
- npm or yarn
- Telegram account
- Google account (for Service Account + Google Sheets)

### 2. Local Testing
```bash
# Install dependencies
npm install

# Create .env from template
cp .env.template .env

# Edit .env with your credentials:
# - TELEGRAM_BOT_TOKEN
# - GOOGLE_SHEET_ID
# - GOOGLE_CREDENTIALS_JSON

# Run locally (development)
npm run dev

# Or production
npm start

# Test in another terminal
curl http://localhost:3000/health
```

### 3. Deploy to Cloud

**Option A: Render.com (Recommended)**
- See: `DEPLOY_TO_RENDER.md`

**Option B: Railway.app**
- Connect GitHub repo
- Add environment variables
- Auto-deploy

**Option C: Your own VPS**
- SSH in, clone repo, npm install
- Setup PM2 for process management
- Configure domain + SSL

---

## SETUP STEPS

Follow this checklist in order:

### Step 1: Telegram Bot
- [ ] Go to https://t.me/BotFather
- [ ] Create new bot
- [ ] Save token → `TELEGRAM_BOT_TOKEN`

**See:** `SETUP_GUIDE.md` - "Tạo Telegram Bot"

### Step 2: Google Sheets
- [ ] Create sheet at https://sheets.google.com
- [ ] Create 3 tabs:
  - `DANH SACH CHINH` (vehicle inventory)
  - `NHAT KY` (event log)
  - `CAN KIEM TRA` (error review)
- [ ] Save Sheet ID → `GOOGLE_SHEET_ID`

**See:** `SETUP_GUIDE.md` - "Tạo Google Sheet"

### Step 3: Google Cloud Service Account
- [ ] Go to https://console.cloud.google.com
- [ ] Enable APIs:
  - Google Sheets API
  - Cloud Vision API
- [ ] Create Service Account
- [ ] Download JSON key
- [ ] Save JSON content → `GOOGLE_CREDENTIALS_JSON`
- [ ] Share Google Sheet with Service Account email (Editor role)

**See:** `SETUP_GUIDE.md` - "Tạo Google Service Account"

### Step 4: Environment Variables
- [ ] Copy `.env.template` to `.env`
- [ ] Fill in all required variables

**See:** `.env.template` for descriptions

### Step 5: Deploy
- [ ] Choose platform (Render/Railway/VPS)
- [ ] Deploy using `npm install` + `npm start`
- [ ] Get server URL (e.g., `https://xuong-vinfast-bot.onrender.com`)

**See:** `DEPLOY_TO_RENDER.md` for detailed steps

### Step 6: Test
- [ ] Health check: `curl https://your-domain.com/health`
- [ ] Test `/start` command
- [ ] Test `HELP` command
- [ ] Test license plate image (should respond within 5-10s)
- [ ] Verify Google Sheets updated

**See:** `DEPLOYMENT_CHECKLIST.md` - Test Bot section

### Step 7: Report
- [ ] Fill out `DEPLOYMENT_REPORT_TEMPLATE.md`
- [ ] Send to team

---

## FILE STRUCTURE

```
.
├── src/
│   ├── server.js              # Express server + Telegram webhook
│   ├── config.js              # Load & validate environment variables
│   ├── telegram.js            # Telegram Bot API wrapper
│   ├── ocr.js                 # Google Cloud Vision (plate recognition)
│   ├── sheets.js              # Google Sheets API wrapper
│   ├── matcher.js             # Business logic (VAO/RA detection, alerts)
│   ├── utils.js               # Helpers (plate normalization, ID generation)
│   ├── logger.js              # Winston logger
│   └── scripts/
│       └── check-alerts.js    # Cron script for time-based alerts
├── test/
│   └── utils.test.js          # Unit tests
├── .env.template              # Environment template
├── .env.example               # Legacy example (use .env.template)
├── package.json               # Dependencies
├── SETUP_GUIDE.md             # Vietnamese setup guide
├── DEPLOYMENT_CHECKLIST.md    # Detailed checklist
├── DEPLOY_TO_RENDER.md        # Render.com specific guide
├── DEPLOYMENT_REPORT_TEMPLATE.md  # Report template
├── GUARD_INSTRUCTIONS_VI.md   # Vietnamese user manual
└── README.md                  # Project info

```

---

## ENVIRONMENT VARIABLES

### Required
```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
GOOGLE_SHEET_ID=1abc2def3ghi4jkl5mno6pqr7stu8vwxyz
GOOGLE_CREDENTIALS_JSON={"type":"service_account",...}
```

### Optional
```env
TELEGRAM_WEBHOOK_URL=https://your-domain.com
GOOGLE_VISION_CREDENTIALS_JSON=
OCR_CONFIDENCE_HIGH=0.8
OCR_CONFIDENCE_MEDIUM=0.5
ALERT_HOURS_WARNING=24
ALERT_HOURS_URGENT=48
MANAGER_CHAT_IDS=123456789,987654321
DAILY_REPORT_HOUR=18
TIMEZONE=Asia/Ho_Chi_Minh
PORT=3000
NODE_ENV=production
```

---

## API ENDPOINTS

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/webhook/telegram` | Telegram bot webhook |
| POST | `/admin/check-alerts` | Trigger alert check |
| POST | `/admin/daily-report` | Trigger daily report |

---

## FEATURES

- ✅ **License Plate OCR** - Automatic recognition using Google Cloud Vision
- ✅ **VAO/RA Detection** - Automatically detects entry vs exit
- ✅ **Google Sheets Integration** - Real-time data sync
- ✅ **Time-based Alerts** - Warns if vehicle stays >24h (warning) or >48h (urgent)
- ✅ **Daily Reports** - Auto-send summary at specified hour
- ✅ **Error Handling** - Failed OCR stored in review tab
- ✅ **Idempotency** - Duplicate message detection

---

## TELEGRAM COMMANDS

| Command | Function | Example |
|---------|----------|---------|
| `/start` | Initialize bot | `/start` |
| `HELP` | Show instructions | `HELP` |
| `TONKHO` | View inventory | `TONKHO` |
| Send image | Record entry/exit | [Send photo] |

---

## GOOGLE SHEETS TABS

### DANH SACH CHINH (Main Inventory)
Tracks all vehicles (entry/exit/duration/images/status)

### NHAT KY (Event Log)
Detailed log of every photo capture (timestamp, confidence, result)

### CAN KIEM TRA (Review Needed)
Failed OCR attempts that need manual correction

---

## DEPLOYMENT PLATFORMS

### Render.com ⭐ RECOMMENDED
- Free tier: 0.5 credits/hour (~$5/month equivalent)
- But get $5 free credit/month = FREE for low-traffic bot
- Easy GitHub integration
- Good uptime (99.9%+)
- **See:** `DEPLOY_TO_RENDER.md`

### Railway.app
- Free tier: $5/month credit
- GitHub integration
- Good for beginners
- Slightly slower cold starts

### VPS (Self-hosted)
- Full control
- Need to manage updates/security
- More complex setup
- Best for high-traffic apps

---

## TROUBLESHOOTING

### Bot doesn't respond
```bash
# 1. Check server is running
curl https://your-domain.com/health

# 2. Verify webhook is set
curl -s "https://api.telegram.org/bot<TOKEN>/getWebhookInfo" | jq '.result'

# 3. Check logs in Render/Railway/VPS
```

### Google Sheets not updating
- Verify API enabled
- Verify Service Account shared (Editor role)
- Verify JSON is valid
- Check server logs for errors

### OCR not recognizing plates
- Take clearer photos (straight angle, good lighting)
- Ensure plate is fully visible
- Failed attempts logged in `CAN KIEM TRA` tab for review

---

## MONITORING

### Daily
- Check `TONKHO` for overnight entries
- Monitor bot responsiveness

### Weekly
- Review `CAN KIEM TRA` tab for OCR failures
- Check server logs

### Monthly
- Full system health check
- Verify webhook still active
- Test complete workflow

---

## SECURITY NOTES

⚠️ **Never commit `.env` to git** - it's in `.gitignore`

⚠️ **Keep Service Account JSON safe** - contains private key

⚠️ **Don't share Bot Token publicly**

✅ Use environment variables for all secrets

✅ Rotate credentials quarterly

✅ Monitor access logs

---

## SUPPORT & DOCUMENTATION

1. **Setup Help:** See `SETUP_GUIDE.md`
2. **Deployment Help:** See `DEPLOY_TO_RENDER.md`
3. **Testing Checklist:** See `DEPLOYMENT_CHECKLIST.md`
4. **User Manual (Vietnamese):** See `GUARD_INSTRUCTIONS_VI.md`
5. **Post-Deployment Report:** See `DEPLOYMENT_REPORT_TEMPLATE.md`

---

## NEXT STEPS

1. **Read** `SETUP_GUIDE.md` - understand full setup
2. **Follow** `DEPLOYMENT_CHECKLIST.md` - step-by-step guide
3. **Deploy** using `DEPLOY_TO_RENDER.md`
4. **Test** thoroughly before going live
5. **Report** using `DEPLOYMENT_REPORT_TEMPLATE.md`
6. **Train** guards using `GUARD_INSTRUCTIONS_VI.md`

---

## PROJECT INFO

- **Repository:** xuong-vinfast-phuc-loi
- **Branch:** claude/vehicle-tracking-zalo-ocr-3ERhn
- **Version:** 2.0.0
- **Node Version:** >= 18.0.0
- **License:** UNLICENSED (Internal Use)

---

## FAQ

**Q: How long to deploy?**
A: ~30 minutes (setup) + ~5 minutes (deploy) + ~15 minutes (testing)

**Q: How much does it cost?**
A: Render free tier is sufficient ($5/month value, but you get free credits)

**Q: Can it handle 100+ vehicles/day?**
A: Yes, easily. No scaling issues for workshop use case.

**Q: What if bot stops?**
A: Auto-restart in Render. Manual restart possible via dashboard.

**Q: Is data secure?**
A: Yes, Google Sheets auto-backup, credentials in env vars

---

**Ready to deploy?** → Start with `SETUP_GUIDE.md` ✅
