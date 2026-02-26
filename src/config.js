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
      credentials: JSON.parse(requireEnv('GOOGLE_CREDENTIALS_JSON')),
      tabNames: {
        main: 'DANH SACH CHINH',
        log: 'NHAT KY',
        review: 'CAN KIEM TRA',
        archive: 'LUU TRU',
      },
    },

    // OCR (Google Cloud Vision)
    ocr: {
      credentials: process.env.GOOGLE_VISION_CREDENTIALS_JSON
        ? JSON.parse(process.env.GOOGLE_VISION_CREDENTIALS_JSON)
        : JSON.parse(requireEnv('GOOGLE_CREDENTIALS_JSON')),
      confidenceHigh: parseFloat(optionalEnv('OCR_CONFIDENCE_HIGH', '0.8')),
      confidenceMedium: parseFloat(optionalEnv('OCR_CONFIDENCE_MEDIUM', '0.5')),
    },

    // Luu tru tu dong: xe da RA qua X gio → chuyen sang tab LUU TRU
    archive: {
      afterHours: parseFloat(optionalEnv('ARCHIVE_AFTER_HOURS', '24')),
    },

    // Timezone
    timezone: optionalEnv('TIMEZONE', 'Asia/Ho_Chi_Minh'),
  };
}

module.exports = { loadConfig };
