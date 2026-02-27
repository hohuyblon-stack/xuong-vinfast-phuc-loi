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
  let cleaned = raw.trim();

  // Strip surrounding single or double quotes (common copy-paste issue)
  if ((cleaned.startsWith("'") && cleaned.endsWith("'")) ||
      (cleaned.startsWith('"') && cleaned.endsWith('"') && !cleaned.startsWith('{"'))) {
    cleaned = cleaned.slice(1, -1);
  }

  // If value looks like JSON content without wrapping braces, add them
  if (!cleaned.startsWith('{') && cleaned.includes('"type"')) {
    cleaned = '{' + cleaned + '}';
  }

  // Try Base64 decoding if it doesn't look like JSON
  if (!cleaned.startsWith('{')) {
    try {
      const decoded = Buffer.from(cleaned, 'base64').toString('utf8');
      if (decoded.startsWith('{')) {
        cleaned = decoded;
      }
    } catch (_) {
      // Not base64, continue
    }
  }

  let creds;
  try {
    creds = JSON.parse(cleaned);
  } catch (firstErr) {
    // Try unescaping common shell/env var escaping patterns
    try {
      const unescaped = cleaned.replace(/\\"/g, '"').replace(/\\'/g, "'");
      creds = JSON.parse(unescaped);
    } catch (_) {
      console.error('[config] GOOGLE_CREDENTIALS_JSON parse failed. Raw value starts with:',
        JSON.stringify(raw.substring(0, 40)),
        'length:', raw.length);
      throw firstErr;
    }
  }

  // If JSON.parse returned a string, it was double-stringified - parse again
  if (typeof creds === 'string') {
    creds = JSON.parse(creds);
  }

  if (creds.private_key) {
    // Handle double-escaped newlines from env var pasting
    creds.private_key = creds.private_key.replace(/\\n/g, '\n');
    // Ensure key starts and ends correctly
    if (!creds.private_key.includes('-----BEGIN')) {
      throw new Error(
        'Invalid private_key: missing PEM header. ' +
        'Make sure GOOGLE_CREDENTIALS_JSON contains the full JSON from the downloaded key file.'
      );
    }
  }
  // Log credential info for debugging (no secrets)
  console.log('[config] Google credentials loaded:', {
    type: creds.type,
    project_id: creds.project_id,
    client_email: creds.client_email,
    private_key_id: creds.private_key_id,
    has_private_key: !!creds.private_key,
    private_key_length: creds.private_key ? creds.private_key.length : 0,
  });
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
