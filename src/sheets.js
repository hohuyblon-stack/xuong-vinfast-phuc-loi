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

  // Đảm bảo 3 tab tồn tại với header đúng
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
        timeIn: row[3],
        priority: row[9],
      });
    }
  }
  return results;
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
  appendLogRow,
  updateLogResult,
  appendReviewRow,
  isMessageProcessed,
  COLUMNS,
};
