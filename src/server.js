'use strict';

require('dotenv/config');

const express = require('express');
const { loadConfig } = require('./config');
const { initOcr, recognizePlate } = require('./ocr');
const { initSheets, isMessageProcessed } = require('./sheets');
const { initTelegram, extractUpdate, getFileUrl, sendMessage, setWebhook } = require('./telegram');
const {
  processVehicleEvent,
  checkTimeAlerts,
  handleDailyReport,
  sendScheduledDailyReport,
} = require('./matcher');
const logger = require('./logger');

// ──────────────────────────────────────────────
// Bootstrap
// ──────────────────────────────────────────────

let config;

async function bootstrap() {
  config = loadConfig();

  // Init Google Sheets
  try {
    await initSheets(config.sheets);
  } catch (err) {
    logger.error('Google Sheets init failed - server will start but sheets features are unavailable', {
      error: err.message,
    });
  }

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
      processMessageAsync(data).catch(async (err) => {
        logger.error('Async processing failed', { error: err.message, stack: err.stack });
        try {
          await sendMessage(data.chatId, 'He thong gap loi khi xu ly. Vui long thu lai sau.');
        } catch (_) {
          // Ignore send error
        }
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
  const { messageId, chatId, senderId, senderName, text, imageFileId } = data;

  // ═══ CHI XU LY ANH - BO QUA TIN NHAN CHU ═══

  if (!imageFileId) {
    await sendMessage(
      chatId,
      'Vui long gui anh chup bien so xe.\n' +
      'He thong chi nhan anh, tu dong ghi nhan xe VAO hoac RA.'
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

  // Start a minimal server so Render health checks pass and we can diagnose
  const app = express();
  app.get('/health', (_req, res) => {
    res.status(503).json({
      status: 'error',
      service: 'xuong-vinfast-phuc-loi',
      error: 'Bootstrap failed: ' + err.message,
      time: new Date().toISOString(),
    });
  });
  const port = parseInt(process.env.PORT || '3000', 10);
  app.listen(port, () => {
    logger.info(`Fallback server started on port ${port} (bootstrap failed)`);
  });
});
