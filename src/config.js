'use strict';

/**
 * Cau hinh tap trung - doc tu ENV, validate, export.
 */

function requireEnv(key) {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return val;
}

function optionalEnv(key, fallback) {
  return process.env[key] || fallback;
}

function parseGoogleCredentials(raw) {
  const creds = JSON.parse(raw);
  if (creds.private_key) {
    creds.private_key = creds.private_key.replace(/\\n/g, '\n');
  }
  return creds;
}

function loadConfig() {
  return {
    port: parseInt(optionalEnv('PORT', '3000'), 10),
    nodeEnv: optionalEnv('NODE_ENV', 'development'),

    // Telegram Bot
    telegram: {
      botToken: requireEnv('TELEGRAM_BOT_TOKEN'),
      webhookUrl: optionalEnv('TELEGRAM_WEBHOOK_URL', ''),
    },

    // Google Sheets
    sheets: {
      spreadsheetId: requireEnv('GOOGLE_SHEET_ID'),
      credentials: parseGoogleCredentials(requireEnv('GOOGLE_CREDENTIALS_JSON')),
      tabNames: {
        main: 'DANH SACH CHINH',
        log: 'NHAT KY',
        review: 'CAN KIEM TRA',
      },
    },

    // OCR (Google Cloud Vision)
    ocr: {
      credentials: process.env.GOOGLE_VISION_CREDENTIALS_JSON
        ? parseGoogleCredentials(process.env.GOOGLE_VISION_CREDENTIALS_JSON)
        : parseGoogleCredentials(requireEnv('GOOGLE_CREDENTIALS_JSON')),
      confidenceHigh: parseFloat(optionalEnv('OCR_CONFIDENCE_HIGH', '0.8')),
      confidenceMedium: parseFloat(optionalEnv('OCR_CONFIDENCE_MEDIUM', '0.5')),
    },

    // Canh bao
    alerts: {
      warningHours: parseFloat(optionalEnv('ALERT_HOURS_WARNING', '24')),
      urgentHours: parseFloat(optionalEnv('ALERT_HOURS_URGENT', '48')),
    },

    // Quan ly
    manager: {
      chatIds: optionalEnv('MANAGER_CHAT_IDS', '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
      dailyReportHour: parseInt(optionalEnv('DAILY_REPORT_HOUR', '18'), 10),
    },

    // Timezone
    timezone: optionalEnv('TIMEZONE', 'Asia/Ho_Chi_Minh'),
  };
}

module.exports = { loadConfig };
