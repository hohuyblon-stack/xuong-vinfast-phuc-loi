'use strict';

const { google } = require('googleapis');
const logger = require('./logger');

let sheetsApi = null;
let spreadsheetId = '';
let tabNames = {};

// ──────────────────────────────────────────────
// Column definitions cho moi tab
// ──────────────────────────────────────────────

const COLUMNS = {
  main: [
    'Mã lượt xe', 'Biển số', 'Loại xe', 'Giờ vào', 'Giờ ra',
    'Lưu trong xưởng (phút)', 'Ảnh lúc vào', 'Ảnh lúc ra',
    'Trạng thái', 'Mức ưu tiên', 'Ghi chú', 'Cập nhật lúc',
  ],
  completed: [
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
    'Biển số (đúng)', 'Lý do', 'Hướng xử lý', 'Trạng thái xử lý', 'Ghi chú',
    'Người xử lý', 'Thời điểm xử lý', 'Liên kết lượt xe',
  ],
  dailyReport: [
    'STT', 'Loại', 'Biển Số', 'Loại xe', 'Giờ Vào', 'Giờ Ra',
    'Thời gian', 'Ưu Tiên', 'Trạng Thái', 'Ghi chú',
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

  await ensureTabs();
  logger.info('Google Sheets initialized', { spreadsheetId });
}

/**
 * Tao tab neu chua co, ghi header neu tab trong.
 */
async function ensureTabs() {
  const spreadsheet = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);

  const tabConfigs = [
    { key: 'main', name: tabNames.main, columns: COLUMNS.main },
    { key: 'completed', name: tabNames.completed, columns: COLUMNS.completed },
    { key: 'log', name: tabNames.log, columns: COLUMNS.log },
    { key: 'review', name: tabNames.review, columns: COLUMNS.review },
    // dailyReport: mỗi ngày tạo tab riêng trong writeDailyReportTab()
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

      // Apply professional formatting to main + completed tabs
      if (tab.key === 'main' || tab.key === 'completed') {
        try {
          const sid = await getSheetIdByName(tab.name);
          if (sid != null) {
            const { buildMainSheetFormatting } = require('./sheets-format');
            const fmtRequests = buildMainSheetFormatting(sid, 2, tab.columns.length);
            if (fmtRequests.length > 0) {
              await sheetsApi.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: { requests: fmtRequests },
              });
            }
          }
        } catch (err) {
          logger.error('Tab formatting failed (non-blocking)', { tab: tab.name, error: err.message });
        }
      }
    }
  }
}

// ──────────────────────────────────────────────
// DANH SACH CHINH (11 columns: A-K)
// ──────────────────────────────────────────────

/**
 * Them 1 dong vao "DANH SACH CHINH".
 */
async function appendMainRow(row) {
  const values = [[
    row.vehicleId,
    row.plate,
    row.vehicleModel || '',
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
 * Tim dong theo bien so + trang thai.
 * Tra ve { rowIndex (1-based), data } hoac null.
 */
async function findMainRow(plate, status) {
  const range = `'${tabNames.main}'!A:L`;
  const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values || [];

  for (let i = rows.length - 1; i >= 1; i--) {
    const row = rows[i];
    if (row[1] === plate && row[8] === status) {
      return {
        rowIndex: i + 1,
        data: {
          vehicleId: row[0],
          plate: row[1],
          vehicleModel: row[2],
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
 * Cap nhat 1 dong (partial update).
 */
async function updateMainRow(rowIndex, updates) {
  const range = `'${tabNames.main}'!A${rowIndex}:L${rowIndex}`;
  const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
  const current = (res.data.values && res.data.values[0]) || [];

  const fieldMap = {
    vehicleId: 0, plate: 1, vehicleModel: 2, timeIn: 3, timeOut: 4,
    duration: 5, imageIn: 6, imageOut: 7, status: 8,
    priority: 9, note: 10, updatedAt: 11,
  };

  const updated = [...current];
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
 * Lay tat ca xe "Dang trong xuong".
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
        vehicleModel: row[2],
        timeIn: row[3],
        priority: row[9],
        note: row[10] || '',
      });
    }
  }
  return results;
}

/**
 * Lay tat ca dong trong DANH SACH CHINH (ca vao lan ra).
 * Dung cho bao cao ke toan.
 */
async function getAllMainRows() {
  const range = `'${tabNames.main}'!A:L`;
  const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values || [];
  const results = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[1]) continue;
    results.push({
      rowIndex: i + 1,
      vehicleId: row[0] || '',
      plate:     row[1] || '',
      vehicleModel: row[2] || '',
      timeIn:    row[3] || '',
      timeOut:   row[4] || '',
      duration:  row[5] || '',
      status:    row[8] || '',
      priority:  row[9] || '',
      note:      row[10] || '',
    });
  }
  return results;
}

/**
 * Lay thong ke tong hop.
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

    if (timeIn.startsWith(today)) totalIn++;
    if (timeOut.startsWith(today)) totalOut++;
    if (status === 'Đang trong xưởng') {
      inWorkshop++;
      if (priority === 'Cảnh báo') warningCount++;
      if (priority === 'Khẩn') urgentCount++;
    }
    if (timeOut.startsWith(today) && !isNaN(duration)) {
      totalDuration += duration;
      completedCount++;
    }
  }

  const reviewRange = `'${tabNames.review}'!A:M`;
  const reviewRes = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: reviewRange });
  const reviewRows = reviewRes.data.values || [];
  let pendingReview = 0;
  for (let i = 1; i < reviewRows.length; i++) {
    if (reviewRows[i][8] === 'Chưa xử lý') pendingReview++;
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

/**
 * Lay du lieu nang suat chi tiet cho bao cao NANGSUAT.
 */
async function getProductivityData(tz) {
  const { DateTime } = require('luxon');
  const now = DateTime.now().setZone(tz);
  const today = now.toFormat('dd/MM/yyyy');
  const yesterday = now.minus({ days: 1 }).toFormat('dd/MM/yyyy');

  const range = `'${tabNames.main}'!A:L`;
  const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values || [];

  let todayIn = 0;
  let todayOut = 0;
  let inWorkshop = 0;
  let warningCount = 0;
  let urgentCount = 0;
  let totalDuration = 0;
  let completedCount = 0;
  let fastestVehicle = null;
  let slowestVehicle = null;

  let yesterdayIn = 0;
  let yesterdayOut = 0;
  let yesterdayTotalDuration = 0;
  let yesterdayCompletedCount = 0;

  const timeSlots = { sang: 0, chieu: 0, toi: 0, dem: 0 };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const plate = row[1] || '';
    const timeIn = row[3] || '';
    const timeOut = row[4] || '';
    const duration = parseInt(row[5], 10);
    const status = row[8] || '';
    const priority = row[9] || '';

    if (timeIn.startsWith(today)) {
      todayIn++;
      const hourMatch = timeIn.match(/\d{2}\/\d{2}\/\d{4} (\d{2}):/);
      if (hourMatch) {
        const h = parseInt(hourMatch[1], 10);
        if (h >= 6 && h < 12) timeSlots.sang++;
        else if (h >= 12 && h < 18) timeSlots.chieu++;
        else if (h >= 18) timeSlots.toi++;
        else timeSlots.dem++;
      }
    }
    if (timeOut.startsWith(today)) todayOut++;
    if (timeIn.startsWith(yesterday)) yesterdayIn++;
    if (timeOut.startsWith(yesterday)) yesterdayOut++;

    if (status === 'Đang trong xưởng') {
      inWorkshop++;
      if (priority === 'Cảnh báo') warningCount++;
      if (priority === 'Khẩn') urgentCount++;
    }

    if (timeOut.startsWith(today) && !isNaN(duration)) {
      totalDuration += duration;
      completedCount++;
      if (!fastestVehicle || duration < fastestVehicle.duration) fastestVehicle = { plate, duration };
      if (!slowestVehicle || duration > slowestVehicle.duration) slowestVehicle = { plate, duration };
    }

    if (timeOut.startsWith(yesterday) && !isNaN(duration)) {
      yesterdayTotalDuration += duration;
      yesterdayCompletedCount++;
    }
  }

  const reviewRange = `'${tabNames.review}'!A:M`;
  const reviewRes = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: reviewRange });
  const reviewRows = reviewRes.data.values || [];
  let pendingReview = 0;
  for (let i = 1; i < reviewRows.length; i++) {
    if (reviewRows[i][8] === 'Chưa xử lý') pendingReview++;
  }

  return {
    today,
    yesterday,
    todayIn,
    todayOut,
    inWorkshop,
    warningCount,
    urgentCount,
    pendingReview,
    completedCount,
    avgDuration: completedCount > 0 ? Math.round(totalDuration / completedCount) : 0,
    fastestVehicle,
    slowestVehicle,
    timeSlots,
    yesterdayIn,
    yesterdayOut,
    yesterdayAvgDuration: yesterdayCompletedCount > 0
      ? Math.round(yesterdayTotalDuration / yesterdayCompletedCount) : 0,
    completionRate: todayIn > 0 ? Math.round((todayOut / todayIn) * 100) : 0,
  };
}

// ──────────────────────────────────────────────
// NHAT KY
// ──────────────────────────────────────────────

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
// CAN KIEM TRA
// ──────────────────────────────────────────────

async function appendReviewRow(row) {
  const values = [[
    row.errorId,
    row.eventId,
    row.timestamp,
    row.imageUrl || '',
    row.plateAI || '',
    row.correctedPlate || '',
    row.reason || '',
    row.suggestion || '',
    row.reviewStatus || 'Chưa xử lý',
    row.reviewNote || '',
    row.reviewer || '',
    row.resolvedAt || '',
    row.linkedVehicleId || '',
  ]];

  await sheetsApi.spreadsheets.values.append({
    spreadsheetId,
    range: `'${tabNames.review}'!A:M`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });

  logger.info('Appended review row', { errorId: row.errorId, reason: row.reason });
}

// ──────────────────────────────────────────────
// BÁO CÁO HÀNG NGÀY — mỗi ngày 1 tab riêng
// ──────────────────────────────────────────────

/**
 * Tạo tab mới cho ngày báo cáo (VD: "BC 20-03-2026"), ghi header + data.
 * Nếu tab đã tồn tại thì bỏ qua (idempotent).
 */
async function writeDailyReportTab(tabName, rows, sectionRowIndices, summaryRowIndex) {
  // Tạo tab mới nếu chưa có
  const spreadsheet = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const existing = spreadsheet.data.sheets.map(s => s.properties.title);

  let newSheetId = null;
  if (!existing.includes(tabName)) {
    const addRes = await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tabName } } }],
      },
    });
    newSheetId = addRes.data.replies[0].addSheet.properties.sheetId;
    logger.info(`Created daily report tab: "${tabName}"`);
  }

  // Ghi header + data (10 cột mới)
  const header = COLUMNS.dailyReport;
  const values = [
    header,
    ...rows.map(r => [
      r.stt || '',
      r.type || '',
      r.plate || '',
      r.vehicleModel || '',
      r.timeIn || '',
      r.timeOut || '',
      r.duration || '',
      r.priority || '',
      r.status || '',
      r.note || '',
    ]),
  ];

  const range = `'${tabName}'!A1:${colLetter(header.length)}${values.length}`;
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: { values },
  });

  // Apply formatting
  try {
    const sheetId = newSheetId != null ? newSheetId : await getSheetIdByName(tabName);
    if (sheetId != null) {
      const { buildDailyReportFormatting } = require('./sheets-format');
      const formatRequests = buildDailyReportFormatting(
        sheetId,
        values.length,
        header.length,
        sectionRowIndices || [],
        summaryRowIndex != null ? summaryRowIndex : values.length - 1,
      );

      if (formatRequests.length > 0) {
        await sheetsApi.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: formatRequests },
        });
      }
    }
  } catch (err) {
    logger.error('Daily report formatting failed (non-blocking)', { error: err.message });
  }

  logger.info('Wrote daily report tab', { tabName, rows: rows.length });
}

// ──────────────────────────────────────────────
// Idempotency check
// ──────────────────────────────────────────────

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
// Archive (xe đã ra → ĐÃ HOÀN THÀNH)
// ──────────────────────────────────────────────

/**
 * Append a completed vehicle row to the "ĐÃ HOÀN THÀNH" tab.
 */
async function archiveCompletedVehicle(rowData) {
  const values = [[
    rowData.vehicleId || '',
    rowData.plate || '',
    rowData.vehicleModel || '',
    rowData.timeIn || '',
    rowData.timeOut || '',
    rowData.duration || '',
    rowData.imageIn || '',
    rowData.imageOut || '',
    rowData.status || 'Đã ra xưởng',
    rowData.priority || '',
    rowData.note || '',
    rowData.updatedAt || '',
  ]];

  await sheetsApi.spreadsheets.values.append({
    spreadsheetId,
    range: `'${tabNames.completed}'!A:L`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });

  logger.info('Archived completed vehicle', { plate: rowData.plate });
}

/**
 * Delete a row from "DANH SÁCH CHÍNH" by row index (1-based).
 */
async function deleteMainRow(rowIndex) {
  const sheetId = await getSheetIdByName(tabNames.main);
  if (sheetId == null) {
    logger.error('deleteMainRow: could not find main sheet ID');
    return;
  }

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: rowIndex - 1, // 0-based
            endIndex: rowIndex,       // exclusive
          },
        },
      }],
    },
  });

  logger.info('Deleted main row', { rowIndex });
}

/**
 * Get the sheetId (numeric) for a tab by name.
 */
async function getSheetIdByName(name) {
  const spreadsheet = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const sheet = spreadsheet.data.sheets.find(s => s.properties.title === name);
  return sheet ? sheet.properties.sheetId : null;
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
  getAllMainRows,
  appendLogRow,
  updateLogResult,
  appendReviewRow,
  writeDailyReportTab,
  archiveCompletedVehicle,
  deleteMainRow,
  getSheetIdByName,
};
