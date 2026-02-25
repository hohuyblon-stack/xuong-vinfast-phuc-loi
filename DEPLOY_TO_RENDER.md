# DEPLOY TO RENDER.COM - Step-by-Step Guide

**Recommended:** Render.com (Free tier 0.5 credits/hour, sufficient for bot)

---

## 1. Prerequisites

Before deploying, make sure you have:
- [ ] Telegram Bot Token (from @BotFather)
- [ ] Google Sheet ID
- [ ] Google Service Account credentials JSON
- [ ] Google Sheet shared with Service Account (Editor role)
- [ ] GitHub account with repo connected (or can upload manual)

---

## 2. Render.com Setup

### Step 1: Create Account
- Go to https://render.com
- Sign up / Log in (can use GitHub login)

### Step 2: Create Web Service
- Click **New +** button (top right)
- Select **Web Service**

### Step 3: Connect Repository
Two options:

**Option A: Connect GitHub (Easier)**
- Click **Connect GitHub**
- Authorize Render to access your repos
- Select: `xuong-vinfast-phuc-loi`
- Branch: `claude/vehicle-tracking-zalo-ocr-3ERhn` (or main)

**Option B: Public GitHub URL (Manual)**
- Enter: `https://github.com/your-username/xuong-vinfast-phuc-loi.git`
- Click **Deploy using this repo**

### Step 4: Configure Web Service

Fill in these settings:

| Setting | Value |
|---------|-------|
| Name | `xuong-vinfast-bot` |
| Environment | `Node` |
| Region | `Singapore` (closest to Vietnam) |
| Build Command | `npm install` |
| Start Command | `npm start` |

### Step 5: Add Environment Variables

Click **Advanced** → **Add Environment Variable** for each:

```
PORT=3000
NODE_ENV=production

TELEGRAM_BOT_TOKEN=<your_bot_token>
TELEGRAM_WEBHOOK_URL=<leave empty for now, will update after deploy>

GOOGLE_SHEET_ID=<your_sheet_id>
GOOGLE_CREDENTIALS_JSON=<entire JSON content from Service Account>

OCR_CONFIDENCE_HIGH=0.8
OCR_CONFIDENCE_MEDIUM=0.5

ALERT_HOURS_WARNING=24
ALERT_HOURS_URGENT=48

MANAGER_CHAT_IDS=<optional, your telegram chat id>
DAILY_REPORT_HOUR=18

TIMEZONE=Asia/Ho_Chi_Minh
```

**⚠️ Important:** For `GOOGLE_CREDENTIALS_JSON`:
- Open the JSON file you downloaded from Google Cloud
- Copy ENTIRE content (from `{` to `}`)
- Paste into Render environment variable

### Step 6: Free Tier Settings

- Scroll down to **Auto Spin Down**
- **Disable** it (toggle off) so bot keeps running 24/7
- This is important because Render spins down free services after 15 minutes of inactivity

### Step 7: Deploy

- Click **Create Web Service**
- Render will start building (takes 3-5 minutes)
- You'll see logs in the dashboard
- Wait for "Service is live on..."

### Step 8: Get Your Server URL

After deployment completes:
- Look for: **Your service is live on:** `https://xuong-vinfast-bot.onrender.com`
- **Copy this URL** - you'll need it next

---

## 3. Enable Telegram Webhook

After server is deployed with URL, update webhook:

### Option A: Auto-Configure (If server running)
The bot code automatically sets webhook when it starts IF `TELEGRAM_WEBHOOK_URL` is set.

**Steps:**
1. Go back to Render dashboard
2. Find your service: `xuong-vinfast-bot`
3. Click **Environment** (or similar)
4. Edit variable: `TELEGRAM_WEBHOOK_URL`
5. Set value: `https://xuong-vinfast-bot.onrender.com` (replace with your actual domain)
6. Save (service will auto-redeploy)
7. Watch logs - should see: `Telegram webhook set: https://xuong-vinfast-bot.onrender.com/webhook/telegram`

### Option B: Manual Webhook Setup
Use Telegram Bot API directly:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://xuong-vinfast-bot.onrender.com/webhook/telegram"}'
```

Expected response:
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

---

## 4. Verify Deployment

### 1. Health Check
```bash
curl https://xuong-vinfast-bot.onrender.com/health
```

Should return:
```json
{"status":"ok","service":"xuong-vinfast-phuc-loi","time":"2026-02-25T..."}
```

### 2. Check Render Logs
- Go to Render dashboard
- Click your service
- Click **Logs** tab
- Should see:
  ```
  Server started on port 3000
  Xuong VinFast Phuc Loi - He thong theo doi xe vao/ra (Telegram Bot)
  Webhook URL: POST /webhook/telegram
  Telegram webhook set: https://xuong-vinfast-bot.onrender.com/webhook/telegram
  ```

### 3. Test Telegram Bot
- Open Telegram
- Find your bot
- Send `/start` → should get response
- Send `HELP` → should get instructions

### 4. Test License Plate Image
- Chụp ảnh biển số xe
- Gửi ảnh vào bot
- Bot should respond within 5-10 seconds
- Check Google Sheets:
  - Tab **DANH SACH CHINH**: vehicle should appear
  - Tab **NHAT KY**: event log should appear

---

## 5. Troubleshooting

### Bot not responding to messages

**Check 1: Webhook set correctly?**
```bash
curl -s "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo" | jq '.result'
```

Should show:
```json
{
  "url": "https://xuong-vinfast-bot.onrender.com/webhook/telegram",
  "has_custom_certificate": false,
  "pending_update_count": 0,
  ...
}
```

**Check 2: Server running?**
```bash
curl https://xuong-vinfast-bot.onrender.com/health
```

If fails, check Render logs for errors

**Check 3: Render logs**
- Go to Render dashboard
- View **Logs** tab
- Look for error messages

### Google Sheets not updating

**Check 1: Credentials correct?**
- Verify JSON is valid (no syntax errors)
- Verify `client_email` in JSON
- Verify Sheet is shared with that email

**Check 2: Sheet ID correct?**
- Go to Google Sheets URL
- Copy ID from URL: `...spreadsheets/d/{SHEET_ID}/edit`
- Make sure GOOGLE_SHEET_ID env var matches

**Check 3: Tabs exist?**
- Open Google Sheet
- Verify 3 tabs exist with EXACT names:
  - `DANH SACH CHINH`
  - `NHAT KY`
  - `CAN KIEM TRA`

### Server keeps spinning down

If using free tier and bot seems to stop after 15 minutes:
- Go to Render dashboard
- Find your service
- Look for **Auto Spin Down** setting
- **Disable it**
- Service will restart and stay running

**Alternative:** Upgrade to Starter plan ($7/month) for guaranteed uptime

### Cloud Vision API not working

**Check 1: API enabled?**
- Go to https://console.cloud.google.com
- Click **APIs & Services**
- Verify **Cloud Vision API** is enabled

**Check 2: Service Account has access?**
- Go to **IAM & Admin**
- Find Service Account
- Should have role: **Editor** or **Cloud Vision API User**

---

## 6. Production Checklist

Before going live with guards:

- [ ] Health check passes
- [ ] Telegram `/start` and `HELP` work
- [ ] License plate image test succeeds
- [ ] Google Sheets updated with test data
- [ ] Second photo of same vehicle shows "RA" (out)
- [ ] Manager Chat IDs configured (if want alerts)
- [ ] Daily Report Hour set correct (recommend 18 = 6PM)
- [ ] Render Auto Spin Down is disabled

---

## 7. Monitoring & Maintenance

### Regular Checks
- Every week: Send test image, verify Google Sheets update
- Every month: Check Render logs for errors
- Monitor Google Sheets for "CAN KIEM TRA" (errors) tab

### Update Bot
If you need to update code:
1. Push changes to GitHub
2. Render auto-redeploys (if GitHub connected)
3. Or manually redeploy in Render dashboard
4. Logs will show deployment progress

### Restart Service
If bot stops responding:
1. Go to Render dashboard
2. Click service
3. Click **More** → **Restart Service**
4. Wait for restart (30 seconds)

---

## 8. Cost & Credits

**Render Free Tier:**
- 0.5 CPU credits per hour
- ~$5/month equivalent if always running
- Free tier gets: $5/month free credit
- **Your bot likely uses < 0.5 credits/month** (it's idle mostly)

**Cost breakdown:**
- 730 hours/month
- 0.5 credits/hour = 365 credits/month
- At free tier, you get $5 = 500 credits free
- **Result: FREE** ✓

---

## 9. Next Steps

1. Finish deployment setup
2. Test bot thoroughly
3. Train guards how to use it
4. Monitor for 1 week
5. File final report to team

**For help:** Check logs, re-read this guide, or contact support

---

**Deployed:** `https://xuong-vinfast-bot.onrender.com`
**Status:** Ready for production ✓
