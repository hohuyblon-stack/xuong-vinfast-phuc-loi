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
      replyMessage: 'Khong doc ro bien so.\nVui long chup lai anh ro hon, chup thang vao bien so.',
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
      replyMessage: `Doc bien so khong chac chan: ${plate}\nVui long chup lai anh ro hon.`,
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
      replyMessage: `Bien so doc duoc (${plate}) khong dung dinh dang.\nVui long chup lai anh ro hon.`,
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
    replyMessage: `DA GHI VAO: ${plate}\nLuc: ${now}\nMa luot: ${vehicleId}`,
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
    replyMessage: `DA GHI RA: ${plate}\nLuc: ${now}\nThoi gian luu: ${durationStr}\nMa luot: ${match.data.vehicleId}`,
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
    return { replyMessage: 'TON KHO: Hien khong co xe nao trong xuong.' };
  }

  let msg = `TON KHO: ${vehicles.length} xe trong xuong\n`;

  for (const v of vehicles) {
    const hours = utils.hoursSince(v.timeIn, tz);
    const hStr = Math.floor(hours);
    const mStr = Math.round((hours % 1) * 60);
    let icon = '';
    if (v.priority === 'Khan') icon = '[KHAN] ';
    else if (v.priority === 'Canh bao') icon = '[CB] ';
    msg += `\n${icon}${v.plate} - ${hStr}h${mStr}p - vao ${v.timeIn}`;
    if (v.note) msg += ` (${v.note})`;
  }

  return { replyMessage: msg };
}

// ──────────────────────────────────────────────
// HELP
// ──────────────────────────────────────────────

function handleHelp() {
  const msg =
    `HUONG DAN SU DUNG\n` +
    `\n--- Ghi nhan xe ---` +
    `\nChup anh bien so → Gui (khong can ghi gi them)` +
    `\n  Lan 1: Tu dong ghi XE VAO` +
    `\n  Lan 2: Tu dong ghi XE RA + thoi gian luu` +
    `\n\n--- Xem ton kho ---` +
    `\nTONKHO = Xem xe dang trong xuong` +
    `\n\n--- Khac ---` +
    `\nHELP = Xem huong dan nay`;

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
        const icon = newPriority === 'Khan' ? 'KHAN' : 'CANH BAO';
        const alertMsg =
          `[${icon}] Xe ${v.plate} da trong xuong ${hStr} gio ${mStr} phut.\n` +
          `Vao luc: ${v.timeIn}\nMa luot: ${v.vehicleId}`;
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

  let msg = `BAO CAO TONG HOP - ${summary.today}\n`;
  msg += `\nXe vao hom nay: ${summary.totalIn}`;
  msg += `\nXe ra hom nay: ${summary.totalOut}`;
  msg += `\nDang trong xuong: ${summary.inWorkshop}`;

  if (summary.warningCount > 0) {
    msg += `\nCanh bao (>24h): ${summary.warningCount}`;
  }
  if (summary.urgentCount > 0) {
    msg += `\nKhan (>48h): ${summary.urgentCount}`;
  }

  if (summary.avgDuration > 0) {
    msg += `\nTB thoi gian hoan thanh: ${avgStr}`;
  }

  if (summary.pendingReview > 0) {
    msg += `\n\nCan kiem tra: ${summary.pendingReview} muc chua xu ly`;
  }

  const inWorkshop = await sheets.getAllInWorkshop();
  if (inWorkshop.length > 0) {
    msg += `\n\nDANH SACH XE TRONG XUONG:`;
    for (const v of inWorkshop) {
      const hours = utils.hoursSince(v.timeIn, tz);
      const hStr = Math.floor(hours);
      const mStr = Math.round((hours % 1) * 60);
      let icon = '';
      if (v.priority === 'Khan') icon = '[KHAN] ';
      else if (v.priority === 'Canh bao') icon = '[CB] ';
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

  let msg = `BAO CAO NANG SUAT XUONG - ${data.today}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

  // Tong quan
  msg += `\n📊 TONG QUAN:`;
  msg += `\n  Xe tiep nhan hom nay: ${data.todayIn}`;
  msg += `\n  Xe hoan thanh hom nay: ${data.todayOut}`;
  msg += `\n  Dang trong xuong: ${data.inWorkshop}`;
  msg += `\n  Ty le hoan thanh: ${data.completionRate}%`;

  // So sanh hom qua
  msg += `\n\n📈 SO SANH VOI HOM QUA (${data.yesterday}):`;
  const diffIn = data.todayIn - data.yesterdayIn;
  const diffOut = data.todayOut - data.yesterdayOut;
  const arrowIn = diffIn > 0 ? `+${diffIn} ↑` : diffIn < 0 ? `${diffIn} ↓` : '= bang';
  const arrowOut = diffOut > 0 ? `+${diffOut} ↑` : diffOut < 0 ? `${diffOut} ↓` : '= bang';
  msg += `\n  Tiep nhan: ${data.yesterdayIn} → ${data.todayIn} (${arrowIn})`;
  msg += `\n  Hoan thanh: ${data.yesterdayOut} → ${data.todayOut} (${arrowOut})`;

  // Thoi gian xu ly
  if (data.completedCount > 0) {
    const avgStr = utils.formatDuration(data.avgDuration);
    msg += `\n\n⏱ THOI GIAN XU LY:`;
    msg += `\n  Trung binh: ${avgStr}`;

    if (data.fastestVehicle) {
      msg += `\n  Nhanh nhat: ${data.fastestVehicle.plate} (${utils.formatDuration(data.fastestVehicle.duration)})`;
    }
    if (data.slowestVehicle) {
      msg += `\n  Cham nhat: ${data.slowestVehicle.plate} (${utils.formatDuration(data.slowestVehicle.duration)})`;
    }

    if (data.yesterdayAvgDuration > 0) {
      const diffAvg = data.avgDuration - data.yesterdayAvgDuration;
      const avgArrow = diffAvg > 0 ? `cham hon ${utils.formatDuration(Math.abs(diffAvg))}` : diffAvg < 0 ? `nhanh hon ${utils.formatDuration(Math.abs(diffAvg))}` : 'bang hom qua';
      msg += `\n  So voi hom qua: ${avgArrow}`;
    }
  }

  // Phan bo khung gio
  if (data.todayIn > 0) {
    msg += `\n\n🕐 PHAN BO KHUNG GIO TIEP NHAN:`;
    msg += `\n  Sang (6h-12h): ${data.timeSlots.sang} xe`;
    msg += `\n  Chieu (12h-18h): ${data.timeSlots.chieu} xe`;
    msg += `\n  Toi (18h-24h): ${data.timeSlots.toi} xe`;
    if (data.timeSlots.dem > 0) {
      msg += `\n  Dem (0h-6h): ${data.timeSlots.dem} xe`;
    }
  }

  // Canh bao
  if (data.warningCount > 0 || data.urgentCount > 0) {
    msg += `\n\n⚠ CANH BAO:`;
    if (data.warningCount > 0) msg += `\n  Qua 24h: ${data.warningCount} xe`;
    if (data.urgentCount > 0) msg += `\n  KHAN qua 48h: ${data.urgentCount} xe`;
  }

  // Xe dang trong xuong
  if (data.inWorkshop > 0) {
    const inWorkshop = await sheets.getAllInWorkshop();
    msg += `\n\n🔧 XE DANG TRONG XUONG (${inWorkshop.length}):`;
    for (const v of inWorkshop) {
      const hours = utils.hoursSince(v.timeIn, tz);
      const hStr = Math.floor(hours);
      const mStr = Math.round((hours % 1) * 60);
      let icon = '  ';
      if (v.priority === 'Khan') icon = '  ‼ ';
      else if (v.priority === 'Canh bao') icon = '  ! ';
      msg += `\n${icon}${v.plate} - ${hStr}h${mStr}p`;
      if (v.note) msg += ` (${v.note})`;
    }
  }

  // Pending review
  if (data.pendingReview > 0) {
    msg += `\n\n📋 Can kiem tra thu cong: ${data.pendingReview} muc`;
  }

  msg += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
  msg += `\nXuong VinFast Phuc Loi - 55 Phuc Loi, Long Bien`;

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
