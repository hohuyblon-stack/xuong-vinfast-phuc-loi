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
    port:    parseInt(optionalEnv('PORT', '3000'), 10),
    nodeEnv: optionalEnv('NODE_ENV', 'development'),

    // Zalo OA
    zalo: {
      accessToken: requireEnv('ZALO_ACCESS_TOKEN'),
      oaSecretKey: optionalEnv('ZALO_OA_SECRET_KEY', ''),
    },

    // SQLite database (thay the Google Sheets - mien phi, khong rate limit)
    db: {
      dbPath: optionalEnv('DB_PATH', './data/xuong.db'),
    },

    // OCR (Tesseract local - mien phi, khong can credentials)
    ocr: {
      confidenceHigh:   parseFloat(optionalEnv('OCR_CONFIDENCE_HIGH', '0.8')),
      confidenceMedium: parseFloat(optionalEnv('OCR_CONFIDENCE_MEDIUM', '0.5')),
    },

    // Canh bao
    alerts: {
      warningHours: parseFloat(optionalEnv('ALERT_HOURS_WARNING', '24')),
      urgentHours:  parseFloat(optionalEnv('ALERT_HOURS_URGENT', '48')),
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
