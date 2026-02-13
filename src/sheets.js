'use strict';

const { google } = require('googleapis');
const logger = require('./logger');

let sheetsApi = null;
let spreadsheetId = '';
let tabNames = {};

// ──────────────────────────────────────────────
// Column definitions cho mỗi tab
// ──────────────────────────────────────────────

const COLUMNS = {
  main: [
    'Mã lượt xe', 'Biển số', 'Loại xe', 'Giờ vào', 'Giờ ra',
    'Lưu trong xưởng (phút)', 'Ảnh lúc vào', 'Ảnh lúc ra',
    'Trạng thái', 'Mức ưu tiên', 'Ghi chú', 'Cập nhật lúc',
  ],
  log: [
    'Mã sự kiện', 'Thời điểm', 'Loại ghi nhận', 'Biển số (AI đọc)',
    'Chất lượng nhận dạng', 'Ảnh', 'Người gửi', 'Tin nhắn gốc', 'Kết quả xử lý',
  ],
  review: [
    'Mã lỗi', 'Mã sự kiện', 'Thời điểm', 'Ảnh', 'Biển số (AI đọc)',
    'Lý do', 'Hướng xử lý', 'Trạng thái xử lý', 'Ghi chú người kiểm tra',
  ],
  progress: [
    'Mã cập nhật', 'Mã lượt xe', 'Biển số', 'Thời điểm',
    'Nội dung cập nhật', 'Người cập nhật',
  ],
  staff: [
    'Zalo ID', 'Tên nhân viên', 'Vai trò', 'Trạng thái', 'Ngày thêm',
  ],
  customer: [
    'Biển số', 'SĐT khách hàng', 'Tên khách hàng', 'Ngày đăng ký', 'Ghi chú',
  ],
};

// ──────────────────────────────────────────────
// Init
// ──────────────────────────────────────────────

async function initSheets(config) {
  spreadsheetId = config.spreadsheetId;
  tabNames = config.tabNames;

  const auth = new google.auth.GoogleAuth({
    credentials: config.credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  sheetsApi = google.sheets({ version: 'v4', auth });

  // Đảm bảo tất cả tab tồn tại với header đúng
  await ensureTabs();
  logger.info('Google Sheets initialized', { spreadsheetId });
}

/**
 * Tạo tab nếu chưa có, ghi header nếu tab trống.
 */
async function ensureTabs() {
  const spreadsheet = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);

  const tabConfigs = [
    { key: 'main', name: tabNames.main, columns: COLUMNS.main },
    { key: 'log', name: tabNames.log, columns: COLUMNS.log },
    { key: 'review', name: tabNames.review, columns: COLUMNS.review },
    { key: 'progress', name: tabNames.progress, columns: COLUMNS.progress },
    { key: 'staff', name: tabNames.staff, columns: COLUMNS.staff },
    { key: 'customer', name: tabNames.customer, columns: COLUMNS.customer },
  ];

  const requests = [];
  for (const tab of tabConfigs) {
    if (!existingSheets.includes(tab.name)) {
      requests.push({
        addSheet: { properties: { title: tab.name } },
      });
    }
  }

  if (requests.length > 0) {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
    logger.info('Created missing tabs', { count: requests.length });
  }

  // Ghi header nếu tab trống
  for (const tab of tabConfigs) {
    const range = `'${tab.name}'!A1:${colLetter(tab.columns.length)}1`;
    const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
    if (!res.data.values || res.data.values.length === 0) {
      await sheetsApi.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        requestBody: { values: [tab.columns] },
      });
      logger.info(`Wrote header for tab "${tab.name}"`);
    }
  }
}

// ──────────────────────────────────────────────
// DANH SÁCH CHÍNH
// ──────────────────────────────────────────────

/**
 * Thêm 1 dòng vào "DANH SÁCH CHÍNH".
 * @param {object} row - { vehicleId, plate, vehicleType, timeIn, timeOut,
 *   duration, imageIn, imageOut, status, priority, note, updatedAt }
 */
async function appendMainRow(row) {
  const values = [[
    row.vehicleId,
    row.plate,
    row.vehicleType || '',
    row.timeIn || '',
    row.timeOut || '',
    row.duration || '',
    row.imageIn || '',
    row.imageOut || '',
    row.status || 'Đang trong xưởng',
    row.priority || 'Bình thường',
    row.note || '',
    row.updatedAt || '',
  ]];

  await sheetsApi.spreadsheets.values.append({
    spreadsheetId,
    range: `'${tabNames.main}'!A:L`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });

  logger.info('Appended main row', { vehicleId: row.vehicleId, plate: row.plate });
}

/**
 * Tìm dòng trong "DANH SÁCH CHÍNH" theo biển số + trạng thái.
 * Trả về { rowIndex (1-based, bao gồm header), data } hoặc null.
 */
async function findMainRow(plate, status) {
  const range = `'${tabNames.main}'!A:L`;
  const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values || [];

  // row[0]=header, data bắt đầu từ index 1
  for (let i = rows.length - 1; i >= 1; i--) {
    const row = rows[i];
    if (row[1] === plate && row[8] === status) {
      return {
        rowIndex: i + 1, // 1-based (row 1 = header, row 2 = data đầu tiên)
        data: {
          vehicleId: row[0],
          plate: row[1],
          vehicleType: row[2],
          timeIn: row[3],
          timeOut: row[4],
          duration: row[5],
          imageIn: row[6],
          imageOut: row[7],
          status: row[8],
          priority: row[9],
          note: row[10],
          updatedAt: row[11],
        },
      };
    }
  }
  return null;
}

/**
 * Cập nhật 1 dòng trong "DANH SÁCH CHÍNH" (partial update).
 * @param {number} rowIndex - 1-based row number
 * @param {object} updates - fields to update
 */
async function updateMainRow(rowIndex, updates) {
  // Đọc dòng hiện tại
  const range = `'${tabNames.main}'!A${rowIndex}:L${rowIndex}`;
  const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
  const current = (res.data.values && res.data.values[0]) || [];

  // Map field -> column index
  const fieldMap = {
    vehicleId: 0, plate: 1, vehicleType: 2, timeIn: 3, timeOut: 4,
    duration: 5, imageIn: 6, imageOut: 7, status: 8, priority: 9,
    note: 10, updatedAt: 11,
  };

  const updated = [...current];
  // Pad to 12 columns
  while (updated.length < 12) updated.push('');

  for (const [field, value] of Object.entries(updates)) {
    if (fieldMap[field] !== undefined) {
      updated[fieldMap[field]] = value;
    }
  }

  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: [updated] },
  });

  logger.info('Updated main row', { rowIndex, updates });
}

/**
 * Lấy tất cả xe "Đang trong xưởng" (để check cảnh báo).
 */
async function getAllInWorkshop() {
  const range = `'${tabNames.main}'!A:L`;
  const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values || [];
  const results = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[8] === 'Đang trong xưởng') {
      results.push({
        rowIndex: i + 1,
        vehicleId: row[0],
        plate: row[1],
        vehicleType: row[2],
        timeIn: row[3],
        priority: row[9],
      });
    }
  }
  return results;
}

/**
 * Lấy lịch sử tất cả lượt của 1 biển số (mới nhất trước).
 */
async function getVehicleHistory(plate) {
  const range = `'${tabNames.main}'!A:L`;
  const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values || [];
  const results = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[1] === plate) {
      results.push({
        vehicleId: row[0],
        plate: row[1],
        vehicleType: row[2],
        timeIn: row[3],
        timeOut: row[4],
        duration: row[5],
        status: row[8],
        priority: row[9],
        note: row[10],
      });
    }
  }

  return results.reverse(); // Mới nhất trước
}

/**
 * Lấy thống kê tổng hợp cho báo cáo.
 */
async function getDailySummary(tz) {
  const { DateTime } = require('luxon');
  const today = DateTime.now().setZone(tz).toFormat('dd/MM/yyyy');

  const range = `'${tabNames.main}'!A:L`;
  const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values || [];

  let totalIn = 0;
  let totalOut = 0;
  let inWorkshop = 0;
  let warningCount = 0;
  let urgentCount = 0;
  let totalDuration = 0;
  let completedCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const timeIn = row[3] || '';
    const timeOut = row[4] || '';
    const duration = parseInt(row[5], 10);
    const status = row[8] || '';
    const priority = row[9] || '';

    // Xe vào hôm nay
    if (timeIn.startsWith(today)) totalIn++;
    // Xe ra hôm nay
    if (timeOut.startsWith(today)) totalOut++;
    // Đang trong xưởng
    if (status === 'Đang trong xưởng') {
      inWorkshop++;
      if (priority === 'Cảnh báo') warningCount++;
      if (priority === 'Khẩn') urgentCount++;
    }
    // Tính trung bình thời gian hoàn thành (chỉ xe đã ra hôm nay)
    if (timeOut.startsWith(today) && !isNaN(duration)) {
      totalDuration += duration;
      completedCount++;
    }
  }

  // Đếm mục CẦN KIỂM TRA chưa xử lý
  const reviewRange = `'${tabNames.review}'!A:I`;
  const reviewRes = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: reviewRange });
  const reviewRows = reviewRes.data.values || [];
  let pendingReview = 0;
  for (let i = 1; i < reviewRows.length; i++) {
    if (reviewRows[i][7] === 'Chưa xử lý') pendingReview++;
  }

  return {
    today,
    totalIn,
    totalOut,
    inWorkshop,
    warningCount,
    urgentCount,
    pendingReview,
    avgDuration: completedCount > 0 ? Math.round(totalDuration / completedCount) : 0,
  };
}

// ──────────────────────────────────────────────
// NHẬT KÝ GHI NHẬN
// ──────────────────────────────────────────────

/**
 * Thêm 1 dòng vào "NHẬT KÝ GHI NHẬN".
 */
async function appendLogRow(row) {
  const values = [[
    row.eventId,
    row.timestamp,
    row.recordType || 'Không xác định',
    row.plateAI || '',
    row.confidenceLabel || '',
    row.imageUrl || '',
    row.sender || '',
    row.originalMessage || '',
    row.result || '',
  ]];

  await sheetsApi.spreadsheets.values.append({
    spreadsheetId,
    range: `'${tabNames.log}'!A:I`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });

  logger.info('Appended log row', { eventId: row.eventId });
}

/**
 * Cập nhật cột "Kết quả xử lý" cho 1 sự kiện đã ghi.
 */
async function updateLogResult(eventId, result) {
  const range = `'${tabNames.log}'!A:I`;
  const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values || [];

  for (let i = rows.length - 1; i >= 1; i--) {
    if (rows[i][0] === eventId) {
      const rowIndex = i + 1;
      await sheetsApi.spreadsheets.values.update({
        spreadsheetId,
        range: `'${tabNames.log}'!I${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[result]] },
      });
      logger.info('Updated log result', { eventId, result });
      return;
    }
  }
}

// ──────────────────────────────────────────────
// CẦN KIỂM TRA
// ──────────────────────────────────────────────

/**
 * Thêm 1 dòng vào "CẦN KIỂM TRA".
 */
async function appendReviewRow(row) {
  const values = [[
    row.errorId,
    row.eventId,
    row.timestamp,
    row.imageUrl || '',
    row.plateAI || '',
    row.reason || '',
    row.suggestion || '',
    row.reviewStatus || 'Chưa xử lý',
    row.reviewNote || '',
  ]];

  await sheetsApi.spreadsheets.values.append({
    spreadsheetId,
    range: `'${tabNames.review}'!A:I`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });

  logger.info('Appended review row', { errorId: row.errorId, reason: row.reason });
}

// ──────────────────────────────────────────────
// TIẾN ĐỘ SỬA CHỮA
// ──────────────────────────────────────────────

/**
 * Thêm 1 dòng cập nhật tiến độ sửa chữa.
 */
async function appendProgressRow(row) {
  const values = [[
    row.progressId,
    row.vehicleId || '',
    row.plate,
    row.timestamp,
    row.content,
    row.updatedBy || '',
  ]];

  await sheetsApi.spreadsheets.values.append({
    spreadsheetId,
    range: `'${tabNames.progress}'!A:F`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });

  logger.info('Appended progress row', { progressId: row.progressId, plate: row.plate });
}

/**
 * Lấy tiến độ sửa chữa cho 1 biển số (mới nhất trước).
 */
async function getProgressByPlate(plate) {
  const range = `'${tabNames.progress}'!A:F`;
  const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values || [];
  const results = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[2] === plate) {
      results.push({
        progressId: row[0],
        vehicleId: row[1],
        plate: row[2],
        timestamp: row[3],
        content: row[4],
        updatedBy: row[5],
      });
    }
  }

  return results.reverse(); // Mới nhất trước
}

// ──────────────────────────────────────────────
// NHÂN VIÊN
// ──────────────────────────────────────────────

/**
 * Tìm nhân viên theo Zalo ID.
 */
async function getStaffByZaloId(zaloId) {
  const range = `'${tabNames.staff}'!A:E`;
  const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values || [];

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === zaloId && rows[i][3] === 'Hoạt động') {
      return {
        zaloId: rows[i][0],
        name: rows[i][1],
        role: rows[i][2],
        status: rows[i][3],
      };
    }
  }
  return null;
}

/**
 * Lấy tất cả nhân viên đang hoạt động.
 */
async function getAllActiveStaff() {
  const range = `'${tabNames.staff}'!A:E`;
  const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values || [];
  const results = [];

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][3] === 'Hoạt động') {
      results.push({
        zaloId: rows[i][0],
        name: rows[i][1],
        role: rows[i][2],
      });
    }
  }
  return results;
}

// ──────────────────────────────────────────────
// KHÁCH HÀNG
// ──────────────────────────────────────────────

/**
 * Đăng ký / cập nhật SĐT khách hàng cho 1 biển số.
 */
async function registerCustomer(plate, phone, name, timestamp) {
  // Kiểm tra đã tồn tại chưa
  const existing = await getCustomerByPlate(plate);
  if (existing) {
    // Cập nhật SĐT
    const range = `'${tabNames.customer}'!A:E`;
    const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
    const rows = res.data.values || [];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === plate) {
        const rowIndex = i + 1;
        await sheetsApi.spreadsheets.values.update({
          spreadsheetId,
          range: `'${tabNames.customer}'!B${rowIndex}:D${rowIndex}`,
          valueInputOption: 'RAW',
          requestBody: { values: [[phone, name || existing.name, timestamp]] },
        });
        logger.info('Updated customer', { plate, phone });
        return 'updated';
      }
    }
  }

  // Thêm mới
  const values = [[plate, phone, name || '', timestamp, '']];
  await sheetsApi.spreadsheets.values.append({
    spreadsheetId,
    range: `'${tabNames.customer}'!A:E`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });

  logger.info('Registered customer', { plate, phone });
  return 'created';
}

/**
 * Tìm khách hàng theo biển số.
 */
async function getCustomerByPlate(plate) {
  const range = `'${tabNames.customer}'!A:E`;
  const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values || [];

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === plate) {
      return {
        plate: rows[i][0],
        phone: rows[i][1],
        name: rows[i][2],
        registeredAt: rows[i][3],
      };
    }
  }
  return null;
}

// ──────────────────────────────────────────────
// Idempotency check (dùng NHẬT KÝ GHI NHẬN)
// ──────────────────────────────────────────────

/**
 * Kiểm tra message_id đã được xử lý chưa (tìm trong cột "Tin nhắn gốc").
 * Lưu message_id trong originalMessage với prefix [MSG_ID:xxx]
 */
async function isMessageProcessed(messageId) {
  const range = `'${tabNames.log}'!H:H`;
  const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values || [];

  const marker = `[MSG_ID:${messageId}]`;
  for (const row of rows) {
    if (row[0] && row[0].includes(marker)) {
      return true;
    }
  }
  return false;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function colLetter(n) {
  let result = '';
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

module.exports = {
  initSheets,
  appendMainRow,
  findMainRow,
  updateMainRow,
  getAllInWorkshop,
  getVehicleHistory,
  getDailySummary,
  appendLogRow,
  updateLogResult,
  appendReviewRow,
  appendProgressRow,
  getProgressByPlate,
  getStaffByZaloId,
  getAllActiveStaff,
  registerCustomer,
  getCustomerByPlate,
  isMessageProcessed,
  COLUMNS,
};
