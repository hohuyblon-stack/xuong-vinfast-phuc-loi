'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// Save original process.env
const originalEnv = { ...process.env };

// Helper to set environment variables
function setEnv(vars) {
  Object.keys(vars).forEach(key => {
    if (vars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = vars[key];
    }
  });
}

// Helper to reset environment
function resetEnv() {
  Object.keys(process.env).forEach(key => {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  });
  Object.assign(process.env, originalEnv);
}

// ──────────────────────────────────────────────
// Test: loadConfig with required variables
// ──────────────────────────────────────────────

describe('loadConfig', () => {
  beforeEach(() => {
    // Clear all env vars except those needed for tests
    delete require.cache[require.resolve('../src/config')];
  });

  afterEach(() => {
    resetEnv();
    delete require.cache[require.resolve('../src/config')];
  });

  it('should throw when missing TELEGRAM_BOT_TOKEN', () => {
    setEnv({
      'TELEGRAM_BOT_TOKEN': undefined,
      'GOOGLE_SHEET_ID': 'test-id',
      'GOOGLE_CREDENTIALS_JSON': '{}',
      'SUPABASE_URL': 'https://test.supabase.co',
      'SUPABASE_SERVICE_KEY': 'test-key',
    });

    const { loadConfig } = require('../src/config');

    try {
      loadConfig();
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('TELEGRAM_BOT_TOKEN'));
    }
  });

  it('should throw when missing GOOGLE_SHEET_ID', () => {
    setEnv({
      'TELEGRAM_BOT_TOKEN': 'test-token',
      'GOOGLE_SHEET_ID': undefined,
      'GOOGLE_CREDENTIALS_JSON': '{}',
      'SUPABASE_URL': 'https://test.supabase.co',
      'SUPABASE_SERVICE_KEY': 'test-key',
    });

    const { loadConfig } = require('../src/config');

    try {
      loadConfig();
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('GOOGLE_SHEET_ID'));
    }
  });

  it('should throw when GOOGLE_CREDENTIALS_JSON is invalid JSON', () => {
    setEnv({
      'TELEGRAM_BOT_TOKEN': 'test-token',
      'GOOGLE_SHEET_ID': 'test-id',
      'GOOGLE_CREDENTIALS_JSON': 'invalid json',
      'SUPABASE_URL': 'https://test.supabase.co',
      'SUPABASE_SERVICE_KEY': 'test-key',
    });

    const { loadConfig } = require('../src/config');

    try {
      loadConfig();
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err instanceof SyntaxError || err.message);
    }
  });

  it('should load config with all required variables', () => {
    const credentialsJson = JSON.stringify({ type: 'service_account', project_id: 'test' });
    setEnv({
      'TELEGRAM_BOT_TOKEN': 'bot-token-123',
      'GOOGLE_SHEET_ID': 'sheet-id-456',
      'GOOGLE_CREDENTIALS_JSON': credentialsJson,
      'SUPABASE_URL': 'https://test.supabase.co',
      'SUPABASE_SERVICE_KEY': 'service-key-789',
    });

    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    assert.equal(config.telegram.botToken, 'bot-token-123');
    assert.equal(config.sheets.spreadsheetId, 'sheet-id-456');
    assert.equal(config.supabase.url, 'https://test.supabase.co');
    assert.equal(config.supabase.serviceKey, 'service-key-789');
  });
});

// ──────────────────────────────────────────────
// Test: optional configuration with defaults
// ──────────────────────────────────────────────

describe('config optional fields and defaults', () => {
  beforeEach(() => {
    delete require.cache[require.resolve('../src/config')];
  });

  afterEach(() => {
    resetEnv();
    delete require.cache[require.resolve('../src/config')];
  });

  it('should use default PORT if not set', () => {
    const credentialsJson = JSON.stringify({ type: 'service_account' });
    setEnv({
      'TELEGRAM_BOT_TOKEN': 'token',
      'GOOGLE_SHEET_ID': 'id',
      'GOOGLE_CREDENTIALS_JSON': credentialsJson,
      'SUPABASE_URL': 'https://test.supabase.co',
      'SUPABASE_SERVICE_KEY': 'key',
      'PORT': undefined,
    });

    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    assert.equal(config.port, 3000);
  });

  it('should parse PORT as integer', () => {
    const credentialsJson = JSON.stringify({ type: 'service_account' });
    setEnv({
      'TELEGRAM_BOT_TOKEN': 'token',
      'GOOGLE_SHEET_ID': 'id',
      'GOOGLE_CREDENTIALS_JSON': credentialsJson,
      'SUPABASE_URL': 'https://test.supabase.co',
      'SUPABASE_SERVICE_KEY': 'key',
      'PORT': '8080',
    });

    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    assert.equal(config.port, 8080);
    assert.ok(typeof config.port === 'number');
  });

  it('should use default NODE_ENV if not set', () => {
    const credentialsJson = JSON.stringify({ type: 'service_account' });
    setEnv({
      'TELEGRAM_BOT_TOKEN': 'token',
      'GOOGLE_SHEET_ID': 'id',
      'GOOGLE_CREDENTIALS_JSON': credentialsJson,
      'SUPABASE_URL': 'https://test.supabase.co',
      'SUPABASE_SERVICE_KEY': 'key',
      'NODE_ENV': undefined,
    });

    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    assert.equal(config.nodeEnv, 'development');
  });

  it('should use default timezone', () => {
    const credentialsJson = JSON.stringify({ type: 'service_account' });
    setEnv({
      'TELEGRAM_BOT_TOKEN': 'token',
      'GOOGLE_SHEET_ID': 'id',
      'GOOGLE_CREDENTIALS_JSON': credentialsJson,
      'SUPABASE_URL': 'https://test.supabase.co',
      'SUPABASE_SERVICE_KEY': 'key',
      'TIMEZONE': undefined,
    });

    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    assert.equal(config.timezone, 'Asia/Ho_Chi_Minh');
  });

  it('should use custom timezone if set', () => {
    const credentialsJson = JSON.stringify({ type: 'service_account' });
    setEnv({
      'TELEGRAM_BOT_TOKEN': 'token',
      'GOOGLE_SHEET_ID': 'id',
      'GOOGLE_CREDENTIALS_JSON': credentialsJson,
      'SUPABASE_URL': 'https://test.supabase.co',
      'SUPABASE_SERVICE_KEY': 'key',
      'TIMEZONE': 'UTC',
    });

    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    assert.equal(config.timezone, 'UTC');
  });
});

// ──────────────────────────────────────────────
// Test: alert thresholds parsing
// ──────────────────────────────────────────────

describe('config alert thresholds', () => {
  beforeEach(() => {
    delete require.cache[require.resolve('../src/config')];
  });

  afterEach(() => {
    resetEnv();
    delete require.cache[require.resolve('../src/config')];
  });

  it('should parse alert hours as float', () => {
    const credentialsJson = JSON.stringify({ type: 'service_account' });
    setEnv({
      'TELEGRAM_BOT_TOKEN': 'token',
      'GOOGLE_SHEET_ID': 'id',
      'GOOGLE_CREDENTIALS_JSON': credentialsJson,
      'SUPABASE_URL': 'https://test.supabase.co',
      'SUPABASE_SERVICE_KEY': 'key',
      'ALERT_HOURS_WARNING': '24.5',
      'ALERT_HOURS_URGENT': '48.5',
    });

    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    assert.equal(config.alerts.warningHours, 24.5);
    assert.equal(config.alerts.urgentHours, 48.5);
  });

  it('should parse min workshop minutes as integer', () => {
    const credentialsJson = JSON.stringify({ type: 'service_account' });
    setEnv({
      'TELEGRAM_BOT_TOKEN': 'token',
      'GOOGLE_SHEET_ID': 'id',
      'GOOGLE_CREDENTIALS_JSON': credentialsJson,
      'SUPABASE_URL': 'https://test.supabase.co',
      'SUPABASE_SERVICE_KEY': 'key',
      'MIN_WORKSHOP_MINUTES': '30',
    });

    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    assert.equal(config.alerts.minWorkshopMinutes, 30);
  });

  it('should use default alert thresholds', () => {
    const credentialsJson = JSON.stringify({ type: 'service_account' });
    setEnv({
      'TELEGRAM_BOT_TOKEN': 'token',
      'GOOGLE_SHEET_ID': 'id',
      'GOOGLE_CREDENTIALS_JSON': credentialsJson,
      'SUPABASE_URL': 'https://test.supabase.co',
      'SUPABASE_SERVICE_KEY': 'key',
      'ALERT_HOURS_WARNING': undefined,
      'ALERT_HOURS_URGENT': undefined,
      'MIN_WORKSHOP_MINUTES': undefined,
    });

    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    assert.equal(config.alerts.warningHours, 24);
    assert.equal(config.alerts.urgentHours, 48);
    assert.equal(config.alerts.minWorkshopMinutes, 3);
  });
});

// ──────────────────────────────────────────────
// Test: manager chat IDs parsing
// ──────────────────────────────────────────────

describe('config manager chat IDs', () => {
  beforeEach(() => {
    delete require.cache[require.resolve('../src/config')];
  });

  afterEach(() => {
    resetEnv();
    delete require.cache[require.resolve('../src/config')];
  });

  it('should parse comma-separated chat IDs', () => {
    const credentialsJson = JSON.stringify({ type: 'service_account' });
    setEnv({
      'TELEGRAM_BOT_TOKEN': 'token',
      'GOOGLE_SHEET_ID': 'id',
      'GOOGLE_CREDENTIALS_JSON': credentialsJson,
      'SUPABASE_URL': 'https://test.supabase.co',
      'SUPABASE_SERVICE_KEY': 'key',
      'MANAGER_CHAT_IDS': '123,456, 789 ',
    });

    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    assert.deepEqual(config.manager.chatIds, ['123', '456', '789']);
  });

  it('should handle empty manager chat IDs', () => {
    const credentialsJson = JSON.stringify({ type: 'service_account' });
    setEnv({
      'TELEGRAM_BOT_TOKEN': 'token',
      'GOOGLE_SHEET_ID': 'id',
      'GOOGLE_CREDENTIALS_JSON': credentialsJson,
      'SUPABASE_URL': 'https://test.supabase.co',
      'SUPABASE_SERVICE_KEY': 'key',
      'MANAGER_CHAT_IDS': '',
    });

    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    assert.deepEqual(config.manager.chatIds, []);
  });

  it('should parse daily report hour', () => {
    const credentialsJson = JSON.stringify({ type: 'service_account' });
    setEnv({
      'TELEGRAM_BOT_TOKEN': 'token',
      'GOOGLE_SHEET_ID': 'id',
      'GOOGLE_CREDENTIALS_JSON': credentialsJson,
      'SUPABASE_URL': 'https://test.supabase.co',
      'SUPABASE_SERVICE_KEY': 'key',
      'DAILY_REPORT_HOUR': '22',
    });

    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    assert.equal(config.manager.dailyReportHour, 22);
  });
});

// ──────────────────────────────────────────────
// Test: OCR confidence thresholds
// ──────────────────────────────────────────────

describe('config OCR thresholds', () => {
  beforeEach(() => {
    delete require.cache[require.resolve('../src/config')];
  });

  afterEach(() => {
    resetEnv();
    delete require.cache[require.resolve('../src/config')];
  });

  it('should parse OCR confidence thresholds', () => {
    const credentialsJson = JSON.stringify({ type: 'service_account' });
    setEnv({
      'TELEGRAM_BOT_TOKEN': 'token',
      'GOOGLE_SHEET_ID': 'id',
      'GOOGLE_CREDENTIALS_JSON': credentialsJson,
      'SUPABASE_URL': 'https://test.supabase.co',
      'SUPABASE_SERVICE_KEY': 'key',
      'OCR_CONFIDENCE_HIGH': '0.9',
      'OCR_CONFIDENCE_MEDIUM': '0.6',
    });

    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    assert.equal(config.ocr.confidenceHigh, 0.9);
    assert.equal(config.ocr.confidenceMedium, 0.6);
  });

  it('should use default OCR confidence if not set', () => {
    const credentialsJson = JSON.stringify({ type: 'service_account' });
    setEnv({
      'TELEGRAM_BOT_TOKEN': 'token',
      'GOOGLE_SHEET_ID': 'id',
      'GOOGLE_CREDENTIALS_JSON': credentialsJson,
      'SUPABASE_URL': 'https://test.supabase.co',
      'SUPABASE_SERVICE_KEY': 'key',
      'OCR_CONFIDENCE_HIGH': undefined,
      'OCR_CONFIDENCE_MEDIUM': undefined,
    });

    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    assert.equal(config.ocr.confidenceHigh, 0.8);
    assert.equal(config.ocr.confidenceMedium, 0.5);
  });
});

// ──────────────────────────────────────────────
// Test: Sheet tab names
// ──────────────────────────────────────────────

describe('config sheet tab names', () => {
  beforeEach(() => {
    delete require.cache[require.resolve('../src/config')];
  });

  afterEach(() => {
    resetEnv();
    delete require.cache[require.resolve('../src/config')];
  });

  it('should use default sheet tab names', () => {
    const credentialsJson = JSON.stringify({ type: 'service_account' });
    setEnv({
      'TELEGRAM_BOT_TOKEN': 'token',
      'GOOGLE_SHEET_ID': 'id',
      'GOOGLE_CREDENTIALS_JSON': credentialsJson,
      'SUPABASE_URL': 'https://test.supabase.co',
      'SUPABASE_SERVICE_KEY': 'key',
    });

    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    assert.equal(config.sheets.tabNames.main, 'ĐANG TRONG XƯỞNG');
    assert.equal(config.sheets.tabNames.log, 'NHẬT KÝ');
    assert.equal(config.sheets.tabNames.review, 'CẦN KIỂM TRA');
  });

  it('should use custom sheet tab names', () => {
    const credentialsJson = JSON.stringify({ type: 'service_account' });
    setEnv({
      'TELEGRAM_BOT_TOKEN': 'token',
      'GOOGLE_SHEET_ID': 'id',
      'GOOGLE_CREDENTIALS_JSON': credentialsJson,
      'SUPABASE_URL': 'https://test.supabase.co',
      'SUPABASE_SERVICE_KEY': 'key',
      'SHEET_TAB_MAIN': 'MAIN',
      'SHEET_TAB_LOG': 'LOG',
      'SHEET_TAB_REVIEW': 'REVIEW',
    });

    const { loadConfig } = require('../src/config');
    const config = loadConfig();

    assert.equal(config.sheets.tabNames.main, 'MAIN');
    assert.equal(config.sheets.tabNames.log, 'LOG');
    assert.equal(config.sheets.tabNames.review, 'REVIEW');
  });
});
