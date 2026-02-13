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

  // Lấy tên người gửi (nếu có trong tab NHÂN VIÊN)
  const staffName = await getStaffName(senderId);

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
    sender: staffName || senderId,
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
      replyMessage: '⚠ Tin nhắn thiếu từ khóa VAO hoặc RA.\nVui lòng gửi lại theo format:\nVAO hoặc RA (kèm ảnh biển số)\n\nGõ HUONGDAN để xem tất cả lệnh.',
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

  const durationStr = utils.formatDuration(duration);

  logger.info('Vehicle OUT processed', { vehicleId: match.data.vehicleId, plate, duration });

  // Thông báo khách hàng nếu có đăng ký SĐT
  if (config.manager.customerNotifyOnExit) {
    notifyCustomerOnExit(plate, durationStr, now, config).catch(err => {
      logger.error('Customer notification failed', { error: err.message, plate });
    });
  }

  return {
    success: true,
    replyMessage: `✅ Đã ghi Xe ra cho ${plate} lúc ${now}.\nThời gian lưu: ${durationStr}\nMã lượt: ${match.data.vehicleId}`,
    eventId,
  };
}

// ──────────────────────────────────────────────
// TRACUU - Tra cứu trạng thái xe
// ──────────────────────────────────────────────

async function handleLookup(params, senderId, config) {
  const plate = utils.normalizePlate(params);
  if (!plate || !utils.isValidVietnamPlate(plate)) {
    return {
      replyMessage: '⚠ Vui lòng nhập biển số hợp lệ.\nVD: TRACUU 30A-12345',
    };
  }

  // Tìm xe đang trong xưởng
  const current = await sheets.findMainRow(plate, 'Đang trong xưởng');

  // Lấy lịch sử
  const history = await sheets.getVehicleHistory(plate);

  // Lấy tiến độ sửa chữa
  const progress = await sheets.getProgressByPlate(plate);

  let msg = `🔍 Tra cứu: ${plate}\n`;

  if (current) {
    const hours = utils.hoursSince(current.data.timeIn, config.timezone);
    const hStr = Math.floor(hours);
    const mStr = Math.round((hours % 1) * 60);
    msg += `\n📍 ĐANG TRONG XƯỞNG`;
    msg += `\nVào lúc: ${current.data.timeIn}`;
    msg += `\nĐã lưu: ${hStr} giờ ${mStr} phút`;
    msg += `\nMức ưu tiên: ${current.data.priority}`;
    if (current.data.vehicleType) msg += `\nLoại xe: ${current.data.vehicleType}`;
    msg += `\nMã lượt: ${current.data.vehicleId}`;
  } else {
    msg += `\n📍 Không có xe này trong xưởng hiện tại.`;
  }

  // Tiến độ sửa chữa
  if (progress.length > 0) {
    msg += `\n\n🔧 TIẾN ĐỘ SỬA CHỮA (${progress.length} cập nhật):`;
    const recent = progress.slice(0, 3); // 3 cập nhật gần nhất
    for (const p of recent) {
      msg += `\n- ${p.timestamp}: ${p.content}`;
    }
    if (progress.length > 3) {
      msg += `\n... và ${progress.length - 3} cập nhật khác`;
    }
  }

  // Lịch sử
  if (history.length > 0) {
    const completed = history.filter(h => h.status === 'Đã ra xưởng');
    msg += `\n\n📋 LỊCH SỬ: ${history.length} lượt (${completed.length} hoàn thành)`;
    const recentHistory = history.slice(0, 3);
    for (const h of recentHistory) {
      const dur = h.duration ? ` (${utils.formatDuration(h.duration)})` : '';
      msg += `\n- ${h.timeIn} | ${h.status}${dur}`;
    }
  } else {
    msg += `\n\n📋 Chưa có lịch sử.`;
  }

  return { replyMessage: msg };
}

// ──────────────────────────────────────────────
// CAPNHAT - Cập nhật tiến độ sửa chữa
// ──────────────────────────────────────────────

async function handleProgressUpdate(params, senderId, config) {
  // Format: "30A-12345|Đang kiểm tra"
  const parts = params.split('|').map(p => p.trim());
  const plateRaw = parts[0];
  const content = parts[1];

  if (!plateRaw || !content) {
    return {
      replyMessage: '⚠ Sai format. Cách dùng:\nCAPNHAT 30A-12345 | Đang kiểm tra\nCAPNHAT 30A-12345 | Chờ phụ tùng\nCAPNHAT 30A-12345 | Hoàn thành',
    };
  }

  const plate = utils.normalizePlate(plateRaw);
  if (!plate || !utils.isValidVietnamPlate(plate)) {
    return {
      replyMessage: `⚠ Biển số "${plateRaw}" không hợp lệ.\nVD: CAPNHAT 30A-12345 | Đang sửa`,
    };
  }

  // Tìm xe đang trong xưởng
  const current = await sheets.findMainRow(plate, 'Đang trong xưởng');
  const vehicleId = current ? current.data.vehicleId : '';

  // Lấy tên nhân viên
  const staffName = await getStaffName(senderId);

  const tz = config.timezone;
  const now = utils.nowFormatted(tz);
  const progressId = utils.generateProgressId(tz);

  await sheets.appendProgressRow({
    progressId,
    vehicleId,
    plate,
    timestamp: now,
    content,
    updatedBy: staffName || senderId,
  });

  // Cập nhật ghi chú trong DANH SÁCH CHÍNH
  if (current) {
    await sheets.updateMainRow(current.rowIndex, {
      note: `[${now}] ${content}`,
      updatedAt: now,
    });
  }

  logger.info('Progress updated', { progressId, plate, content });

  let msg = `✅ Đã cập nhật tiến độ cho ${plate}:\n"${content}"\nMã: ${progressId}`;
  if (!current) {
    msg += `\n⚠ Lưu ý: xe này không có trong xưởng hiện tại.`;
  }

  // Gửi thông báo cho quản lý
  notifyManagers(
    `🔧 Cập nhật tiến độ:\nXe: ${plate}\nNội dung: ${content}\nNgười cập nhật: ${staffName || senderId}\nLúc: ${now}`,
    config
  ).catch(err => logger.error('Manager notification failed', { error: err.message }));

  return { replyMessage: msg };
}

// ──────────────────────────────────────────────
// DANGKY - Đăng ký SĐT khách hàng
// ──────────────────────────────────────────────

async function handleCustomerRegister(params, senderId, config) {
  // Format: "30A-12345|0901234567" hoặc "30A-12345|0901234567|Tên khách"
  const parts = params.split('|').map(p => p.trim());
  const plateRaw = parts[0];
  const phone = parts[1];
  const name = parts[2] || '';

  if (!plateRaw || !phone) {
    return {
      replyMessage: '⚠ Sai format. Cách dùng:\nDANGKY 30A-12345 | 0901234567\nDANGKY 30A-12345 | 0901234567 | Tên khách',
    };
  }

  const plate = utils.normalizePlate(plateRaw);
  if (!plate || !utils.isValidVietnamPlate(plate)) {
    return {
      replyMessage: `⚠ Biển số "${plateRaw}" không hợp lệ.\nVD: DANGKY 30A-12345 | 0901234567`,
    };
  }

  // Validate SĐT Việt Nam cơ bản
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  if (cleanPhone.length < 9 || cleanPhone.length > 11) {
    return {
      replyMessage: `⚠ SĐT "${phone}" không hợp lệ.\nVui lòng nhập SĐT 10-11 số.`,
    };
  }

  const tz = config.timezone;
  const now = utils.nowFormatted(tz);

  const result = await sheets.registerCustomer(plate, cleanPhone, name, now);

  const action = result === 'updated' ? 'Cập nhật' : 'Đăng ký';
  let msg = `✅ ${action} thành công!\nBiển số: ${plate}\nSĐT: ${cleanPhone}`;
  if (name) msg += `\nTên: ${name}`;
  msg += `\n\nKhi xe ${plate} ra xưởng, hệ thống sẽ tự động thông báo cho khách.`;

  return { replyMessage: msg };
}

// ──────────────────────────────────────────────
// BAOCAO - Báo cáo tổng hợp
// ──────────────────────────────────────────────

async function handleDailyReport(senderId, config) {
  const tz = config.timezone;
  const summary = await sheets.getDailySummary(tz);
  const avgStr = utils.formatDuration(summary.avgDuration);

  let msg = `📊 BÁO CÁO TỔNG HỢP - ${summary.today}\n`;
  msg += `\n🚗 Xe vào hôm nay: ${summary.totalIn}`;
  msg += `\n🚗 Xe ra hôm nay: ${summary.totalOut}`;
  msg += `\n📍 Đang trong xưởng: ${summary.inWorkshop}`;

  if (summary.warningCount > 0) {
    msg += `\n⚠ Cảnh báo (>4h): ${summary.warningCount}`;
  }
  if (summary.urgentCount > 0) {
    msg += `\n🔴 Khẩn (>8h): ${summary.urgentCount}`;
  }

  if (summary.avgDuration > 0) {
    msg += `\n⏱ TB thời gian hoàn thành: ${avgStr}`;
  }

  if (summary.pendingReview > 0) {
    msg += `\n\n📋 Cần kiểm tra: ${summary.pendingReview} mục chưa xử lý`;
  }

  // Liệt kê xe đang trong xưởng
  const inWorkshop = await sheets.getAllInWorkshop();
  if (inWorkshop.length > 0) {
    msg += `\n\n📍 DANH SÁCH XE TRONG XƯỞNG:`;
    for (const v of inWorkshop) {
      const hours = utils.hoursSince(v.timeIn, tz);
      const hStr = Math.floor(hours);
      const mStr = Math.round((hours % 1) * 60);
      const icon = v.priority === 'Khẩn' ? '🔴' : v.priority === 'Cảnh báo' ? '⚠' : '🟢';
      msg += `\n${icon} ${v.plate} - ${hStr}h${mStr}m`;
    }
  }

  return { replyMessage: msg };
}

// ──────────────────────────────────────────────
// HUONGDAN - Hướng dẫn sử dụng
// ──────────────────────────────────────────────

function handleHelp() {
  const msg =
    `📋 HƯỚNG DẪN SỬ DỤNG\n` +
    `\n──── Ghi nhận xe ────` +
    `\n📸 Gửi ảnh + VAO → Ghi xe vào` +
    `\n📸 Gửi ảnh + RA → Ghi xe ra` +
    `\n📸 VAO | xe tải → Ghi xe vào kèm loại xe` +
    `\n\n──── Tra cứu ────` +
    `\nTRACUU 30A-12345 → Xem trạng thái xe` +
    `\nBAOCAO → Xem báo cáo tổng hợp` +
    `\n\n──── Cập nhật ────` +
    `\nCAPNHAT 30A-12345 | Đang sửa → Cập nhật tiến độ` +
    `\nCAPNHAT 30A-12345 | Chờ phụ tùng` +
    `\nCAPNHAT 30A-12345 | Hoàn thành` +
    `\n\n──── Khách hàng ────` +
    `\nDANGKY 30A-12345 | 0901234567 → Đăng ký SĐT khách` +
    `\nDANGKY 30A-12345 | 0901234567 | Tên khách` +
    `\n(Khi xe ra, tự động thông báo cho khách)` +
    `\n\n──── Khác ────` +
    `\nHUONGDAN hoặc HELP → Xem lại hướng dẫn này`;

  return { replyMessage: msg };
}

// ──────────────────────────────────────────────
// Kiểm tra cảnh báo + gửi Zalo cho quản lý
// ──────────────────────────────────────────────

/**
 * Kiểm tra cảnh báo thời gian lưu cho tất cả xe trong xưởng.
 * Gọi định kỳ (cron) hoặc mỗi khi có event.
 * Gửi Zalo cho quản lý khi mức ưu tiên thay đổi.
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

      // Gửi cảnh báo cho quản lý qua Zalo
      if (newPriority !== 'Bình thường') {
        const hStr = Math.floor(hours);
        const mStr = Math.round((hours % 1) * 60);
        const icon = newPriority === 'Khẩn' ? '🔴 KHẨN' : '⚠ CẢNH BÁO';
        const alertMsg =
          `${icon}: Xe ${v.plate} đã trong xưởng ${hStr} giờ ${mStr} phút.\n` +
          `Vào lúc: ${v.timeIn}\n` +
          `Mã lượt: ${v.vehicleId}`;
        notifyManagers(alertMsg, config).catch(err => {
          logger.error('Manager alert notification failed', { error: err.message });
        });
      }
    }
  }

  return updated;
}

// ──────────────────────────────────────────────
// Báo cáo tự động cuối ngày
// ──────────────────────────────────────────────

async function sendScheduledDailyReport(config) {
  const report = await handleDailyReport(null, config);
  await notifyManagers(report.replyMessage, config);
  logger.info('Scheduled daily report sent');
}

// ──────────────────────────────────────────────
// Thông báo cho quản lý
// ──────────────────────────────────────────────

async function notifyManagers(message, config) {
  const { sendReply } = require('./zalo');
  const managerIds = config.manager.zaloIds;
  if (managerIds.length === 0) return;

  for (const managerId of managerIds) {
    await sendReply(managerId, message, config.zalo.accessToken);
  }
  logger.info('Notified managers', { count: managerIds.length });
}

// ──────────────────────────────────────────────
// Thông báo khách hàng khi xe ra
// ──────────────────────────────────────────────

async function notifyCustomerOnExit(plate, durationStr, now, config) {
  const customer = await sheets.getCustomerByPlate(plate);
  if (!customer || !customer.phone) return;

  // Ghi log (không gửi SMS thực vì cần tích hợp Zalo ZNS)
  // Tương lai: tích hợp Zalo ZNS để gửi notification qua SĐT
  logger.info('Customer exit notification (logged)', {
    plate,
    phone: customer.phone,
    name: customer.name,
    duration: durationStr,
  });

  // Gửi thông báo cho quản lý rằng khách đã được ghi nhận
  const msg =
    `📱 Xe ${plate} đã ra xưởng (${durationStr}).\n` +
    `Khách hàng: ${customer.name || 'Chưa có tên'}\n` +
    `SĐT: ${customer.phone}\n` +
    `Hãy gọi cho khách để thông báo lấy xe.`;
  await notifyManagers(msg, config);
}

// ──────────────────────────────────────────────
// Helper: Lấy tên nhân viên từ Zalo ID
// ──────────────────────────────────────────────

async function getStaffName(senderId) {
  try {
    const staff = await sheets.getStaffByZaloId(senderId);
    return staff ? staff.name : null;
  } catch {
    return null;
  }
}

module.exports = {
  processVehicleEvent,
  checkTimeAlerts,
  handleLookup,
  handleProgressUpdate,
  handleCustomerRegister,
  handleDailyReport,
  handleHelp,
  sendScheduledDailyReport,
};
