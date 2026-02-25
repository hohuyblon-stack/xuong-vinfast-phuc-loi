# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Telegram bot for automated vehicle entry/exit tracking at a VinFast service center (55 Phuc Loi, Long Bien, Ha Noi). Guards photo license plates via Telegram; the bot uses Google Cloud Vision OCR to extract plate text, then logs entry/exit times in Google Sheets. Alerts managers when vehicles have been in the workshop too long.

## Commands

```bash
npm install          # Install dependencies
npm start            # Production server (node src/server.js)
npm run dev          # Development with hot-reload (nodemon)
npm test             # Run tests (node --test 'test/**/*.test.js')
npm run check-alerts # Manually trigger alert check
```

To run a single test file: `node --test test/utils.test.js`

## Architecture

**No traditional database** — Google Sheets is the sole data store.

**Request flow:**
1. Guard sends photo to Telegram bot
2. `server.js` receives webhook → downloads image → calls `ocr.js`
3. `ocr.js` uses Google Cloud Vision to extract license plate text
4. `matcher.js` checks `sheets.js` for the plate:
   - Plate not found → vehicle entry (VAO): writes new row to "DANH SACH CHINH"
   - Plate found with "Dang trong xuong" status → vehicle exit (RA): updates row with exit time and duration
5. `telegram.js` sends confirmation reply to the guard
6. Failures (low OCR confidence, unrecognizable plate) → row written to "CAN KIEM TRA" review queue

**Scheduled jobs** (in `server.js`):
- Every 30 minutes: alert check — vehicles in workshop >24h get "Canh bao", >48h get "Khan"; managers notified
- Daily at configured hour (default 18:00): summary report sent to manager Telegram IDs

**Google Sheets tabs:**
- `DANH SACH CHINH` — main vehicle log (vehicleId, plate, timeIn, timeOut, duration, status, priority, note)
- `NHAT KY` — immutable event log for every action
- `CAN KIEM TRA` — review queue for failed/low-confidence OCR

## Module Responsibilities

| File | Responsibility |
|------|---------------|
| `src/server.js` | Express app, `/webhook/telegram`, admin endpoints, cron schedulers |
| `src/config.js` | Loads and validates all env vars; import this instead of `process.env` directly |
| `src/matcher.js` | Core business logic: VAO/RA detection, alert thresholds, daily report generation |
| `src/sheets.js` | All Google Sheets read/write operations (CRUD for the 3 tabs) |
| `src/ocr.js` | Google Cloud Vision wrapper; returns plate text + confidence score |
| `src/telegram.js` | Telegram Bot API wrapper: webhook setup, message/photo sending, update parsing |
| `src/utils.js` | ID generation, time calculations, plate text normalization/validation |
| `src/logger.js` | Winston logger config (JSON file + colored console) |

## Environment Variables

Copy `.env.example` to `.env`. Required vars:

- `TELEGRAM_BOT_TOKEN` — from BotFather
- `TELEGRAM_WEBHOOK_URL` — public HTTPS URL of the server
- `GOOGLE_SHEET_ID` — Google Spreadsheet ID
- `GOOGLE_CREDENTIALS_JSON` — Service Account JSON (stringified)

Optional:
- `GOOGLE_VISION_CREDENTIALS_JSON` — separate Vision API creds (falls back to `GOOGLE_CREDENTIALS_JSON`)
- `MANAGER_CHAT_IDS` — comma-separated Telegram IDs for alerts/reports
- `ALERT_HOURS_WARNING` / `ALERT_HOURS_URGENT` — thresholds (default: 24/48)
- `DAILY_REPORT_HOUR` — 0–23, default 18
- `TIMEZONE` — default `Asia/Ho_Chi_Minh`

## API Endpoints

- `GET /health` — health check
- `POST /webhook/telegram` — Telegram webhook receiver
- `POST /admin/check-alerts` — manually trigger alert check
- `POST /admin/daily-report` — manually trigger daily report
