'use strict';

const { DateTime } = require('luxon');
const db         = require('./db');
const sheetsSync = require('./sheets-sync');
const utils      = require('./utils');
const logger     = require('./logger');

/**
 * Xu ly 1 su kien xe vao/ra.
 *
 * Race-condition-free: the DB's process_vehicle() RPC uses SELECT FOR UPDATE
 * to serialize concurrent burst photos for the same plate at the PostgreSQL
 * level. No in-process mutex needed.
 */
async function processVehicleEvent(event, config) {
  const tz  = config.timezone;
  const now = utils.nowFormatted(tz);       // dd/MM/yyyy HH:mm:ss  (for display + Sheets)
  const nowIso = new Date().toISOString();  // UTC ISO               (for DB)

  const eventId   = utils.generateEventId(tz);
  const vehicleId = utils.generateVehicleId(tz);

  const { messageId, senderId, senderName, imageUrl, ocrResult } = event;
  const plate      = ocrResult.plateText;
  const confidence = ocrResult.confidence;
  const confLabel  = utils.confidenceLabel(confidence, config.ocr);
  const messageKey = `[MSG_ID:${messageId}]`;

  // ── Step 1: Always record in NHẬT KÝ first ──────────────────────────────
  await db.insertEvent({
    eventId,
    timestamp:        nowIso,
    recordType:       'Chưa xác định',
    plateAI:          plate,
    confidenceLabel:  confLabel,
    imageUrl,
    sender:           senderName || senderId,
    messageKey,
    result:           '',
  });

  // Mirror to Sheets asynchronously (fire-and-forget)
  sheetsSync.syncLogInsert({
    eventId,
    timestamp:        now,   // Sheets stores formatted string
    recordType:       'Chưa xác định',
    plateAI:          plate,
    confidenceLabel:  confLabel,
    imageUrl,
    sender:           senderName || senderId,
    originalMessage:  messageKey,
    result:           '',
  });

  // ── Step 2: Validate OCR result ─────────────────────────────────────────

  if (!plate) {
    const errorId = utils.generateErrorId(tz);
    await db.insertReview({
      errorId, eventId, timestamp: nowIso, imageUrl, plateAI: '',
      reason:       'Anh mo / khong thay bien so',
      suggestion:   'Chup lai anh',
      reviewStatus: 'Chưa xử lý',
    });
    await db.updateEventResult(eventId, 'Khong doc duoc bien so');
    sheetsSync.syncReviewInsert({ errorId, eventId, timestamp: now, imageUrl, plateAI: '', reason: 'Anh mo / khong thay bien so', suggestion: 'Chup lai anh', reviewStatus: 'Chưa xử lý' });
    sheetsSync.syncLogResult(eventId, 'Khong doc duoc bien so');

    return {
      success: false,
      replyMessage: 'Không đọc được biển số trong ảnh.\nVui lòng chụp lại rõ hơn, chụp thẳng vào biển số nhé.',
      eventId,
    };
  }

  if (confidence < config.ocr.confidenceMedium) {
    const errorId = utils.generateErrorId(tz);
    await db.insertReview({
      errorId, eventId, timestamp: nowIso, imageUrl, plateAI: plate,
      reason:       'OCR doc khong chac',
      suggestion:   'Chup lai anh',
      reviewStatus: 'Chưa xử lý',
    });
    await db.updateEventResult(eventId, 'OCR mo - chuyen kiem tra');
    sheetsSync.syncReviewInsert({ errorId, eventId, timestamp: now, imageUrl, plateAI: plate, reason: 'OCR doc khong chac', suggestion: 'Chup lai anh', reviewStatus: 'Chưa xử lý' });
    sheetsSync.syncLogResult(eventId, 'OCR mo - chuyen kiem tra');

    return {
      success: false,
      replyMessage: `Đọc biển số chưa chắc chắn: ${plate}\nVui lòng chụp lại ảnh rõ hơn nhé.`,
      eventId,
    };
  }

  if (!utils.isValidVietnamPlate(plate)) {
    const errorId = utils.generateErrorId(tz);
    await db.insertReview({
      errorId, eventId, timestamp: nowIso, imageUrl, plateAI: plate,
      reason:       'Bien so khong dung dinh dang',
      suggestion:   'Chup lai anh',
      reviewStatus: 'Chưa xử lý',
    });
    await db.updateEventResult(eventId, 'Bien so sai format');
    sheetsSync.syncReviewInsert({ errorId, eventId, timestamp: now, imageUrl, plateAI: plate, reason: 'Bien so khong dung dinh dang', suggestion: 'Chup lai anh', reviewStatus: 'Chưa xử lý' });
    sheetsSync.syncLogResult(eventId, 'Bien so sai format');

    return {
      success: false,
      replyMessage: `Biển số đọc được (${plate}) không đúng định dạng.\nVui lòng chụp lại ảnh rõ hơn nhé.`,
      eventId,
    };
  }

  // ── Step 3: Atomic VAO/RA decision (PostgreSQL RPC with SELECT FOR UPDATE) ─

  const minWorkshopSecs = (config.alerts.minWorkshopMinutes || 15) * 60;
  const decision = await db.processVehicleDecision(plate, vehicleId, nowIso, imageUrl, minWorkshopSecs);

  if (decision.action === 'VAO') {
    await db.updateEventResult(eventId, 'Da ghi VAO danh sach');
    sheetsSync.syncLogResult(eventId, 'Da ghi VAO danh sach');
    sheetsSync.syncVehicleIn({
      vehicleId: decision.vehicle_id,
      plate,
      timeIn:    now,
      timeOut:   '',
      duration:  '',
      imageIn:   imageUrl,
      imageOut:  '',
      status:    'Đang trong xưởng',
      priority:  'Bình thường',
      note:      '',
      updatedAt: now,
    });

    logger.info('Vehicle IN processed', { vehicleId: decision.vehicle_id, plate });
    return {
      success: true,
      replyMessage: `✅ Đã ghi nhận xe VÀO xưởng\nBiển số: ${plate}\nLúc: ${now}\nMã lượt: ${decision.vehicle_id}`,
      eventId,
    };
  }

  if (decision.action === 'RA_DUPLICATE') {
    await db.updateEventResult(eventId, 'Anh trung lap - xe vua vao xuong, bo qua RA');
    sheetsSync.syncLogResult(eventId, 'Anh trung lap - xe vua vao xuong, bo qua RA');

    const timeInFormatted = fmtIso(decision.time_in_ts, tz);
    logger.info('Duplicate capture ignored - car just entered', {
      plate, secondsInWorkshop: Math.round(decision.seconds_in),
    });
    return {
      success: true,
      replyMessage: `ℹ️ Xe ${plate} đã được ghi nhận VÀO lúc ${timeInFormatted}\nMã lượt: ${decision.vehicle_id}`,
      eventId,
    };
  }

  // RA — update is already committed in the RPC
  const duration    = Math.round(decision.seconds_in / 60);
  const durationStr = utils.formatDuration(duration);

  await db.updateEventResult(eventId, 'Da ghep cap thanh cong');
  sheetsSync.syncLogResult(eventId, 'Da ghep cap thanh cong');
  sheetsSync.syncVehicleOut(plate, decision.vehicle_id, {
    timeOut:   now,
    duration:  String(duration),
    imageOut:  imageUrl,
    status:    'Đã ra xưởng',
    priority:  'Bình thường',
    updatedAt: now,
  });

  logger.info('Vehicle OUT processed', { vehicleId: decision.vehicle_id, plate, duration });
  return {
    success: true,
    replyMessage: `🏁 Đã ghi nhận xe RA xưởng\nBiển số: ${plate}\nLúc: ${now}\nThời gian lưu: ${durationStr}\nMã lượt: ${decision.vehicle_id}`,
    eventId,
  };
}

// ──────────────────────────────────────────────
// TONKHO - Xem xe dang trong xuong
// ──────────────────────────────────────────────

async function handleTonKho(config) {
  const tz       = config.timezone;
  const vehicles = await db.getAllInWorkshop(tz);

  if (vehicles.length === 0) {
    return { replyMessage: '🟢 Hiện không có xe nào trong xưởng.' };
  }

  const urgent  = [];
  const warning = [];
  const normal  = [];

  for (const v of vehicles) {
    const hours = utils.hoursSince(v.timeIn, tz);
    const line  = `${v.plate} — ${utils.formatHours(hours)}`;

    if (v.priority === 'Khẩn')       urgent.push(line);
    else if (v.priority === 'Cảnh báo') warning.push(line);
    else                               normal.push(line);
  }

  let msg = `🔧 Tồn kho: ${vehicles.length} xe trong xưởng`;

  if (urgent.length > 0) {
    msg += `\n\n🚨 Khẩn — >48h (${urgent.length}):`;
    for (const v of urgent) msg += `\n  ${v}`;
  }
  if (warning.length > 0) {
    msg += `\n\n⚠️ Cảnh báo — >24h (${warning.length}):`;
    for (const v of warning) msg += `\n  ${v}`;
  }
  if (normal.length > 0) {
    msg += `\n\n🔧 Bình thường (${normal.length}):`;
    for (const v of normal) msg += `\n  ${v}`;
  }

  return { replyMessage: msg };
}

// ──────────────────────────────────────────────
// HELP
// ──────────────────────────────────────────────

function handleHelp() {
  const msg =
    `📋 Hướng dẫn sử dụng\n` +
    `\n— Ghi nhận xe —` +
    `\nChụp ảnh biển số → Gửi vào đây (không cần gõ gì thêm)` +
    `\n  Lần 1: Tự động ghi xe VÀO xưởng` +
    `\n  Lần 2: Tự động ghi xe RA + thời gian lưu` +
    `\n\n— Xem tồn kho —` +
    `\nTONKHO — Danh sách xe đang trong xưởng` +
    `\n\n— Báo cáo —` +
    `\nBAOCAO — Báo cáo tổng hợp trong ngày` +
    `\nNANGSUAT — Báo cáo năng suất chi tiết` +
    `\n\n— Khác —` +
    `\nHELP — Xem hướng dẫn này`;

  return { replyMessage: msg };
}

// ──────────────────────────────────────────────
// Kiem tra canh bao thoi gian luu (24h/48h)
// ──────────────────────────────────────────────

async function checkTimeAlerts(config) {
  const tz       = config.timezone;
  const nowIso   = new Date().toISOString();
  const now      = utils.nowFormatted(tz);
  const vehicles = await db.getAllInWorkshop(tz);
  let updated    = 0;

  for (const v of vehicles) {
    const hours      = utils.hoursSince(v.timeIn, tz);
    let newPriority  = 'Bình thường';

    if (hours >= config.alerts.urgentHours)       newPriority = 'Khẩn';
    else if (hours >= config.alerts.warningHours) newPriority = 'Cảnh báo';

    if (newPriority !== v.priority) {
      await db.updateVehiclePriority(v.vehicleId, newPriority, nowIso);
      sheetsSync.syncVehiclePriority(v.plate, newPriority, now);
      updated++;

      logger.info('Alert level changed', {
        plate: v.plate, vehicleId: v.vehicleId,
        hours: Math.round(hours * 10) / 10, newPriority,
      });

      if (newPriority !== 'Bình thường') {
        const icon     = newPriority === 'Khẩn' ? '🚨 Khẩn' : '⚠️ Cảnh báo';
        const alertMsg =
          `${icon} — Xe ${v.plate} đã trong xưởng ${utils.formatHours(hours)}.\n` +
          `Vào lúc: ${v.timeIn}\nMã lượt: ${v.vehicleId}`;
        notifyManagers(alertMsg, config).catch(err => {
          logger.error('Manager alert failed', { error: err.message });
        });
      }
    }
  }

  return updated;
}

// ──────────────────────────────────────────────
// Format danh sach xe trong xuong (compact)
// ──────────────────────────────────────────────

function formatWorkshopSummary(vehicles, tz) {
  const urgent  = [];
  const warning = [];
  const buckets = { '24-48h': 0, '12-24h': 0, '6-12h': 0, '<6h': 0 };

  for (const v of vehicles) {
    const hours = utils.hoursSince(v.timeIn, tz);
    const label = `${v.plate} — ${utils.formatHours(hours)}`;

    if (v.priority === 'Khẩn') {
      urgent.push(label);
    } else if (v.priority === 'Cảnh báo') {
      warning.push(label);
    } else if (hours >= 24)      buckets['24-48h']++;
    else if (hours >= 12) buckets['12-24h']++;
    else if (hours >= 6)  buckets['6-12h']++;
    else                  buckets['<6h']++;
  }

  let msg = '';

  if (urgent.length > 0) {
    msg += `\n\n🚨 Khẩn (>48h):`;
    for (const v of urgent) msg += `\n  ${v}`;
  }
  if (warning.length > 0) {
    msg += `\n\n⚠️ Cảnh báo (>24h):`;
    for (const v of warning) msg += `\n  ${v}`;
  }

  const normalCount = vehicles.length - urgent.length - warning.length;
  if (normalCount > 0) {
    msg += `\n\n🔧 Xe còn lại (${normalCount}):`;
    for (const [range, count] of Object.entries(buckets)) {
      if (count > 0) msg += `\n  ${range}: ${count} xe`;
    }
  }

  return msg;
}

// ──────────────────────────────────────────────
// Bao cao tu dong cuoi ngay
// ──────────────────────────────────────────────

async function handleDailyReport(config) {
  const tz      = config.timezone;
  const summary = await db.getDailySummary(tz);
  const avgStr  = utils.formatDuration(summary.avgDuration);

  let msg = `📊 Báo cáo tổng hợp — ${summary.today}\n`;
  msg += `\nXe vào hôm nay: ${summary.totalIn}`;
  msg += `\nXe ra hôm nay: ${summary.totalOut}`;
  msg += `\nĐang trong xưởng: ${summary.inWorkshop}`;

  if (summary.warningCount > 0) msg += `\n⚠️ Cảnh báo (>24h): ${summary.warningCount}`;
  if (summary.urgentCount > 0)  msg += `\n🚨 Khẩn (>48h): ${summary.urgentCount}`;
  if (summary.avgDuration > 0)  msg += `\nTB hoàn thành: ${avgStr}`;
  if (summary.pendingReview > 0) msg += `\n\n⚠️ Cần kiểm tra: ${summary.pendingReview} mục chưa xử lý`;

  const inWorkshop = await db.getAllInWorkshop(tz);
  if (inWorkshop.length > 0) {
    msg += formatWorkshopSummary(inWorkshop, tz);
  }

  msg += `\n\nGõ TONKHO để xem danh sách đầy đủ.`;
  return { replyMessage: msg };
}

async function sendScheduledDailyReport(config) {
  const report = await handleDailyReport(config);
  await notifyManagers(report.replyMessage, config);
  logger.info('Scheduled daily report sent');
}

// ──────────────────────────────────────────────
// Thong bao cho quan ly qua Telegram
// ──────────────────────────────────────────────

async function notifyManagers(message, config) {
  const { sendMessage } = require('./telegram');
  const chatIds = config.manager.chatIds;
  if (chatIds.length === 0) return;

  for (const chatId of chatIds) {
    await sendMessage(chatId, message);
  }
  logger.info('Notified managers', { count: chatIds.length });
}

// ──────────────────────────────────────────────
// BAO CAO NANG SUAT
// ──────────────────────────────────────────────

async function handleProductivityReport(config) {
  const tz   = config.timezone;
  const data = await db.getProductivityData(tz);

  let msg = `📊 Báo cáo năng suất xưởng — ${data.today}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

  msg += `\n📊 Tổng quan:`;
  msg += `\n  Xe tiếp nhận hôm nay: ${data.todayIn}`;
  msg += `\n  Xe hoàn thành hôm nay: ${data.todayOut}`;
  msg += `\n  Đang trong xưởng: ${data.inWorkshop}`;
  msg += `\n  Tỷ lệ hoàn thành: ${data.completionRate}%`;

  msg += `\n\n📈 So sánh với hôm qua (${data.yesterday}):`;
  const diffIn  = data.todayIn  - data.yesterdayIn;
  const diffOut = data.todayOut - data.yesterdayOut;
  const arrowIn  = diffIn  > 0 ? `+${diffIn} ↑`  : diffIn  < 0 ? `${diffIn} ↓`  : '= bằng';
  const arrowOut = diffOut > 0 ? `+${diffOut} ↑` : diffOut < 0 ? `${diffOut} ↓` : '= bằng';
  msg += `\n  Tiếp nhận: ${data.yesterdayIn} → ${data.todayIn} (${arrowIn})`;
  msg += `\n  Hoàn thành: ${data.yesterdayOut} → ${data.todayOut} (${arrowOut})`;

  if (data.completedCount > 0) {
    const avgStr = utils.formatDuration(data.avgDuration);
    msg += `\n\n⏱ Thời gian xử lý:`;
    msg += `\n  Trung bình: ${avgStr}`;
    if (data.fastestVehicle) msg += `\n  Nhanh nhất: ${data.fastestVehicle.plate} (${utils.formatDuration(data.fastestVehicle.duration)})`;
    if (data.slowestVehicle) msg += `\n  Chậm nhất: ${data.slowestVehicle.plate} (${utils.formatDuration(data.slowestVehicle.duration)})`;
    if (data.yesterdayAvgDuration > 0) {
      const diffAvg  = data.avgDuration - data.yesterdayAvgDuration;
      const avgArrow = diffAvg > 0
        ? `chậm hơn ${utils.formatDuration(Math.abs(diffAvg))}`
        : diffAvg < 0
          ? `nhanh hơn ${utils.formatDuration(Math.abs(diffAvg))}`
          : 'bằng hôm qua';
      msg += `\n  So với hôm qua: ${avgArrow}`;
    }
  }

  if (data.todayIn > 0) {
    msg += `\n\n🕐 Phân bố khung giờ tiếp nhận:`;
    msg += `\n  Sáng (6h–12h): ${data.timeSlots.sang} xe`;
    msg += `\n  Chiều (12h–18h): ${data.timeSlots.chieu} xe`;
    msg += `\n  Tối (18h–24h): ${data.timeSlots.toi} xe`;
    if (data.timeSlots.dem > 0) msg += `\n  Đêm (0h–6h): ${data.timeSlots.dem} xe`;
  }

  if (data.warningCount > 0 || data.urgentCount > 0) {
    msg += `\n\n⚠️ Cảnh báo:`;
    if (data.warningCount > 0) msg += `\n  Quá 24h: ${data.warningCount} xe`;
    if (data.urgentCount > 0)  msg += `\n  🚨 Khẩn quá 48h: ${data.urgentCount} xe`;
  }

  if (data.inWorkshop > 0) {
    const inWorkshop = await db.getAllInWorkshop(tz);
    msg += formatWorkshopSummary(inWorkshop, tz);
  }

  if (data.pendingReview > 0) msg += `\n\n📋 Cần kiểm tra thủ công: ${data.pendingReview} mục`;

  msg += `\n\nGõ TONKHO để xem danh sách đầy đủ.`;
  msg += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  return { replyMessage: msg };
}

async function sendScheduledProductivityReport(config) {
  const report = await handleProductivityReport(config);
  await notifyManagers(report.replyMessage, config);
  logger.info('Scheduled productivity report sent');
}

// ──────────────────────────────────────────────
// BAO CAO KE TOAN
// ──────────────────────────────────────────────

async function handleAccountingReport(fileUrl, config) {
  const { downloadAndParseExcel } = require('./excel');
  const { generateAccountingReport } = require('./accounting');

  const orders = await downloadAndParseExcel(fileUrl);
  if (orders.length === 0) {
    return { messages: ['File Excel không có dữ liệu hợp lệ. Vui lòng kiểm tra lại nhé.'] };
  }

  const messages = await generateAccountingReport(orders, config);
  return { messages };
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function fmtIso(isoTs, tz) {
  if (!isoTs) return '';
  return DateTime.fromISO(isoTs, { zone: tz }).toFormat('dd/MM/yyyy HH:mm:ss');
}

module.exports = {
  processVehicleEvent,
  checkTimeAlerts,
  handleTonKho,
  handleHelp,
  handleDailyReport,
  sendScheduledDailyReport,
  handleProductivityReport,
  handleAccountingReport,
};
