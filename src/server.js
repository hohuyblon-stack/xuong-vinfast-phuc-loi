'use strict';

require('dotenv/config');

const express = require('express');
const { loadConfig } = require('./config');
const { initOcr, recognizePlate } = require('./ocr');
const { initSheets, isMessageProcessed } = require('./sheets');
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

  // Init Google Sheets
  await initSheets(config.sheets);

  // Init OCR
  initOcr(config.ocr.credentials);

  // Init Zalo OA
  initZalo(config.zalo.accessToken);

  // Start Express
  const app = express();
  app.use(express.json());

  // ──── Routes ────

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'xuong-vinfast-phuc-loi', time: new Date().toISOString() });
  });

  // Zalo webhook (POST)
  app.post('/webhook/zalo', async (req, res) => {
    try {
      // Tra 200 ngay de Zalo khong retry
      res.json({ ok: true });

      const data = extractUpdate(req.body);
      if (!data) return;

      logger.info('Zalo message received', {
        messageId: data.messageId,
        chatId: data.chatId,
        text: data.text,
        hasImage: !!data.imageUrl,
        sender: data.senderName,
      });

      // Idempotency check
      const msgKey = `${data.chatId}_${data.messageId}`;
      const processed = await isMessageProcessed(msgKey);
      if (processed) {
        logger.info('Duplicate message, skipping', { messageId: msgKey });
        return;
      }

      // Process async
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

  // Zalo webhook verification (GET) - Zalo gọi khi setup webhook
  app.get('/webhook/zalo', (req, res) => {
    res.status(200).send('OK');
  });

  // Admin: trigger alert check
  app.post('/admin/check-alerts', async (_req, res) => {
    try {
      const updated = await checkTimeAlerts(config);
      res.json({ status: 'ok', updatedCount: updated });
    } catch (err) {
      logger.error('Alert check failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: trigger daily report
  app.post('/admin/daily-report', async (_req, res) => {
    try {
      const report = await handleDailyReport(config);
      res.json({ status: 'ok', report: report.replyMessage });
    } catch (err) {
      logger.error('Daily report failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Start server
  const port = config.port;
  app.listen(port, async () => {
    logger.info(`Server started on port ${port}`);
    logger.info('Xuong VinFast Phuc Loi - He thong theo doi xe vao/ra (Zalo OA)');
    logger.info('Webhook URL: POST /webhook/zalo');

    if (config.manager.chatIds.length > 0) {
      logger.info(`Manager chat IDs configured: ${config.manager.chatIds.length}`);
    }
  });

  // Check alerts moi 30 phut
  setInterval(async () => {
    try {
      const updated = await checkTimeAlerts(config);
      if (updated > 0) {
        logger.info(`Alert check: ${updated} vehicles updated`);
      }
    } catch (err) {
      logger.error('Periodic alert check failed', { error: err.message });
    }
  }, 30 * 60 * 1000);

  // Bao cao tu dong cuoi ngay
  scheduleDailyReport();
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

  // Tra loi
  if (result.replyMessage) {
    await sendMessage(chatId, result.replyMessage);
  }

  // Check alerts sau moi event
  await checkTimeAlerts(config).catch(err => {
    logger.error('Post-event alert check failed', { error: err.message });
  });
}

// ──────────────────────────────────────────────
// Scheduled daily report
// ──────────────────────────────────────────────

function scheduleDailyReport() {
  const reportHour = config.manager.dailyReportHour;
  const chatIds = config.manager.chatIds;

  if (chatIds.length === 0) {
    logger.info('No manager chat IDs configured - daily report disabled');
    return;
  }

  let lastReportDate = '';
  setInterval(async () => {
    const { DateTime } = require('luxon');
    const now = DateTime.now().setZone(config.timezone);
    const todayStr = now.toFormat('yyyy-MM-dd');
    const currentHour = now.hour;

    if (currentHour === reportHour && lastReportDate !== todayStr) {
      lastReportDate = todayStr;
      try {
        await sendScheduledDailyReport(config);
      } catch (err) {
        logger.error('Scheduled daily report failed', { error: err.message });
      }
    }
  }, 60 * 1000);

  logger.info(`Daily report scheduled at ${reportHour}:00`);
}

// ──────────────────────────────────────────────
// Run
// ──────────────────────────────────────────────

bootstrap().catch(err => {
  logger.error('Bootstrap failed', { error: err.message, stack: err.stack });
  process.exit(1);
});
