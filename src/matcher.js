'use strict';

const sheets = require('./sheets');
const utils = require('./utils');
const logger = require('./logger');

/**
 * Xử lý 1 sự kiện xe vào/ra.
 *
 * @param {object} event
 * @param {string} event.messageId    - Zalo message ID
 * @param {string} event.senderId     - Zalo sender (user_id)
 * @param {string} event.text         - Nội dung tin nhắn (VAO / RA / ...)
 * @param {string} event.imageUrl     - URL ảnh biển số
 * @param {object} event.ocrResult    - { plateText, confidence, rawTexts }
 * @param {object} config             - App config
 *
 * @returns {object} { success, replyMessage, eventId }
 */
async function processVehicleEvent(event, config) {
  const tz = config.timezone;
  const now = utils.nowFormatted(tz);
  const eventId = utils.generateEventId(tz);

  const { messageId, senderId, text, imageUrl, ocrResult } = event;
  const { action, vehicleType } = utils.parseMessage(text);
  const plate = ocrResult.plateText;
  const confidence = ocrResult.confidence;
  const confLabel = utils.confidenceLabel(confidence, config.ocr);

  // Xác định loại ghi nhận
  let recordType = 'Không xác định';
  if (action === 'VAO') recordType = 'Xe vào';
  else if (action === 'RA') recordType = 'Xe ra';

  // ═══════════ BƯỚC 1: Luôn ghi NHẬT KÝ GHI NHẬN trước ═══════════
  const originalMessage = `[MSG_ID:${messageId}] ${text || ''}`;

  await sheets.appendLogRow({
    eventId,
    timestamp: now,
    recordType,
    plateAI: plate,
    confidenceLabel: confLabel,
    imageUrl,
    sender: senderId,
    originalMessage,
    result: '', // Cập nhật sau
  });

  // ═══════════ BƯỚC 2: Kiểm tra các case lỗi ═══════════

  // Case: Thiếu từ khóa VAO/RA
  if (!action) {
    const errorId = utils.generateErrorId(tz);
    await sheets.appendReviewRow({
      errorId,
      eventId,
      timestamp: now,
      imageUrl,
      plateAI: plate,
      reason: 'Thiếu từ khóa (VAO/RA)',
      suggestion: 'Chọn đúng VAO/RA',
      reviewStatus: 'Chưa xử lý',
    });
    await sheets.updateLogResult(eventId, 'Thiếu từ khóa VAO/RA - đã chuyển kiểm tra');

    return {
      success: false,
      replyMessage: '⚠ Tin nhắn thiếu từ khóa VAO hoặc RA.\nVui lòng gửi lại theo format:\nVAO hoặc RA (kèm ảnh biển số)',
      eventId,
    };
  }

  // Case: Không đọc được biển số (OCR fail hoặc confidence rất thấp)
  if (!plate) {
    const errorId = utils.generateErrorId(tz);
    await sheets.appendReviewRow({
      errorId,
      eventId,
      timestamp: now,
      imageUrl,
      plateAI: '',
      reason: 'Ảnh mờ / không thấy biển số',
      suggestion: 'Chụp lại ảnh',
      reviewStatus: 'Chưa xử lý',
    });
    await sheets.updateLogResult(eventId, 'Không đọc được biển số');

    return {
      success: false,
      replyMessage: '⚠ Không đọc rõ biển số, vui lòng chụp lại ảnh rõ hơn và gửi kèm VAO hoặc RA.',
      eventId,
    };
  }

  // Case: OCR confidence thấp (đọc được nhưng không chắc)
  if (confidence < config.ocr.confidenceMedium) {
    const errorId = utils.generateErrorId(tz);
    await sheets.appendReviewRow({
      errorId,
      eventId,
      timestamp: now,
      imageUrl,
      plateAI: plate,
      reason: 'OCR đọc không chắc',
      suggestion: 'Chụp lại ảnh',
      reviewStatus: 'Chưa xử lý',
    });
    await sheets.updateLogResult(eventId, 'OCR mờ - đã chuyển kiểm tra');

    return {
      success: false,
      replyMessage: `⚠ Đọc biển số không chắc chắn: ${plate}\nVui lòng chụp lại ảnh rõ hơn hoặc quản lý sẽ kiểm tra.`,
      eventId,
    };
  }

  // Case: Biển số không đúng format Việt Nam
  if (!utils.isValidVietnamPlate(plate)) {
    const errorId = utils.generateErrorId(tz);
    await sheets.appendReviewRow({
      errorId,
      eventId,
      timestamp: now,
      imageUrl,
      plateAI: plate,
      reason: 'Biển số không đúng định dạng',
      suggestion: 'Sửa biển số',
      reviewStatus: 'Chưa xử lý',
    });
    await sheets.updateLogResult(eventId, 'Biển số sai format - đã chuyển kiểm tra');

    return {
      success: false,
      replyMessage: `⚠ Biển số đọc được (${plate}) không đúng định dạng.\nVui lòng chụp lại ảnh rõ hơn.`,
      eventId,
    };
  }

  // ═══════════ BƯỚC 3: Xử lý nghiệp vụ chính ═══════════

  if (action === 'VAO') {
    return await handleVehicleIn(eventId, plate, vehicleType, imageUrl, now, config);
  } else {
    return await handleVehicleOut(eventId, plate, imageUrl, now, config);
  }
}

/**
 * Xử lý Xe vào.
 */
async function handleVehicleIn(eventId, plate, vehicleType, imageUrl, now, config) {
  const vehicleId = utils.generateVehicleId(config.timezone);

  // Kiểm tra trùng: đã có xe cùng biển số "Đang trong xưởng"?
  const existing = await sheets.findMainRow(plate, 'Đang trong xưởng');
  let note = '';
  let status = 'Đang trong xưởng';

  if (existing) {
    // Đánh dấu trùng/nghi trùng cho lượt cũ
    note = `Nghi trùng với ${existing.data.vehicleId} (đang trong xưởng)`;
    await sheets.updateMainRow(existing.rowIndex, {
      status: 'Trùng / nghi trùng',
      note: `Có lượt vào mới: ${vehicleId}`,
      updatedAt: now,
    });

    // Ghi review
    const errorId = utils.generateErrorId(config.timezone);
    await sheets.appendReviewRow({
      errorId,
      eventId,
      timestamp: now,
      imageUrl,
      plateAI: plate,
      reason: 'Trùng tin nhắn / trùng sự kiện',
      suggestion: 'Xác nhận trùng hay không',
      reviewStatus: 'Chưa xử lý',
    });
  }

  // Tạo lượt mới
  await sheets.appendMainRow({
    vehicleId,
    plate,
    vehicleType,
    timeIn: now,
    timeOut: '',
    duration: '',
    imageIn: imageUrl,
    imageOut: '',
    status,
    priority: 'Bình thường',
    note,
    updatedAt: now,
  });

  await sheets.updateLogResult(eventId, 'Đã ghi vào danh sách');

  const replyMsg = existing
    ? `✅ Đã ghi Xe vào cho ${plate} lúc ${now}.\n⚠ Lưu ý: biển số này đã có 1 lượt vào trước đó chưa ra.`
    : `✅ Đã ghi Xe vào cho ${plate} lúc ${now}.\nMã lượt: ${vehicleId}`;

  logger.info('Vehicle IN processed', { vehicleId, plate });

  return { success: true, replyMessage: replyMsg, eventId };
}

/**
 * Xử lý Xe ra.
 */
async function handleVehicleOut(eventId, plate, imageUrl, now, config) {
  // Tìm lượt vào gần nhất cùng biển số, trạng thái "Đang trong xưởng"
  const match = await sheets.findMainRow(plate, 'Đang trong xưởng');

  if (!match) {
    // Không tìm thấy lượt vào -> CẦN KIỂM TRA
    const errorId = utils.generateErrorId(config.timezone);
    await sheets.appendReviewRow({
      errorId,
      eventId,
      timestamp: now,
      imageUrl,
      plateAI: plate,
      reason: "Không tìm thấy lượt 'Xe vào' để ghép",
      suggestion: 'Sửa biển số',
      reviewStatus: 'Chưa xử lý',
    });
    await sheets.updateLogResult(eventId, "Không ghép được (thiếu lượt vào)");

    return {
      success: false,
      replyMessage: `⚠ Không tìm thấy lượt Xe vào cho ${plate}.\nQuản lý sẽ kiểm tra. Vui lòng xác nhận lại biển số.`,
      eventId,
    };
  }

  // Ghép cặp thành công
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

  const hours = Math.floor(duration / 60);
  const mins = duration % 60;
  const durationStr = hours > 0 ? `${hours} giờ ${mins} phút` : `${mins} phút`;

  logger.info('Vehicle OUT processed', { vehicleId: match.data.vehicleId, plate, duration });

  return {
    success: true,
    replyMessage: `✅ Đã ghi Xe ra cho ${plate} lúc ${now}.\nThời gian lưu: ${durationStr}\nMã lượt: ${match.data.vehicleId}`,
    eventId,
  };
}

/**
 * Kiểm tra cảnh báo thời gian lưu cho tất cả xe trong xưởng.
 * Gọi định kỳ (cron) hoặc mỗi khi có event.
 */
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
    }
  }

  return updated;
}

module.exports = { processVehicleEvent, checkTimeAlerts };
