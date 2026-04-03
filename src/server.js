'use strict';

require('dotenv/config');

const express = require('express');
const { loadConfig } = require('./config');
const { initOcr, recognizePlate } = require('./ocr');
const { initSheets } = require('./sheets');
const { initDb, testConnection, isMessageProcessed, expireStaleVehicles, autoCloseVehicles, forceExitVehicle, countInWorkshop } = require('./db');
const { initTelegram, extractUpdate, getFileUrl, sendMessage, setWebhook, getWebhookInfo } = require('./telegram');
const {
  processVehicleEvent,
  checkTimeAlerts,
  handleTonKho,
  handleHelp,
  handleDailyReport,
  sendScheduledDailyReport,
  handleProductivityReport,
  handleAccountingReport,
  handleFullReport,
  sendScheduledFullReport,
  handleMorningBriefing,
  sendScheduledMorningBriefing,
  handleManualExit,
  sendEndOfDayReminder,
} = require('./matcher');
const { parseMessage, TEXT_ONLY_ACTIONS } = require('./utils');
const { isValidWebhookSecret, isValidAdminKey } = require('./middleware');
const logger = require('./logger');

// ──────────────────────────────────────────────
// Bootstrap
// ──────────────────────────────────────────────

let config;

async function bootstrap() {
  config = loadConfig();

  // Init Supabase (source of truth)
  initDb(config);
  await testConnection(); // Fail-fast nếu credentials sai

  // Init OCR (Poe API)
  initOcr(config.ocr);

  // Init Telegram Bot — synchronous
  initTelegram(config.telegram.botToken);

  // Start Express immediately so Render health check passes
  const app = express();
  app.use(express.json());

  // ──── Routes ────

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'xuong-vinfast-phuc-loi', time: new Date().toISOString() });
  });

  // Webhook health check + auto-heal
  app.get('/health/webhook', async (_req, res) => {
    try {
      const result = await ensureWebhook();
      res.json(result);
    } catch (err) {
      logger.error('Webhook health check failed', { error: err.message });
      res.status(500).json({ status: 'error', error: err.message });
    }
  });

  // Admin route protection middleware
  function requireAdminKey(req, res, next) {
    if (!isValidAdminKey(req.headers, config.security.adminApiKey)) {
      logger.warn('Admin route unauthorized', { path: req.path, ip: req.ip });
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  }

  // Telegram webhook (POST)
  app.post('/webhook/telegram', async (req, res) => {
    try {
      // Validate webhook secret before accepting the update
      if (!isValidWebhookSecret(req.headers, config.telegram.webhookSecret)) {
        logger.warn('Telegram webhook: invalid secret token', { ip: req.ip });
        return res.status(403).json({ error: 'Forbidden' });
      }

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
          await sendMessage(data.chatId, '❌ Có lỗi xảy ra khi xử lý tin nhắn. Vui lòng thử lại.');
        } catch (sendErr) {
          logger.error('Failed to notify user about error', { error: sendErr.message });
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
  app.post('/admin/check-alerts', requireAdminKey, async (_req, res) => {
    try {
      const updated = await checkTimeAlerts(config);
      res.json({ status: 'ok', updatedCount: updated });
    } catch (err) {
      logger.error('Alert check failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: trigger morning briefing
  app.post('/admin/morning-briefing', requireAdminKey, async (_req, res) => {
    try {
      const report = await handleMorningBriefing(config);
      res.json({ status: 'ok', report: report.replyMessages });
    } catch (err) {
      logger.error('Morning briefing failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: trigger daily report (full combined report)
  app.post('/admin/daily-report', requireAdminKey, async (_req, res) => {
    try {
      const report = await handleFullReport(config);
      res.json({ status: 'ok', report: report.replyMessages });
    } catch (err) {
      logger.error('Daily report failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: expire xe kẹt quá lâu (mặc định >7 ngày)
  app.post('/admin/expire-stale', requireAdminKey, async (req, res) => {
    try {
      const days = parseInt(req.body.days || '7', 10);
      const { DateTime } = require('luxon');
      const cutoff = DateTime.now().setZone(config.timezone).minus({ days }).toISO();
      const nowIso = new Date().toISOString();

      const before = await countInWorkshop();
      const expired = await expireStaleVehicles(cutoff, nowIso);
      const after = await countInWorkshop();

      logger.info('Stale vehicles expired', { days, expired, before, after });
      res.json({ status: 'ok', expired, before, after, cutoffDays: days });
    } catch (err) {
      logger.error('Expire stale failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: force-exit 1 xe
  app.post('/admin/force-exit/:vehicleId', requireAdminKey, async (req, res) => {
    try {
      const nowIso = new Date().toISOString();
      const result = await forceExitVehicle(req.params.vehicleId, nowIso);
      if (!result) {
        return res.status(404).json({ error: 'Không tìm thấy xe đang trong xưởng với ID này' });
      }
      logger.info('Vehicle force-exited', { vehicleId: result.vehicle_id, plate: result.plate });
      res.json({ status: 'ok', vehicle: result });
    } catch (err) {
      logger.error('Force exit failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: xem tồn kho count
  app.get('/admin/workshop-count', requireAdminKey, async (_req, res) => {
    try {
      const count = await countInWorkshop();
      res.json({ status: 'ok', inWorkshop: count });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Start server
  const port = config.port;
  app.listen(port, async () => {
    logger.info(`Server started on port ${port}`);
    logger.info('Xuong VinFast Phuc Loi - He thong theo doi xe vao/ra (Telegram Bot)');
    logger.info('Webhook URL: POST /webhook/telegram');
    logger.info('Operational thresholds', {
      minWorkshopMinutes: config.alerts.minWorkshopMinutes,
      warningHours: config.alerts.warningHours,
      urgentHours: config.alerts.urgentHours,
    });

    if (!config.telegram.webhookSecret) {
      logger.warn('TELEGRAM_WEBHOOK_SECRET not set — webhook endpoint is unauthenticated');
    }
    if (!config.security.adminApiKey) {
      logger.warn('ADMIN_API_KEY not set — /admin/* routes are unprotected');
    }

    // Tu dong set webhook neu co TELEGRAM_WEBHOOK_URL
    if (config.telegram.webhookUrl) {
      try {
        const webhookFullUrl = `${config.telegram.webhookUrl}/webhook/telegram`;
        await setWebhook(webhookFullUrl, config.telegram.webhookSecret);
        logger.info(`Telegram webhook set: ${webhookFullUrl}`);
      } catch (err) {
        logger.error('Failed to set Telegram webhook', { error: err.message });
      }
    }

    if (config.manager.chatIds.length > 0) {
      logger.info(`Manager chat IDs configured: ${config.manager.chatIds.length}`);
    }

    // Init Google Sheets mirror in background — non-fatal, Supabase is source of truth
    initSheets(config.sheets).catch(err => {
      logger.warn('Google Sheets init failed — mirror disabled', { error: err.message });
    });
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

  // Nhac xac nhan xe ra luc 17:00
  scheduleEndOfDayReminder();

  // Bao cao sang luc 7:00
  scheduleMorningBriefing();

  // Bao cao tu dong cuoi ngay luc 18:00
  scheduleDailyReport();

  // Tu dong don dep xe ket moi ngay luc 5h sang
  scheduleStaleCleanup();

  // Tu dong dong xe qua 72h moi gio
  scheduleAutoClose();

  // Tu dong kiem tra va heal webhook moi 30 phut
  scheduleWebhookCheck();
}

function scheduleEndOfDayReminder() {
  const REMINDER_HOUR = 17;
  const chatIds = config.manager.chatIds;

  if (chatIds.length === 0) {
    logger.info('No manager chat IDs - end-of-day reminder disabled');
    return;
  }

  let lastReminderDate = '';
  setInterval(async () => {
    const { DateTime } = require('luxon');
    const now = DateTime.now().setZone(config.timezone);
    const todayStr = now.toFormat('yyyy-MM-dd');
    const currentHour = now.hour;

    if (currentHour === REMINDER_HOUR && lastReminderDate !== todayStr) {
      lastReminderDate = todayStr;
      try {
        await sendEndOfDayReminder(config);
      } catch (err) {
        logger.error('End-of-day reminder failed', { error: err.message });
      }
    }
  }, 60 * 1000);

  logger.info(`End-of-day reminder scheduled at ${REMINDER_HOUR}:00`);
}

function scheduleStaleCleanup() {
  const STALE_DAYS = 7;
  let lastCleanupDate = '';

  setInterval(async () => {
    const { DateTime } = require('luxon');
    const now = DateTime.now().setZone(config.timezone);
    const todayStr = now.toFormat('yyyy-MM-dd');
    const currentHour = now.hour;

    if (currentHour === 5 && lastCleanupDate !== todayStr) {
      lastCleanupDate = todayStr;
      try {
        const cutoff = now.minus({ days: STALE_DAYS }).toISO();
        const nowIso = new Date().toISOString();
        const expired = await expireStaleVehicles(cutoff, nowIso);
        if (expired > 0) {
          logger.info(`Auto-cleanup: ${expired} stale vehicles expired (>${STALE_DAYS} days)`);
        }
      } catch (err) {
        logger.error('Scheduled stale cleanup failed', { error: err.message });
      }
    }
  }, 60 * 1000);

  logger.info(`Stale vehicle cleanup scheduled at 05:00 (>${STALE_DAYS} days)`);
}

function scheduleAutoClose() {
  const CLOSE_HOURS = 72;
  let lastCloseHour = -1;

  setInterval(async () => {
    try {
      const { DateTime } = require('luxon');
      const now = DateTime.now().setZone(config.timezone);
      const currentHour = now.hour;

      // Run once per hour (not on the same hour twice)
      if (currentHour === lastCloseHour) return;
      lastCloseHour = currentHour;

      const cutoff = now.minus({ hours: CLOSE_HOURS }).toISO();
      const nowIso = new Date().toISOString();
      const closedVehicles = await autoCloseVehicles(cutoff, nowIso);

      if (closedVehicles.length > 0) {
        logger.info(`Auto-close: ${closedVehicles.length} vehicles closed (>${CLOSE_HOURS}h)`);

        // Send summary message to managers
        const managerChatIds = config.manager.chatIds;
        if (managerChatIds.length > 0) {
          let msg = `🔄 Tự động đóng ${closedVehicles.length} xe quá ${CLOSE_HOURS}h:\n`;
          for (const v of closedVehicles.slice(0, 10)) {
            msg += `• ${v.plate} (vào ${v.timeIn})\n`;
          }
          if (closedVehicles.length > 10) {
            msg += `... và ${closedVehicles.length - 10} xe khác\n`;
          }
          msg += `Sai? Gõ RA {biển số} để mở lại.`;

          for (const chatId of managerChatIds) {
            try {
              await sendMessage(chatId, msg);
            } catch (err) {
              logger.error('Failed to send auto-close summary to manager', { chatId, error: err.message });
            }
          }
        }
      }
    } catch (err) {
      logger.error('Scheduled auto-close failed', { error: err.message });
    }
  }, 60 * 1000);

  logger.info(`Auto-close scheduled to run every hour (>${CLOSE_HOURS}h vehicles)`);
}

// ──────────────────────────────────────────────
// Webhook self-heal
// ──────────────────────────────────────────────

async function ensureWebhook() {
  if (!config.telegram.webhookUrl) {
    return { status: 'skipped', reason: 'TELEGRAM_WEBHOOK_URL not configured' };
  }

  const expectedUrl = `${config.telegram.webhookUrl}/webhook/telegram`;
  const info = await getWebhookInfo();

  if (info.url === expectedUrl) {
    return { status: 'ok', url: info.url, pending: info.pending_update_count };
  }

  logger.warn('Webhook missing or wrong — auto-healing', { current: info.url, expected: expectedUrl });
  await setWebhook(expectedUrl, config.telegram.webhookSecret);
  const verified = await getWebhookInfo();
  logger.info('Webhook auto-healed', { url: verified.url });

  return { status: 'healed', previousUrl: info.url, newUrl: verified.url, pending: verified.pending_update_count };
}

function scheduleWebhookCheck() {
  setInterval(async () => {
    try {
      const result = await ensureWebhook();
      if (result.status === 'healed') {
        logger.warn('Periodic webhook check: auto-healed', result);
      }
    } catch (err) {
      logger.error('Periodic webhook check failed', { error: err.message });
    }
  }, 30 * 60 * 1000);

  logger.info('Webhook self-heal check scheduled every 30 minutes');
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

  // ═══ TEXT-ONLY COMMANDS ═══
  const parsed = parseMessage(text);
  if (parsed.action && TEXT_ONLY_ACTIONS.includes(parsed.action)) {
    let result;
    if (parsed.action === 'TONKHO') result = await handleTonKho(config);
    else if (parsed.action === 'HELP') result = handleHelp();
    else if (parsed.action === 'BAOCAO' || parsed.action === 'NANGSUAT') result = await handleFullReport(config);
    else if (parsed.action === 'RA_MANUAL') {
      // Chỉ manager mới được dùng lệnh RA thủ công
      const isManager = config.manager.chatIds.includes(String(chatId))
        || config.manager.chatIds.includes(String(senderId));
      if (!isManager) {
        await sendMessage(chatId, '❌ Chỉ quản lý mới được dùng lệnh RA thủ công.');
        return;
      }
      result = await handleManualExit(parsed.params, senderName, config);
    }

    if (result && result.replyMessages) {
      for (const msg of result.replyMessages) {
        await sendMessage(chatId, msg);
      }
    } else if (result && result.replyMessage) {
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
// Scheduled morning briefing
// ──────────────────────────────────────────────

function scheduleMorningBriefing() {
  const morningHour = config.manager.morningReportHour || 7;
  const chatIds = config.manager.chatIds;

  if (chatIds.length === 0) {
    logger.info('No manager chat IDs - morning briefing disabled');
    return;
  }

  let lastBriefingDate = '';
  setInterval(async () => {
    const { DateTime } = require('luxon');
    const now = DateTime.now().setZone(config.timezone);
    const todayStr = now.toFormat('yyyy-MM-dd');
    const currentHour = now.hour;

    if (currentHour === morningHour && lastBriefingDate !== todayStr) {
      lastBriefingDate = todayStr;
      try {
        await sendScheduledMorningBriefing(config);
      } catch (err) {
        logger.error('Morning briefing failed', { error: err.message });
      }
    }
  }, 60 * 1000);

  logger.info(`Morning briefing scheduled at ${morningHour}:00`);
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
        await sendScheduledFullReport(config);
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
