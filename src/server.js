'use strict';

require('dotenv/config');

const express = require('express');
const cron = require('node-cron');
const { loadConfig } = require('./config');
const { initOcr, recognizePlate } = require('./ocr');
const { initSheets, isMessageProcessed } = require('./db');
const { initZalo, extractUpdate, sendMessage } = require('./zalo');
const {
  processVehicleEvent,
  checkTimeAlerts,
  handleTonKho,
  handleGhiChu,
  handleHelp,
  handleDailyReport,
  sendScheduledDailyReport,
} = require('./matcher');
const { parseMessage, TEXT_ONLY_ACTIONS } = require('./utils');
const logger = require('./logger');

// ──────────────────────────────────────────────
// Bootstrap
// ──────────────────────────────────────────────

let config;

async function bootstrap() {
  config = loadConfig();

  // Init SQLite (thay Google Sheets)
  await initSheets(config.db);

  // Init Tesseract OCR (local, async)
  await initOcr();

  // Init Zalo OA
  initZalo(config.zalo.accessToken);

  // Start Express
  const app = express();
  app.use(express.json());

  // ──── Routes ────

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'xuong-vinfast-phuc-loi', time: new Date().toISOString() });
  });

  app.post('/webhook/zalo', async (req, res) => {
    try {
      // Tra 200 ngay de Zalo khong retry
      res.json({ ok: true });

      const data = extractUpdate(req.body);
      if (!data) return;

      logger.info('Zalo message received', {
        messageId: data.messageId,
        chatId:    data.chatId,
        text:      data.text,
        hasImage:  !!data.imageUrl,
        sender:    data.senderName,
      });

      // Idempotency check (in-memory + DB fallback)
      const msgKey = `${data.chatId}_${data.messageId}`;
      const processed = await isMessageProcessed(msgKey);
      if (processed) {
        logger.info('Duplicate message, skipping', { messageId: msgKey });
        return;
      }

      processMessageAsync(data).catch(err => {
        logger.error('Async processing failed', { error: err.message, stack: err.stack });
      });

    } catch (err) {
      logger.error('Webhook handler error', { error: err.message, stack: err.stack });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal error' });
      }
    }
  });

  app.get('/webhook/zalo', (_req, res) => res.status(200).send('OK'));

  app.post('/admin/check-alerts', async (_req, res) => {
    try {
      const updated = await checkTimeAlerts(config);
      res.json({ status: 'ok', updatedCount: updated });
    } catch (err) {
      logger.error('Alert check failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/admin/daily-report', async (_req, res) => {
    try {
      const report = await handleDailyReport(config);
      res.json({ status: 'ok', report: report.replyMessage });
    } catch (err) {
      logger.error('Daily report failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  const port = config.port;
  app.listen(port, () => {
    logger.info(`Server started on port ${port}`);
    logger.info('Xuong VinFast Phuc Loi - He thong theo doi xe vao/ra (Zalo OA)');

    if (config.manager.chatIds.length > 0) {
      logger.info(`Manager chat IDs configured: ${config.manager.chatIds.length}`);
    }
  });

  // ──── Cron jobs (thay setInterval) ────
  scheduleJobs();
}

// ──────────────────────────────────────────────
// Cron scheduling
// ──────────────────────────────────────────────

function scheduleJobs() {
  const tz = config.timezone;

  // Kiem tra canh bao moi 30 phut
  cron.schedule('*/30 * * * *', async () => {
    try {
      const updated = await checkTimeAlerts(config);
      if (updated > 0) {
        logger.info(`Alert check: ${updated} vehicles updated`);
      }
    } catch (err) {
      logger.error('Periodic alert check failed', { error: err.message });
    }
  }, { timezone: tz });

  // Bao cao cuoi ngay theo gio cau hinh
  const reportHour = config.manager.dailyReportHour;

  if (config.manager.chatIds.length === 0) {
    logger.info('No manager chat IDs configured - daily report disabled');
    return;
  }

  cron.schedule(`0 ${reportHour} * * *`, async () => {
    try {
      await sendScheduledDailyReport(config);
    } catch (err) {
      logger.error('Scheduled daily report failed', { error: err.message });
    }
  }, { timezone: tz });

  logger.info(`Cron jobs scheduled (tz: ${tz}): alerts every 30min, daily report at ${reportHour}:00`);
}

// ──────────────────────────────────────────────
// Async message processing
// ──────────────────────────────────────────────

async function processMessageAsync(data) {
  const { messageId, chatId, senderId, senderName, text, imageUrl } = data;

  const parsed = parseMessage(text);

  // ═══ TEXT-ONLY COMMANDS ═══
  if (parsed.action && TEXT_ONLY_ACTIONS.includes(parsed.action)) {
    let result;

    switch (parsed.action) {
      case 'TONKHO':
        result = await handleTonKho(config);
        break;
      case 'GHICHU':
        result = await handleGhiChu(parsed.params, config);
        break;
      case 'HELP':
        result = handleHelp();
        break;
    }

    if (result && result.replyMessage) {
      await sendMessage(chatId, result.replyMessage);
    }
    return;
  }

  // ═══ IMAGE-BASED COMMANDS (VAO/RA) ═══

  if (!imageUrl) {
    await sendMessage(
      chatId,
      'De ghi nhan xe, gui:\n' +
      '1. Anh chup bien so xe\n' +
      '2. Kem noi dung: VAO hoac RA\n\n' +
      'Go HELP de xem tat ca lenh.'
    );
    return;
  }

  // OCR bien so
  let ocrResult;
  try {
    ocrResult = await recognizePlate(imageUrl);
  } catch (err) {
    logger.error('OCR failed', { error: err.message });
    ocrResult = { plateText: '', confidence: 0, rawTexts: [] };
  }

  // Xu ly nghiep vu
  const msgKey = `${chatId}_${messageId}`;
  const result = await processVehicleEvent({
    messageId: msgKey,
    senderId,
    senderName,
    text,
    imageUrl,
    ocrResult,
  }, config);

  if (result.replyMessage) {
    await sendMessage(chatId, result.replyMessage);
  }

  // Check alerts sau moi event
  await checkTimeAlerts(config).catch(err => {
    logger.error('Post-event alert check failed', { error: err.message });
  });
}

// ──────────────────────────────────────────────
// Run
// ──────────────────────────────────────────────

bootstrap().catch(err => {
  logger.error('Bootstrap failed', { error: err.message, stack: err.stack });
  process.exit(1);
});
