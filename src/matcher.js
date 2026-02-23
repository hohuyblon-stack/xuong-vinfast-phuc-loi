'use strict';

const sheets = require('./sheets');
const utils = require('./utils');
const logger = require('./logger');

/**
 * Xu ly 1 su kien xe vao/ra.
 */
async function processVehicleEvent(event, config) {
  const tz = config.timezone;
  const now = utils.nowFormatted(tz);
  const eventId = utils.generateEventId(tz);

  const { messageId, senderId, senderName, text, imageUrl, ocrResult } = event;
  const { action } = utils.parseMessage(text);
  const plate = ocrResult.plateText;
  const confidence = ocrResult.confidence;
  const confLabel = utils.confidenceLabel(confidence, config.ocr);

  let recordType = 'Khong xac dinh';
  if (action === 'VAO') recordType = 'Xe vao';
  else if (action === 'RA') recordType = 'Xe ra';

  // Buoc 1: Luon ghi NHAT KY truoc
  const originalMessage = `[MSG_ID:${messageId}] ${text || ''}`;

  await sheets.appendLogRow({
    eventId,
    timestamp: now,
    recordType,
    plateAI: plate,
    confidenceLabel: confLabel,
    imageUrl,
    sender: senderName || senderId,
    originalMessage,
    result: '',
  });

  // Buoc 2: Kiem tra cac case loi

  if (!action) {
    const errorId = utils.generateErrorId(tz);
    await sheets.appendReviewRow({
      errorId, eventId, timestamp: now, imageUrl, plateAI: plate,
      reason: 'Thieu tu khoa (VAO/RA)',
      suggestion: 'Chon dung VAO/RA',
      reviewStatus: 'Chua xu ly',
    });
    await sheets.updateLogResult(eventId, 'Thieu tu khoa VAO/RA');

    return {
      success: false,
      replyMessage: 'Tin nhan thieu tu khoa VAO hoac RA.\nGui anh kem VAO hoac RA.\n\nGo HELP de xem huong dan.',
      eventId,
    };
  }

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
      replyMessage: 'Khong doc ro bien so, vui long chup lai anh ro hon va gui kem VAO hoac RA.',
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
      suggestion: 'Sua bien so',
      reviewStatus: 'Chua xu ly',
    });
    await sheets.updateLogResult(eventId, 'Bien so sai format');

    return {
      success: false,
      replyMessage: `Bien so doc duoc (${plate}) khong dung dinh dang.\nVui long chup lai anh ro hon.`,
      eventId,
    };
  }

  // Buoc 3: Xu ly nghiep vu chinh
  if (action === 'VAO') {
    return await handleVehicleIn(eventId, plate, imageUrl, now, config);
  } else {
    return await handleVehicleOut(eventId, plate, imageUrl, now, config);
  }
}

/**
 * Xu ly Xe vao.
 */
async function handleVehicleIn(eventId, plate, imageUrl, now, config) {
  const vehicleId = utils.generateVehicleId(config.timezone);

  const existing = await sheets.findMainRow(plate, 'Dang trong xuong');
  let note = '';

  if (existing) {
    note = `Nghi trung voi ${existing.data.vehicleId}`;
    await sheets.updateMainRow(existing.rowIndex, {
      status: 'Trung / nghi trung',
      note: `Co luot vao moi: ${vehicleId}`,
      updatedAt: now,
    });

    const errorId = utils.generateErrorId(config.timezone);
    await sheets.appendReviewRow({
      errorId, eventId, timestamp: now, imageUrl, plateAI: plate,
      reason: 'Trung tin nhan / trung su kien',
      suggestion: 'Xac nhan trung hay khong',
      reviewStatus: 'Chua xu ly',
    });
  }

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
    note,
    updatedAt: now,
  });

  await sheets.updateLogResult(eventId, 'Da ghi vao danh sach');

  const replyMsg = existing
    ? `DA GHI: ${plate} VAO luc ${now}.\nLuu y: bien so nay da co 1 luot vao truoc do chua ra.`
    : `DA GHI: ${plate} VAO luc ${now}.\nMa luot: ${vehicleId}`;

  logger.info('Vehicle IN processed', { vehicleId, plate });
  return { success: true, replyMessage: replyMsg, eventId };
}

/**
 * Xu ly Xe ra.
 */
async function handleVehicleOut(eventId, plate, imageUrl, now, config) {
  const match = await sheets.findMainRow(plate, 'Dang trong xuong');

  if (!match) {
    const errorId = utils.generateErrorId(config.timezone);
    await sheets.appendReviewRow({
      errorId, eventId, timestamp: now, imageUrl, plateAI: plate,
      reason: "Khong tim thay luot 'Xe vao' de ghep",
      suggestion: 'Sua bien so',
      reviewStatus: 'Chua xu ly',
    });
    await sheets.updateLogResult(eventId, 'Khong ghep duoc (thieu luot vao)');

    return {
      success: false,
      replyMessage: `Khong tim thay luot Xe vao cho ${plate}.\nQuan ly se kiem tra. Vui long xac nhan lai bien so.`,
      eventId,
    };
  }

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
    replyMessage: `DA GHI: ${plate} RA luc ${now}.\nThoi gian luu: ${durationStr}\nMa luot: ${match.data.vehicleId}`,
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
// GHICHU - Them ghi chu cho xe
// ──────────────────────────────────────────────

async function handleGhiChu(params, config) {
  const parts = params.split('|').map(p => p.trim());
  const plateRaw = parts[0];
  const content = parts[1];

  if (!plateRaw || !content) {
    return {
      replyMessage: 'Sai format. Cach dung:\nGHICHU 30A-12345 | Cho bao hiem xac nhan\nGHICHU 30A-12345 | Len xuong Dong Son',
    };
  }

  const plate = utils.normalizePlate(plateRaw);
  if (!plate || !utils.isValidVietnamPlate(plate)) {
    return {
      replyMessage: `Bien so "${plateRaw}" khong hop le.\nVD: GHICHU 30A-12345 | Ly do`,
    };
  }

  const current = await sheets.findMainRow(plate, 'Dang trong xuong');
  if (!current) {
    return {
      replyMessage: `Khong tim thay xe ${plate} trong xuong.`,
    };
  }

  const now = utils.nowFormatted(config.timezone);
  await sheets.updateMainRow(current.rowIndex, {
    note: `[${now}] ${content}`,
    updatedAt: now,
  });

  logger.info('Note added', { plate, content });

  return {
    replyMessage: `DA GHI CHU cho ${plate}:\n"${content}"`,
  };
}

// ──────────────────────────────────────────────
// HELP
// ──────────────────────────────────────────────

function handleHelp() {
  const msg =
    `HUONG DAN SU DUNG\n` +
    `\n--- Ghi nhan xe ---` +
    `\nGui anh + VAO = Ghi xe vao` +
    `\nGui anh + RA = Ghi xe ra` +
    `\n\n--- Xem ton kho ---` +
    `\nTONKHO = Xem xe dang trong xuong` +
    `\n\n--- Ghi chu ---` +
    `\nGHICHU 30A-12345 | Ly do = Them ghi chu` +
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
// Thong bao cho quan ly qua Telegram
// ──────────────────────────────────────────────

async function notifyManagers(message, config) {
  const { sendMessage } = require('./zalo');
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
  handleGhiChu,
  handleHelp,
  handleDailyReport,
  sendScheduledDailyReport,
};
