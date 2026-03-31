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
      webhookSecret: optionalEnv('TELEGRAM_WEBHOOK_SECRET', ''),
    },

    // Security
    security: {
      adminApiKey: optionalEnv('ADMIN_API_KEY', ''),
    },

    // Google Sheets
    sheets: {
      spreadsheetId: requireEnv('GOOGLE_SHEET_ID'),
      credentials: JSON.parse(requireEnv('GOOGLE_CREDENTIALS_JSON')),
      tabNames: {
        main: optionalEnv('SHEET_TAB_MAIN', 'ĐANG TRONG XƯỞNG'),
        completed: optionalEnv('SHEET_TAB_COMPLETED', 'ĐÃ RA XƯỞNG'),
        log: optionalEnv('SHEET_TAB_LOG', 'NHẬT KÝ'),
        review: optionalEnv('SHEET_TAB_REVIEW', 'CẦN KIỂM TRA'),
        dailyReport: optionalEnv('SHEET_TAB_DAILY_REPORT', 'BÁO CÁO HÀNG NGÀY'),
      },
    },

    // OCR (Poe API)
    ocr: {
      apiKey: requireEnv('POE_API_KEY'),
      model: optionalEnv('POE_OCR_MODEL', 'GPT-4o-mini'),
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
      morningReportHour: parseInt(optionalEnv('MORNING_REPORT_HOUR', '7'), 10),
    },

    // Intelligence thresholds (smart report)
    intelligence: {
      workshopCapacity: parseInt(optionalEnv('WORKSHOP_CAPACITY', '130'), 10),
      durationFastHours: 3,
      durationNormalHours: 5,
      durationSlowHours: 8,
      predictiveBufferHours: 12,
      repeatVisitorDays: 14,
      durationStatsDays: 30,
      weeklyAvgDays: 7,
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
