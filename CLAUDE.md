# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Telegram Bot system for automatic vehicle entry/exit tracking at a VinFast service center (55 Phuc Loi, Long Bien, Ha Noi). Uses OCR (Google Cloud Vision) to read license plates from photos and logs data to Google Sheets.

## Commands

```bash
npm start          # Production: node src/server.js
npm run dev        # Development with nodemon hot-reload
npm test           # Run tests: node --test 'test/**/*.test.js'
npm run check-alerts  # Manually trigger alert check
```

No build step or transpilation — plain Node.js. No linter configured.

To run a single test file: `node --test test/utils.test.js`

## Required Environment Variables

Copy `.env.example` to `.env`. Three variables are required:
- `TELEGRAM_BOT_TOKEN` — from @BotFather
- `GOOGLE_SHEET_ID` — the Google Sheet used as the database
- `GOOGLE_CREDENTIALS_JSON` — service account JSON string (used for both Sheets and Vision APIs)

## Architecture

**Stack:** Express.js webhook server + Telegram Bot API + Google Cloud Vision OCR + Google Sheets as database.

### Data Model (3 Google Sheets tabs)
1. **DANH SACH CHINH** — Active vehicle tracking (plate, entry time, exit time, duration, status, priority, notes)
2. **NHAT KY** — Full event audit log (all OCR attempts, confidence scores, raw messages)
3. **CAN KIEM TRA** — Review queue for low-confidence or unrecognized plates

### Request Flow
```
Telegram photo → POST /webhook/telegram
  → idempotency check (message ID in sheets)
  → telegram.getFileUrl() → ocr.recognizePlate() (Google Vision)
  → matcher.processVehicleEvent()
      → sheets.appendLogRow()        (always log the attempt)
      → sheets.findMainRow()         (check if plate already in workshop)
      → auto-determine VAO/RA based on plate presence
      → sheets.appendMainRow() or updateMainRow()
  → telegram.sendMessage() (reply to user)
```

VAO/RA action is inferred automatically from whether the plate already exists in the main sheet — guards don't need to type commands.

### Module Responsibilities

| File | Role |
|------|------|
| `src/server.js` | Express setup, webhook route, periodic tasks (30-min alert checks, daily report scheduling) |
| `src/matcher.js` | Core business logic: processVehicleEvent, auto VAO/RA detection, alert thresholds, TONKHO and daily report handlers |
| `src/sheets.js` | All Google Sheets CRUD across 3 tabs; idempotency check lives here |
| `src/ocr.js` | Google Vision wrapper; scoring combines regex pattern match + block confidence scores |
| `src/telegram.js` | Telegram API wrapper: webhook extraction, file URL resolution, sendMessage |
| `src/config.js` | Loads and validates all env vars at startup; fails fast with clear errors |
| `src/utils.js` | ID generation, plate normalization/validation (Vietnam regex), time formatting, confidence labeling |

### Periodic Tasks
- Every 30 minutes: `checkTimeAlerts()` scans all active vehicles and upgrades priority (24h → WARNING, 48h → URGENT)
- Daily at configurable hour (default 18:00): `handleDailyReport()` sends summary to manager chat IDs

### Error Handling Pattern
Low-confidence OCR results are not rejected — they're flagged in the CAN KIEM TRA tab for manual review while still attempting to process. `matcher.js` handles blurry images, invalid plate formats, and duplicate messages gracefully.

### Async Webhook Pattern
`server.js` returns HTTP 200 to Telegram immediately, then calls `processMessageAsync()` in the background to avoid Telegram's 5-second webhook timeout.
