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
    recordType: 'Chưa xác định',
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
      reason: 'Ảnh mờ / không thấy biển số',
      suggestion: 'Chụp lại ảnh',
      reviewStatus: 'Chưa xử lý',
    });
    await sheets.updateLogResult(eventId, 'Không đọc được biển số');

    return {
      success: false,
      replyMessage: 'Không đọc rõ biển số.\nVui lòng chụp lại ảnh rõ hơn, chụp thẳng vào biển số.',
      eventId,
    };
  }

  if (confidence < config.ocr.confidenceMedium) {
    const errorId = utils.generateErrorId(tz);
    await sheets.appendReviewRow({
      errorId, eventId, timestamp: now, imageUrl, plateAI: plate,
      reason: 'OCR đọc không chắc',
      suggestion: 'Chụp lại ảnh',
      reviewStatus: 'Chưa xử lý',
    });
    await sheets.updateLogResult(eventId, 'OCR mờ - chuyển kiểm tra');

    return {
      success: false,
      replyMessage: `Đọc biển số không chắc chắn: ${plate}\nVui lòng chụp lại ảnh rõ hơn.`,
      eventId,
    };
  }

  if (!utils.isValidVietnamPlate(plate)) {
    const errorId = utils.generateErrorId(tz);
    await sheets.appendReviewRow({
      errorId, eventId, timestamp: now, imageUrl, plateAI: plate,
      reason: 'Biển số không đúng định dạng',
      suggestion: 'Chụp lại ảnh',
      reviewStatus: 'Chưa xử lý',
    });
    await sheets.updateLogResult(eventId, 'Biển số sai định dạng');

    return {
      success: false,
      replyMessage: `Biển số đọc được (${plate}) không đúng định dạng.\nVui lòng chụp lại ảnh rõ hơn.`,
      eventId,
    };
  }

  // Buoc 3: Tu dong xac dinh VAO hay RA
  // Neu bien so dang trong xuong → RA, nguoc lai → VAO
  const existing = await sheets.findMainRow(plate, 'Đang trong xưởng');

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
    status: 'Đang trong xưởng',
    priority: 'Bình thường',
    note: '',
    updatedAt: now,
  });

  await sheets.updateLogResult(eventId, 'Đã ghi VÀO danh sách');

  logger.info('Vehicle IN processed', { vehicleId, plate });
  return {
    success: true,
    replyMessage: `Xe đã vào xưởng\nBiển số: ${plate}\nLúc: ${now}\nMã lượt: ${vehicleId}`,
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
    status: 'Đã ra xưởng',
    priority: 'Bình thường',
    updatedAt: now,
  });

  await sheets.updateLogResult(eventId, 'Đã ghép cặp thành công');

  const durationStr = utils.formatDuration(duration);
  logger.info('Vehicle OUT processed', { vehicleId: match.data.vehicleId, plate, duration });

  return {
    success: true,
    replyMessage: `Xe đã ra xưởng\nBiển số: ${plate}\nLúc: ${now}\nThời gian lưu: ${durationStr}\nMã lượt: ${match.data.vehicleId}`,
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
    return { replyMessage: 'Tồn kho: Hiện không có xe nào trong xưởng.' };
  }

  let msg = `Tồn kho: ${vehicles.length} xe trong xưởng\n`;

  for (const v of vehicles) {
    const hours = utils.hoursSince(v.timeIn, tz);
    const hStr = Math.floor(hours);
    const mStr = Math.round((hours % 1) * 60);
    let icon = '';
    if (v.priority === 'Khẩn') icon = '[KHẨN] ';
    else if (v.priority === 'Cảnh báo') icon = '[CB] ';
    msg += `\n${icon}${v.plate} - ${hStr}h${mStr}p - vào ${v.timeIn}`;
    if (v.note) msg += ` (${v.note})`;
  }

  return { replyMessage: msg };
}

// ──────────────────────────────────────────────
// HELP
// ──────────────────────────────────────────────

function handleHelp() {
  const msg =
    `HƯỚNG DẪN SỬ DỤNG\n` +
    `\n--- Ghi nhận xe ---` +
    `\nChụp ảnh biển số → Gửi (không cần ghi gì thêm)` +
    `\n  Lần 1: Tự động ghi XE VÀO` +
    `\n  Lần 2: Tự động ghi XE RA + thời gian lưu` +
    `\n\n--- Xem tồn kho ---` +
    `\nTONKHO = Xem xe đang trong xưởng` +
    `\n\n--- Báo cáo ---` +
    `\nBAOCAO = Báo cáo tổng hợp trong ngày` +
    `\nNANGSUAT = Báo cáo năng suất chi tiết` +
    `\n\n--- Khác ---` +
    `\nHELP = Xem hướng dẫn này`;

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
    let newPriority = 'Bình thường';

    if (hours >= config.alerts.urgentHours) {
      newPriority = 'Khẩn';
    } else if (hours >= config.alerts.warningHours) {
      newPriority = 'Cảnh báo';
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

      if (newPriority !== 'Bình thường') {
        const hStr = Math.floor(hours);
        const mStr = Math.round((hours % 1) * 60);
        const icon = newPriority === 'Khẩn' ? 'KHẨN' : 'CẢNH BÁO';
        const alertMsg =
          `[${icon}] Xe ${v.plate} đã trong xưởng ${hStr} giờ ${mStr} phút.\n` +
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

  let msg = `BÁO CÁO TỔNG HỢP - ${summary.today}\n`;
  msg += `\nXe vào hôm nay: ${summary.totalIn}`;
  msg += `\nXe ra hôm nay: ${summary.totalOut}`;
  msg += `\nĐang trong xưởng: ${summary.inWorkshop}`;

  if (summary.warningCount > 0) {
    msg += `\nCảnh báo (>24h): ${summary.warningCount}`;
  }
  if (summary.urgentCount > 0) {
    msg += `\nKhẩn (>48h): ${summary.urgentCount}`;
  }

  if (summary.avgDuration > 0) {
    msg += `\nTB thời gian hoàn thành: ${avgStr}`;
  }

  if (summary.pendingReview > 0) {
    msg += `\n\nCần kiểm tra: ${summary.pendingReview} mục chưa xử lý`;
  }

  const inWorkshop = await sheets.getAllInWorkshop();
  if (inWorkshop.length > 0) {
    msg += `\n\nDANH SÁCH XE TRONG XƯỞNG:`;
    for (const v of inWorkshop) {
      const hours = utils.hoursSince(v.timeIn, tz);
      const hStr = Math.floor(hours);
      const mStr = Math.round((hours % 1) * 60);
      let icon = '';
      if (v.priority === 'Khẩn') icon = '[KHẨN] ';
      else if (v.priority === 'Cảnh báo') icon = '[CB] ';
      msg += `\n${icon}${v.plate} - ${hStr}h${mStr}p`;
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
// Bao cao nang suat chi tiet (20h hang ngay)
// ──────────────────────────────────────────────

async function handleProductivityReport(config) {
  const tz = config.timezone;
  const data = await sheets.getProductivityData(tz);

  let msg = `BÁO CÁO NĂNG SUẤT XƯỞNG - ${data.today}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

  // Tổng quan
  msg += `\n📊 TỔNG QUAN:`;
  msg += `\n  Xe tiếp nhận hôm nay: ${data.todayIn}`;
  msg += `\n  Xe hoàn thành hôm nay: ${data.todayOut}`;
  msg += `\n  Đang trong xưởng: ${data.inWorkshop}`;
  msg += `\n  Tỷ lệ hoàn thành: ${data.completionRate}%`;

  // So sánh hôm qua
  msg += `\n\n📈 SO SÁNH VỚI HÔM QUA (${data.yesterday}):`;
  const diffIn = data.todayIn - data.yesterdayIn;
  const diffOut = data.todayOut - data.yesterdayOut;
  const arrowIn = diffIn > 0 ? `+${diffIn} ↑` : diffIn < 0 ? `${diffIn} ↓` : '= bằng';
  const arrowOut = diffOut > 0 ? `+${diffOut} ↑` : diffOut < 0 ? `${diffOut} ↓` : '= bằng';
  msg += `\n  Tiếp nhận: ${data.yesterdayIn} → ${data.todayIn} (${arrowIn})`;
  msg += `\n  Hoàn thành: ${data.yesterdayOut} → ${data.todayOut} (${arrowOut})`;

  // Thời gian xử lý
  if (data.completedCount > 0) {
    const avgStr = utils.formatDuration(data.avgDuration);
    msg += `\n\n⏱ THỜI GIAN XỬ LÝ:`;
    msg += `\n  Trung bình: ${avgStr}`;

    if (data.fastestVehicle) {
      msg += `\n  Nhanh nhất: ${data.fastestVehicle.plate} (${utils.formatDuration(data.fastestVehicle.duration)})`;
    }
    if (data.slowestVehicle) {
      msg += `\n  Chậm nhất: ${data.slowestVehicle.plate} (${utils.formatDuration(data.slowestVehicle.duration)})`;
    }

    if (data.yesterdayAvgDuration > 0) {
      const diffAvg = data.avgDuration - data.yesterdayAvgDuration;
      const avgArrow = diffAvg > 0 ? `chậm hơn ${utils.formatDuration(Math.abs(diffAvg))}` : diffAvg < 0 ? `nhanh hơn ${utils.formatDuration(Math.abs(diffAvg))}` : 'bằng hôm qua';
      msg += `\n  So với hôm qua: ${avgArrow}`;
    }
  }

  // Phân bố khung giờ
  if (data.todayIn > 0) {
    msg += `\n\n🕐 PHÂN BỐ KHUNG GIỜ TIẾP NHẬN:`;
    msg += `\n  Sáng (6h-12h): ${data.timeSlots.sang} xe`;
    msg += `\n  Chiều (12h-18h): ${data.timeSlots.chieu} xe`;
    msg += `\n  Tối (18h-24h): ${data.timeSlots.toi} xe`;
    if (data.timeSlots.dem > 0) {
      msg += `\n  Đêm (0h-6h): ${data.timeSlots.dem} xe`;
    }
  }

  // Cảnh báo
  if (data.warningCount > 0 || data.urgentCount > 0) {
    msg += `\n\n⚠ CẢNH BÁO:`;
    if (data.warningCount > 0) msg += `\n  Quá 24h: ${data.warningCount} xe`;
    if (data.urgentCount > 0) msg += `\n  KHẨN quá 48h: ${data.urgentCount} xe`;
  }

  // Xe đang trong xưởng
  if (data.inWorkshop > 0) {
    const inWorkshop = await sheets.getAllInWorkshop();
    msg += `\n\n🔧 XE ĐANG TRONG XƯỞNG (${inWorkshop.length}):`;
    for (const v of inWorkshop) {
      const hours = utils.hoursSince(v.timeIn, tz);
      const hStr = Math.floor(hours);
      const mStr = Math.round((hours % 1) * 60);
      let icon = '  ';
      if (v.priority === 'Khẩn') icon = '  ‼ ';
      else if (v.priority === 'Cảnh báo') icon = '  ! ';
      msg += `\n${icon}${v.plate} - ${hStr}h${mStr}p`;
      if (v.note) msg += ` (${v.note})`;
    }
  }

  // Cần kiểm tra
  if (data.pendingReview > 0) {
    msg += `\n\n📋 Cần kiểm tra thủ công: ${data.pendingReview} mục`;
  }

  msg += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
  msg += `\nXưởng VinFast Phúc Lợi - 55 Phúc Lợi, Long Biên`;

  return { replyMessage: msg };
}

async function sendScheduledProductivityReport(config) {
  const report = await handleProductivityReport(config);
  await notifyManagers(report.replyMessage, config);
  logger.info('Scheduled productivity report sent');
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

module.exports = {
  processVehicleEvent,
  checkTimeAlerts,
  handleTonKho,
  handleHelp,
  handleDailyReport,
  sendScheduledDailyReport,
  handleProductivityReport,
  sendScheduledProductivityReport,
};
