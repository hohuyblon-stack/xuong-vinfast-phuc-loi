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
  handleTonKho,
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

      logger.info('Nhan tin nhan Telegram', {
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
        logger.info('Tin nhan trung, bo qua', { messageId: msgKey });
        return;
      }

      // Process async
      processMessageAsync(data).catch(err => {
        logger.error('Xu ly bat dong bo that bai', { error: err.message, stack: err.stack });
      });

    } catch (err) {
      logger.error('Loi xu ly webhook', { error: err.message, stack: err.stack });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Loi he thong' });
      }
    }
  });

  // Admin: trigger alert check
  app.post('/admin/check-alerts', async (_req, res) => {
    try {
      const updated = await checkTimeAlerts(config);
      res.json({ status: 'ok', updatedCount: updated });
    } catch (err) {
      logger.error('Kiem tra canh bao that bai', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: trigger daily report
  app.post('/admin/daily-report', async (_req, res) => {
    try {
      const report = await handleDailyReport(config);
      res.json({ status: 'ok', report: report.replyMessage });
    } catch (err) {
      logger.error('Bao cao ngay that bai', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Start server
  const port = config.port;
  app.listen(port, async () => {
    logger.info(`May chu da khoi dong tren cong ${port}`);
    logger.info('Xuong VinFast Phuc Loi - He thong theo doi xe vao/ra (Telegram Bot)');
    logger.info('Duong dan webhook: POST /webhook/telegram');

    // Tu dong set webhook neu co TELEGRAM_WEBHOOK_URL
    if (config.telegram.webhookUrl) {
      try {
        const webhookFullUrl = `${config.telegram.webhookUrl}/webhook/telegram`;
        await setWebhook(webhookFullUrl);
        logger.info(`Da thiet lap webhook Telegram: ${webhookFullUrl}`);
      } catch (err) {
        logger.error('Thiet lap webhook Telegram that bai', { error: err.message });
      }
    }

    if (config.manager.chatIds.length > 0) {
      logger.info(`Da cau hinh ${config.manager.chatIds.length} ID quan ly`);
    }
  });

  // Check alerts moi 30 phut
  setInterval(async () => {
    try {
      const updated = await checkTimeAlerts(config);
      if (updated > 0) {
        logger.info(`Kiem tra canh bao: cap nhat ${updated} xe`);
      }
    } catch (err) {
      logger.error('Kiem tra canh bao dinh ky that bai', { error: err.message });
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

  // ═══ TEXT-ONLY COMMANDS (TONKHO, HELP) ═══
  const parsed = parseMessage(text);
  if (parsed.action && TEXT_ONLY_ACTIONS.includes(parsed.action)) {
    let result;
    if (parsed.action === 'TONKHO') result = await handleTonKho(config);
    else if (parsed.action === 'HELP') result = handleHelp();

    if (result && result.replyMessage) {
      await sendMessage(chatId, result.replyMessage);
    }
    return;
  }

  // ═══ XU LY ANH BIEN SO ═══

  if (!imageFileId) {
    await sendMessage(
      chatId,
      'Chup anh bien so xe va gui vao day.\n' +
      'He thong se tu dong ghi VAO hoac RA.\n\n' +
      'Go HELP de xem huong dan.'
    );
    return;
  }

  // Tai anh tu Telegram
  let imageUrl;
  try {
    imageUrl = await getFileUrl(imageFileId);
  } catch (err) {
    logger.error('Khong lay duoc URL file Telegram', { error: err.message });
    await sendMessage(chatId, 'Khong tai duoc anh. Vui long gui lai.');
    return;
  }

  // OCR bien so
  let ocrResult;
  try {
    ocrResult = await recognizePlate(imageUrl);
  } catch (err) {
    logger.error('OCR that bai', { error: err.message });
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
    logger.error('Kiem tra canh bao sau su kien that bai', { error: err.message });
  });
}

// ──────────────────────────────────────────────
// Scheduled daily report
// ──────────────────────────────────────────────

function scheduleDailyReport() {
  const reportHour = config.manager.dailyReportHour;
  const chatIds = config.manager.chatIds;

  if (chatIds.length === 0) {
    logger.info('Chua cau hinh ID quan ly - tat bao cao tu dong cuoi ngay');
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
        logger.error('Bao cao tu dong cuoi ngay that bai', { error: err.message });
      }
    }
  }, 60 * 1000);

  logger.info(`Da lich bao cao cuoi ngay luc ${reportHour}:00`);
}

// ──────────────────────────────────────────────
// Run
// ──────────────────────────────────────────────

bootstrap().catch(err => {
  logger.error('Khoi dong he thong that bai', { error: err.message, stack: err.stack });
  process.exit(1);
});
