'use strict';

/**
 * Cấu hình tập trung - đọc từ ENV, validate, export.
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

    // Zalo OA
    zalo: {
      accessToken: requireEnv('ZALO_OA_ACCESS_TOKEN'),
      secretKey: requireEnv('ZALO_OA_SECRET_KEY'),
      webhookVerifyToken: optionalEnv('ZALO_WEBHOOK_VERIFY_TOKEN', ''),
    },

    // Google Sheets
    sheets: {
      spreadsheetId: requireEnv('GOOGLE_SHEET_ID'),
      credentials: JSON.parse(requireEnv('GOOGLE_CREDENTIALS_JSON')),
      tabNames: {
        main: 'DANH SÁCH CHÍNH',
        log: 'NHẬT KÝ GHI NHẬN',
        review: 'CẦN KIỂM TRA',
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

    // Cảnh báo
    alerts: {
      warningHours: parseFloat(optionalEnv('ALERT_HOURS_WARNING', '4')),
      urgentHours: parseFloat(optionalEnv('ALERT_HOURS_URGENT', '8')),
    },

    // Timezone
    timezone: optionalEnv('TIMEZONE', 'Asia/Ho_Chi_Minh'),
  };
}

module.exports = { loadConfig };
