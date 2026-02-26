'use strict';

require('dotenv/config');

const express = require('express');
const { loadConfig } = require('./config');
const { initOcr, recognizePlate } = require('./ocr');
const { initSheets, archiveOldVehicles } = require('./sheets');
const { initTelegram, extractUpdate, getFileUrl, sendMessage, setWebhook } = require('./telegram');
const { processVehicleEvent } = require('./matcher');
const { isMessageProcessed } = require('./sheets');
const logger = require('./logger');

// ──────────────────────────────────────────────
// Bootstrap
// ──────────────────────────────────────────────

let config;

async function bootstrap() {
  config = loadConfig();

  await initSheets(config.sheets);
  initOcr(config.ocr.credentials);
  initTelegram(config.telegram.botToken);

  const app = express();
  app.use(express.json());

  // ──── Routes ────

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'xuong-vinfast-phuc-loi', time: new Date().toISOString() });
  });

  // Telegram webhook
  app.post('/webhook/telegram', async (req, res) => {
    try {
      res.json({ ok: true });

      const data = extractUpdate(req.body);
      if (!data) return;

      logger.info('Telegram message received', {
        messageId: data.messageId,
        chatId: data.chatId,
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

  // Start server
  const port = config.port;
  app.listen(port, async () => {
    logger.info(`Server started on port ${port}`);
    logger.info('Xuong VinFast Phuc Loi - Ghi nhan xe vao/ra (Telegram Bot)');

    if (config.telegram.webhookUrl) {
      try {
        const webhookFullUrl = `${config.telegram.webhookUrl}/webhook/telegram`;
        await setWebhook(webhookFullUrl);
        logger.info(`Telegram webhook set: ${webhookFullUrl}`);
      } catch (err) {
        logger.error('Failed to set Telegram webhook', { error: err.message });
      }
    }
  });

  // Tu dong luu tru: moi 30 phut kiem tra xe da RA > 24h → chuyen sang LUU TRU
  setInterval(async () => {
    try {
      const archived = await archiveOldVehicles(config.archive.afterHours, config.timezone);
      if (archived > 0) {
        logger.info(`Auto-archived ${archived} vehicles`);
      }
    } catch (err) {
      logger.error('Auto-archive failed', { error: err.message });
    }
  }, 30 * 60 * 1000);
}

// ──────────────────────────────────────────────
// Xu ly tin nhan - CHI XU LY ANH
// ──────────────────────────────────────────────

async function processMessageAsync(data) {
  const { messageId, chatId, senderId, senderName, imageFileId } = data;

  // Khong co anh → nhac gui anh
  if (!imageFileId) {
    await sendMessage(chatId, 'Vui long chup anh bien so xe va gui vao day.');
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

  // Tu dong xac dinh VAO/RA
  const msgKey = `${chatId}_${messageId}`;
  const result = await processVehicleEvent({
    messageId: msgKey,
    senderId,
    senderName,
    imageUrl,
    ocrResult,
  }, config);

  if (result.replyMessage) {
    await sendMessage(chatId, result.replyMessage);
  }
}

// ──────────────────────────────────────────────
// Run
// ──────────────────────────────────────────────

bootstrap().catch(err => {
  logger.error('Bootstrap failed', { error: err.message, stack: err.stack });
  process.exit(1);
});
