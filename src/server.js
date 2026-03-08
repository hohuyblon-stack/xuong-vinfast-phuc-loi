'use strict';

require('dotenv/config');

const express = require('express');
const { loadConfig } = require('./config');
const { initOcr, recognizePlate } = require('./ocr');
const { initSheets } = require('./sheets');
const { initDb, isMessageProcessed } = require('./db');
const { initTelegram, extractUpdate, getFileUrl, sendMessage, setWebhook } = require('./telegram');
const {
  processVehicleEvent,
  checkTimeAlerts,
  handleTonKho,
  handleHelp,
  handleDailyReport,
  sendScheduledDailyReport,
  handleProductivityReport,
  handleAccountingReport,
} = require('./matcher');
const { parseMessage, TEXT_ONLY_ACTIONS } = require('./utils');
const logger = require('./logger');

// ──────────────────────────────────────────────
// Bootstrap
// ──────────────────────────────────────────────

let config;

async function bootstrap() {
  config = loadConfig();

  // Init Supabase (source of truth)
  initDb(config);

  // Init Google Sheets (async mirror)
  await initSheets(config.sheets);

  // Init OCR
  initOcr(config.ocr.credentials);

  // Init Telegram Bot
  initTelegram(config.telegram.botToken);

  // Start Express
  const app = express();
  app.use(express.json());

  // ──── Routes ────

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'xuong-vinfast-phuc-loi', time: new Date().toISOString() });
  });

  // Telegram webhook (POST)
  app.post('/webhook/telegram', async (req, res) => {
    try {
      // Tra 200 ngay de Telegram khong retry
      res.json({ ok: true });

      const data = extractUpdate(req.body);
      if (!data) return;

      logger.info('Telegram message received', {
        messageId: data.messageId,
        chatId: data.chatId,
        text: data.text,
        hasImage: !!data.imageFileId,
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
    logger.info('Xuong VinFast Phuc Loi - He thong theo doi xe vao/ra (Telegram Bot)');
    logger.info('Webhook URL: POST /webhook/telegram');

    // Tu dong set webhook neu co TELEGRAM_WEBHOOK_URL
    if (config.telegram.webhookUrl) {
      try {
        const webhookFullUrl = `${config.telegram.webhookUrl}/webhook/telegram`;
        await setWebhook(webhookFullUrl);
        logger.info(`Telegram webhook set: ${webhookFullUrl}`);
      } catch (err) {
        logger.error('Failed to set Telegram webhook', { error: err.message });
      }
    }

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
  const { messageId, chatId, senderId, senderName, text, imageFileId, documentFileId, documentName } = data;

  // ═══ FILE EXCEL TU PHONG KE TOAN ═══
  if (documentFileId) {
    await sendMessage(chatId, `⏳ Đang xử lý file: ${documentName}\nVui lòng chờ một chút...`);
    try {
      const fileUrl = await getFileUrl(documentFileId);
      const result = await handleAccountingReport(fileUrl, config);
      for (const msg of result.messages) {
        await sendMessage(chatId, msg);
      }
    } catch (err) {
      logger.error('Accounting report failed', { error: err.message, stack: err.stack });
      await sendMessage(chatId, '❌ Có lỗi khi xử lý file Excel. Vui lòng thử lại nhé.');
    }
    return;
  }

  // ═══ TEXT-ONLY COMMANDS (TONKHO, HELP) ═══
  const parsed = parseMessage(text);
  if (parsed.action && TEXT_ONLY_ACTIONS.includes(parsed.action)) {
    let result;
    if (parsed.action === 'TONKHO') result = await handleTonKho(config);
    else if (parsed.action === 'HELP') result = handleHelp();
    else if (parsed.action === 'BAOCAO') result = await handleDailyReport(config);
    else if (parsed.action === 'NANGSUAT') result = await handleProductivityReport(config);

    if (result && result.replyMessage) {
      await sendMessage(chatId, result.replyMessage);
    }
    return;
  }

  // ═══ XU LY ANH BIEN SO ═══

  if (!imageFileId) {
    await sendMessage(
      chatId,
      'Chụp ảnh biển số xe và gửi vào đây nhé.\n' +
      'Hệ thống sẽ tự động ghi xe vào hoặc ra xưởng.\n\n' +
      'Gõ HELP để xem hướng dẫn.'
    );
    return;
  }

  // Tai anh tu Telegram
  let imageUrl;
  try {
    imageUrl = await getFileUrl(imageFileId);
  } catch (err) {
    logger.error('Failed to get Telegram file URL', { error: err.message });
    await sendMessage(chatId, 'Khong tai duoc anh. Vui long gui lai.');
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

  // Xu ly nghiep vu - tu dong xac dinh VAO/RA
  const msgKey = `${chatId}_${messageId}`;
  const result = await processVehicleEvent({
    messageId: msgKey,
    senderId,
    senderName,
    text: '',
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
