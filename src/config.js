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
        main: optionalEnv('SHEET_TAB_MAIN', 'DANH SÁCH CHÍNH'),
        log: optionalEnv('SHEET_TAB_LOG', 'NHẬT KÝ'),
        review: optionalEnv('SHEET_TAB_REVIEW', 'CẦN KIỂM TRA'),
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

    // Canh bao
    alerts: {
      warningHours: parseFloat(optionalEnv('ALERT_HOURS_WARNING', '24')),
      urgentHours: parseFloat(optionalEnv('ALERT_HOURS_URGENT', '48')),
      minWorkshopMinutes: parseInt(optionalEnv('MIN_WORKSHOP_MINUTES', '3'), 10),
    },

    // Quan ly
    manager: {
      chatIds: optionalEnv('MANAGER_CHAT_IDS', '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
      dailyReportHour: parseInt(optionalEnv('DAILY_REPORT_HOUR', '18'), 10),
    },

    // Supabase (PostgreSQL — source of truth)
    supabase: {
      url:        requireEnv('SUPABASE_URL'),
      serviceKey: requireEnv('SUPABASE_SERVICE_KEY'),
    },

    // Timezone
    timezone: optionalEnv('TIMEZONE', 'Asia/Ho_Chi_Minh'),
  };
}

module.exports = { loadConfig };
