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

  const { messageId, senderId, senderName, imageUrl, ocrResult } = event;
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
  const existing = await sheets.findMainRow(plate, 'Dang trong xuong');

  if (existing) {
    return await handleVehicleOut(eventId, plate, imageUrl, now, config, existing);
  } else {
    return await handleVehicleIn(eventId, plate, imageUrl, now, config);
  }
}

/**
 * Ghi xe VAO.
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
 * Ghi xe RA.
 */
async function handleVehicleOut(eventId, plate, imageUrl, now, config, match) {
  const duration = utils.calcMinutesBetween(match.data.timeIn, now);

  await sheets.updateMainRow(match.rowIndex, {
    timeOut: now,
    duration: duration.toString(),
    imageOut: imageUrl,
    status: 'Da ra xuong',
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

module.exports = {
  processVehicleEvent,
};
