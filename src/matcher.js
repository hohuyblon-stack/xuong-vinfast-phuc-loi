'use strict';

const sheets = require('./sheets');
const utils = require('./utils');
const logger = require('./logger');

/**
 * Xu ly 1 su kien xe vao/ra.
 * Tu dong xac dinh VAO hay RA dua vao trang thai bien so trong Sheets.
 */
async function processVehicleEvent(event, config) {
  const tz = config.timezone;
  const now = utils.nowFormatted(tz);
  const eventId = utils.generateEventId(tz);

  const { messageId, senderId, senderName, text, imageUrl, ocrResult } = event;
  const plate = ocrResult.plateText;
  const confidence = ocrResult.confidence;
  const confLabel = utils.confidenceLabel(confidence, config.ocr);

  // Buoc 1: Luon ghi NHAT KY truoc
  const originalMessage = `[MSG_ID:${messageId}]`;

  await sheets.appendLogRow({
    eventId,
    timestamp: now,
    recordType: 'Chua xac dinh',
    plateAI: plate,
    confidenceLabel: confLabel,
    imageUrl,
    sender: senderName || senderId,
    originalMessage,
    result: '',
  });

  // Buoc 2: Kiem tra cac case loi anh/OCR

  if (!plate) {
    const errorId = utils.generateErrorId(tz);
    await sheets.appendReviewRow({
      errorId, eventId, timestamp: now, imageUrl, plateAI: '',
      reason: 'Anh mo / khong thay bien so',
      suggestion: 'Chup lai anh',
      reviewStatus: 'Chua xu ly',
    });
    await sheets.updateLogResult(eventId, 'Khong doc duoc bien so');

    return {
      success: false,
      replyMessage: 'Không đọc được biển số trong ảnh.\nVui lòng chụp lại rõ hơn, chụp thẳng vào biển số nhé.',
      eventId,
    };
  }

  if (confidence < config.ocr.confidenceMedium) {
    const errorId = utils.generateErrorId(tz);
    await sheets.appendReviewRow({
      errorId, eventId, timestamp: now, imageUrl, plateAI: plate,
      reason: 'OCR doc khong chac',
      suggestion: 'Chup lai anh',
      reviewStatus: 'Chua xu ly',
    });
    await sheets.updateLogResult(eventId, 'OCR mo - chuyen kiem tra');

    return {
      success: false,
      replyMessage: `Đọc biển số chưa chắc chắn: ${plate}\nVui lòng chụp lại ảnh rõ hơn nhé.`,
      eventId,
    };
  }

  if (!utils.isValidVietnamPlate(plate)) {
    const errorId = utils.generateErrorId(tz);
    await sheets.appendReviewRow({
      errorId, eventId, timestamp: now, imageUrl, plateAI: plate,
      reason: 'Bien so khong dung dinh dang',
      suggestion: 'Chup lai anh',
      reviewStatus: 'Chua xu ly',
    });
    await sheets.updateLogResult(eventId, 'Bien so sai format');

    return {
      success: false,
      replyMessage: `Biển số đọc được (${plate}) không đúng định dạng.\nVui lòng chụp lại ảnh rõ hơn nhé.`,
      eventId,
    };
  }

  // Buoc 3: Tu dong xac dinh VAO hay RA
  // Neu bien so dang trong xuong → RA, nguoc lai → VAO
  const existing = await sheets.findMainRow(plate, 'Dang trong xuong');

  if (existing) {
    return await handleVehicleOut(eventId, plate, imageUrl, now, config, existing);
  } else {
    return await handleVehicleIn(eventId, plate, imageUrl, now, config);
  }
}

/**
 * Xu ly Xe vao (biet truoc bien so chua co trong xuong).
 */
async function handleVehicleIn(eventId, plate, imageUrl, now, config) {
  const vehicleId = utils.generateVehicleId(config.timezone);

  await sheets.appendMainRow({
    vehicleId,
    plate,
    timeIn: now,
    timeOut: '',
    duration: '',
    imageIn: imageUrl,
    imageOut: '',
    status: 'Dang trong xuong',
    priority: 'Binh thuong',
    note: '',
    updatedAt: now,
  });

  await sheets.updateLogResult(eventId, 'Da ghi VAO danh sach');

  logger.info('Vehicle IN processed', { vehicleId, plate });
  return {
    success: true,
    replyMessage: `✅ Đã ghi nhận xe VÀO xưởng\nBiển số: ${plate}\nLúc: ${now}\nMã lượt: ${vehicleId}`,
    eventId,
  };
}

/**
 * Xu ly Xe ra (nhan existing record tu processVehicleEvent).
 */
async function handleVehicleOut(eventId, plate, imageUrl, now, config, match) {
  const duration = utils.calcMinutesBetween(match.data.timeIn, now);

  await sheets.updateMainRow(match.rowIndex, {
    timeOut: now,
    duration: duration.toString(),
    imageOut: imageUrl,
    status: 'Da ra xuong',
    priority: 'Binh thuong',
    updatedAt: now,
  });

  await sheets.updateLogResult(eventId, 'Da ghep cap thanh cong');

  const durationStr = utils.formatDuration(duration);
  logger.info('Vehicle OUT processed', { vehicleId: match.data.vehicleId, plate, duration });

  return {
    success: true,
    replyMessage: `🏁 Đã ghi nhận xe RA xưởng\nBiển số: ${plate}\nLúc: ${now}\nThời gian lưu: ${durationStr}\nMã lượt: ${match.data.vehicleId}`,
    eventId,
  };
}

// ──────────────────────────────────────────────
// TONKHO - Xem xe dang trong xuong
// ──────────────────────────────────────────────

async function handleTonKho(config) {
  const tz = config.timezone;
  const vehicles = await sheets.getAllInWorkshop();

  if (vehicles.length === 0) {
    return { replyMessage: '🟢 Hiện không có xe nào trong xưởng.' };
  }

  let msg = `🔧 Tồn kho: ${vehicles.length} xe đang trong xưởng\n`;

  for (const v of vehicles) {
    const hours = utils.hoursSince(v.timeIn, tz);
    const hStr = Math.floor(hours);
    const mStr = Math.round((hours % 1) * 60);
    let icon = '';
    if (v.priority === 'Khan') icon = '🚨 ';
    else if (v.priority === 'Canh bao') icon = '⚠️ ';
    msg += `\n${icon}${v.plate} — ${hStr}h${mStr}p — vào ${v.timeIn}`;
    if (v.note) msg += ` (${v.note})`;
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
  const tz = config.timezone;
  const vehicles = await sheets.getAllInWorkshop();
  let updated = 0;

  for (const v of vehicles) {
    const hours = utils.hoursSince(v.timeIn, tz);
    let newPriority = 'Binh thuong';

    if (hours >= config.alerts.urgentHours) {
      newPriority = 'Khan';
    } else if (hours >= config.alerts.warningHours) {
      newPriority = 'Canh bao';
    }

    if (newPriority !== v.priority) {
      await sheets.updateMainRow(v.rowIndex, {
        priority: newPriority,
        updatedAt: utils.nowFormatted(tz),
      });
      updated++;
      logger.info('Alert level changed', {
        plate: v.plate,
        vehicleId: v.vehicleId,
        hours: Math.round(hours * 10) / 10,
        newPriority,
      });

      if (newPriority !== 'Binh thuong') {
        const hStr = Math.floor(hours);
        const mStr = Math.round((hours % 1) * 60);
        const icon = newPriority === 'Khan' ? '🚨 Khẩn' : '⚠️ Cảnh báo';
        const alertMsg =
          `${icon} — Xe ${v.plate} đã trong xưởng ${hStr} giờ ${mStr} phút.\n` +
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
// Bao cao tu dong cuoi ngay
// ──────────────────────────────────────────────

async function handleDailyReport(config) {
  const tz = config.timezone;
  const summary = await sheets.getDailySummary(tz);
  const avgStr = utils.formatDuration(summary.avgDuration);

  let msg = `📊 Báo cáo tổng hợp — ${summary.today}\n`;
  msg += `\nXe vào hôm nay: ${summary.totalIn}`;
  msg += `\nXe ra hôm nay: ${summary.totalOut}`;
  msg += `\nĐang trong xưởng: ${summary.inWorkshop}`;

  if (summary.warningCount > 0) {
    msg += `\n⚠️ Cảnh báo (>24h): ${summary.warningCount}`;
  }
  if (summary.urgentCount > 0) {
    msg += `\n🚨 Khẩn (>48h): ${summary.urgentCount}`;
  }

  if (summary.avgDuration > 0) {
    msg += `\nTrung bình thời gian hoàn thành: ${avgStr}`;
  }

  if (summary.pendingReview > 0) {
    msg += `\n\n⚠️ Cần kiểm tra: ${summary.pendingReview} mục chưa xử lý`;
  }

  const inWorkshop = await sheets.getAllInWorkshop();
  if (inWorkshop.length > 0) {
    msg += `\n\nDanh sách xe đang trong xưởng:`;
    for (const v of inWorkshop) {
      const hours = utils.hoursSince(v.timeIn, tz);
      const hStr = Math.floor(hours);
      const mStr = Math.round((hours % 1) * 60);
      let icon = '';
      if (v.priority === 'Khan') icon = '🚨 ';
      else if (v.priority === 'Canh bao') icon = '⚠️ ';
      msg += `\n${icon}${v.plate} — ${hStr}h${mStr}p`;
    }
  }

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
  const tz = config.timezone;
  const data = await sheets.getProductivityData(tz);

  let msg = `📊 Báo cáo năng suất xưởng — ${data.today}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

  msg += `\n📊 Tổng quan:`;
  msg += `\n  Xe tiếp nhận hôm nay: ${data.todayIn}`;
  msg += `\n  Xe hoàn thành hôm nay: ${data.todayOut}`;
  msg += `\n  Đang trong xưởng: ${data.inWorkshop}`;
  msg += `\n  Tỷ lệ hoàn thành: ${data.completionRate}%`;

  msg += `\n\n📈 So sánh với hôm qua (${data.yesterday}):`;
  const diffIn = data.todayIn - data.yesterdayIn;
  const diffOut = data.todayOut - data.yesterdayOut;
  const arrowIn = diffIn > 0 ? `+${diffIn} ↑` : diffIn < 0 ? `${diffIn} ↓` : '= bằng';
  const arrowOut = diffOut > 0 ? `+${diffOut} ↑` : diffOut < 0 ? `${diffOut} ↓` : '= bằng';
  msg += `\n  Tiếp nhận: ${data.yesterdayIn} → ${data.todayIn} (${arrowIn})`;
  msg += `\n  Hoàn thành: ${data.yesterdayOut} → ${data.todayOut} (${arrowOut})`;

  if (data.completedCount > 0) {
    const avgStr = utils.formatDuration(data.avgDuration);
    msg += `\n\n⏱ Thời gian xử lý:`;
    msg += `\n  Trung bình: ${avgStr}`;
    if (data.fastestVehicle) {
      msg += `\n  Nhanh nhất: ${data.fastestVehicle.plate} (${utils.formatDuration(data.fastestVehicle.duration)})`;
    }
    if (data.slowestVehicle) {
      msg += `\n  Chậm nhất: ${data.slowestVehicle.plate} (${utils.formatDuration(data.slowestVehicle.duration)})`;
    }
    if (data.yesterdayAvgDuration > 0) {
      const diffAvg = data.avgDuration - data.yesterdayAvgDuration;
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
    if (data.urgentCount > 0) msg += `\n  🚨 Khẩn quá 48h: ${data.urgentCount} xe`;
  }

  if (data.inWorkshop > 0) {
    const inWorkshop = await sheets.getAllInWorkshop();
    msg += `\n\n🔧 Xe đang trong xưởng (${inWorkshop.length}):`;
    for (const v of inWorkshop) {
      const hours = utils.hoursSince(v.timeIn, tz);
      const hStr = Math.floor(hours);
      const mStr = Math.round((hours % 1) * 60);
      let icon = '';
      if (v.priority === 'Khan') icon = '🚨 ';
      else if (v.priority === 'Canh bao') icon = '⚠️ ';
      msg += `\n${icon}${v.plate} — ${hStr}h${mStr}p`;
      if (v.note) msg += ` (${v.note})`;
    }
  }

  if (data.pendingReview > 0) {
    msg += `\n\n📋 Cần kiểm tra thủ công: ${data.pendingReview} mục`;
  }

  msg += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  return { replyMessage: msg };
}

async function sendScheduledProductivityReport(config) {
  const report = await handleProductivityReport(config);
  await notifyManagers(report.replyMessage, config);
  logger.info('Scheduled productivity report sent');
}

// ──────────────────────────────────────────────
// BAO CAO KE TOAN - xu ly file Excel tu phong ke toan
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

module.exports = {
  processVehicleEvent,
  checkTimeAlerts,
  handleTonKho,
  handleHelp,
  handleDailyReport,
  sendScheduledDailyReport,
  handleProductivityReport,
  sendScheduledProductivityReport,
  handleAccountingReport,
};
