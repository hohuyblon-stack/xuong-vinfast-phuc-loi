'use strict';

require('dotenv/config');

const express = require('express');
const { loadConfig } = require('./config');
const { initOcr, recognizePlate } = require('./ocr');
const { initSheets, isMessageProcessed } = require('./sheets');
const { verifyWebhookSignature, extractWebhookData, sendReply } = require('./zalo');
const {
  processVehicleEvent,
  checkTimeAlerts,
  handleLookup,
  handleProgressUpdate,
  handleCustomerRegister,
  handleDailyReport,
  handleHelp,
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

  // Start Express
  const app = express();

  // Raw body cho signature verification
  app.use('/webhook/zalo', express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString('utf-8');
    },
  }));

  app.use(express.json());

  // ──── Routes ────

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'xuong-vinfast-phuc-loi', time: new Date().toISOString() });
  });

  // Zalo OA webhook verification (GET)
  app.get('/webhook/zalo', (req, res) => {
    // Zalo gửi GET để verify webhook URL
    const challenge = req.query.challenge;
    if (challenge) {
      logger.info('Zalo webhook verification', { challenge });
      return res.send(challenge);
    }
    res.json({ status: 'webhook ready' });
  });

  // Zalo OA webhook (POST) - Main entry point
  app.post('/webhook/zalo', async (req, res) => {
    try {
      // 1. Verify signature
      const signature = req.headers['x-zevent-signature'] || '';
      if (config.zalo.secretKey && signature) {
        const valid = verifyWebhookSignature(req.rawBody, signature, config.zalo.secretKey);
        if (!valid) {
          logger.warn('Invalid webhook signature');
          return res.status(403).json({ error: 'Invalid signature' });
        }
      }

      // 2. Extract data
      const data = extractWebhookData(req.body);
      if (!data) {
        return res.json({ status: 'ignored' });
      }

      logger.info('Webhook received', {
        messageId: data.messageId,
        senderId: data.senderId,
        text: data.text,
        hasImage: !!data.imageUrl,
      });

      // 3. Idempotency: check duplicate message
      if (data.messageId) {
        const processed = await isMessageProcessed(data.messageId);
        if (processed) {
          logger.info('Duplicate message, skipping', { messageId: data.messageId });
          return res.json({ status: 'duplicate' });
        }
      }

      // 4. Respond 200 immediately (Zalo timeout = 5s)
      res.json({ status: 'received' });

      // 5. Process async (sau khi đã trả 200)
      processWebhookAsync(data).catch(err => {
        logger.error('Async processing failed', { error: err.message, stack: err.stack });
      });

    } catch (err) {
      logger.error('Webhook handler error', { error: err.message, stack: err.stack });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal error' });
      }
    }
  });

  // Trigger alert check manually
  app.post('/admin/check-alerts', async (_req, res) => {
    try {
      const updated = await checkTimeAlerts(config);
      res.json({ status: 'ok', updatedCount: updated });
    } catch (err) {
      logger.error('Alert check failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Trigger daily report manually
  app.post('/admin/daily-report', async (_req, res) => {
    try {
      const report = await handleDailyReport(null, config);
      res.json({ status: 'ok', report: report.replyMessage });
    } catch (err) {
      logger.error('Daily report failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Start server
  const port = config.port;
  app.listen(port, () => {
    logger.info(`Server started on port ${port}`);
    logger.info('Xưởng VinFast Phúc Lợi - Hệ thống theo dõi xe vào/ra');
    logger.info('Webhook URL: POST /webhook/zalo');
    if (config.manager.zaloIds.length > 0) {
      logger.info(`Manager Zalo IDs configured: ${config.manager.zaloIds.length}`);
    }
  });

  // Chạy check alerts mỗi 30 phút
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

  // Báo cáo tự động cuối ngày
  scheduleDailyReport();
}

// ──────────────────────────────────────────────
// Async webhook processing
// ──────────────────────────────────────────────

async function processWebhookAsync(data) {
  const { messageId, senderId, text, imageUrl } = data;

  // Parse tin nhắn trước để xác định action
  const parsed = parseMessage(text);

  // ═══════════ TEXT-ONLY COMMANDS (không cần ảnh) ═══════════
  if (parsed.action && TEXT_ONLY_ACTIONS.includes(parsed.action)) {
    let result;

    switch (parsed.action) {
      case 'TRACUU':
        result = await handleLookup(parsed.params, senderId, config);
        break;
      case 'CAPNHAT':
        result = await handleProgressUpdate(parsed.params, senderId, config);
        break;
      case 'DANGKY':
        result = await handleCustomerRegister(parsed.params, senderId, config);
        break;
      case 'BAOCAO':
        result = await handleDailyReport(senderId, config);
        break;
      case 'HUONGDAN':
        result = handleHelp();
        break;
    }

    if (result && result.replyMessage) {
      await sendReply(senderId, result.replyMessage, config.zalo.accessToken);
    }
    return;
  }

  // ═══════════ IMAGE-BASED COMMANDS (VAO/RA - cần ảnh) ═══════════

  // Kiểm tra: phải có ảnh
  if (!imageUrl) {
    // Gửi hướng dẫn
    await sendReply(
      senderId,
      '📋 Để ghi nhận xe, vui lòng gửi:\n' +
      '1. Ảnh chụp biển số xe\n' +
      '2. Kèm nội dung: VAO hoặc RA\n\n' +
      'Ví dụ: Gửi ảnh + text "VAO" hoặc "RA"\n' +
      'Mở rộng: "VAO | xe tải" hoặc "RA | xe con"\n\n' +
      'Gõ HUONGDAN để xem tất cả lệnh.',
      config.zalo.accessToken
    );
    return;
  }

  // OCR biển số
  let ocrResult;
  try {
    ocrResult = await recognizePlate(imageUrl);
  } catch (err) {
    logger.error('OCR failed', { error: err.message });
    ocrResult = { plateText: '', confidence: 0, rawTexts: [] };
  }

  // Xử lý nghiệp vụ
  const result = await processVehicleEvent({
    messageId,
    senderId,
    text,
    imageUrl,
    ocrResult,
  }, config);

  // Trả lời Zalo
  if (result.replyMessage) {
    await sendReply(senderId, result.replyMessage, config.zalo.accessToken);
  }

  // Sau mỗi event, check alerts
  await checkTimeAlerts(config).catch(err => {
    logger.error('Post-event alert check failed', { error: err.message });
  });
}

// ──────────────────────────────────────────────
// Scheduled daily report
// ──────────────────────────────────────────────

function scheduleDailyReport() {
  const reportHour = config.manager.dailyReportHour;
  const managerIds = config.manager.zaloIds;

  if (managerIds.length === 0) {
    logger.info('No manager Zalo IDs configured - daily report disabled');
    return;
  }

  // Check mỗi phút xem đã đến giờ gửi báo cáo chưa
  let lastReportDate = '';
  setInterval(async () => {
    const { DateTime } = require('luxon');
    const now = DateTime.now().setZone(config.timezone);
    const todayStr = now.toFormat('yyyy-MM-dd');
    const currentHour = now.hour;

    // Gửi báo cáo 1 lần/ngày vào đúng giờ cấu hình
    if (currentHour === reportHour && lastReportDate !== todayStr) {
      lastReportDate = todayStr;
      try {
        await sendScheduledDailyReport(config);
      } catch (err) {
        logger.error('Scheduled daily report failed', { error: err.message });
      }
    }
  }, 60 * 1000); // Check mỗi 60 giây

  logger.info(`Daily report scheduled at ${reportHour}:00`);
}

// ──────────────────────────────────────────────
// Run
// ──────────────────────────────────────────────

bootstrap().catch(err => {
  logger.error('Bootstrap failed', { error: err.message, stack: err.stack });
  process.exit(1);
});
