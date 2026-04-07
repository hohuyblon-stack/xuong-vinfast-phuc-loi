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
    'Mã lượt xe', 'Biển số', 'Giờ vào', 'Giờ ra',
    'Lưu trong xưởng (phút)', 'Ảnh lúc vào', 'Ảnh lúc ra',
    'Trạng thái', 'Mức ưu tiên', 'Ghi chú', 'Cập nhật lúc',
  ],
  completed: [
    'Mã lượt xe', 'Biển số', 'Giờ vào', 'Giờ ra',
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

// Old tab names → new tab names (for migration)
const TAB_RENAMES = {
  'DANH SÁCH CHÍNH': 'ĐANG TRONG XƯỞNG',
  'ĐÃ HOÀN THÀNH': 'ĐÃ RA XƯỞNG',
};

/**
 * Tao tab neu chua co, ghi header neu tab trong.
 * Tu dong rename tab cu neu gap (migration).
 */
async function ensureTabs() {
  const spreadsheet = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const sheets = spreadsheet.data.sheets;
  const existingNames = sheets.map(s => s.properties.title);

  // Rename old tabs if found (one-time migration)
  const renameRequests = [];
  for (const s of sheets) {
    const oldName = s.properties.title;
    const newName = TAB_RENAMES[oldName];
    if (newName && !existingNames.includes(newName)) {
      renameRequests.push({
        updateSheetProperties: {
          properties: { sheetId: s.properties.sheetId, title: newName },
          fields: 'title',
        },
      });
      logger.info(`Renaming tab "${oldName}" → "${newName}"`);
    }
  }
  if (renameRequests.length > 0) {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: renameRequests },
    });
    // Refresh names after rename
    const refreshed = await sheetsApi.spreadsheets.get({ spreadsheetId });
    existingNames.length = 0;
    existingNames.push(...refreshed.data.sheets.map(s => s.properties.title));
  }

  const tabConfigs = [
    { key: 'main', name: tabNames.main, columns: COLUMNS.main },
    { key: 'completed', name: tabNames.completed, columns: COLUMNS.completed },
    { key: 'log', name: tabNames.log, columns: COLUMNS.log },
    { key: 'review', name: tabNames.review, columns: COLUMNS.review },
    { key: 'dashboard', name: 'TỔNG QUAN', columns: null }, // no header — fully managed by dashboard
  ];

  const addRequests = [];
  for (const tab of tabConfigs) {
    if (!existingNames.includes(tab.name)) {
      addRequests.push({
        addSheet: { properties: { title: tab.name } },
      });
    }
  }

  if (addRequests.length > 0) {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: addRequests },
    });
    logger.info('Created missing tabs', { count: addRequests.length });
  }

  for (const tab of tabConfigs) {
    if (!tab.columns) continue; // dashboard tab has no fixed header
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
    range: `'${tabNames.main}'!A:K`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });

  logger.info('Appended main row', { vehicleId: row.vehicleId, plate: row.plate });
}

/**
 * Batch update priorities — 1 read + 1 batchUpdate thay vi N*2 calls.
 * @param {Array<{plate: string, priority: string, updatedAt: string}>} changes
 */
async function batchUpdatePriorities(changes) {
  if (!changes.length) return;

  // 1 API call: read toàn bộ main sheet
  const range = `'${tabNames.main}'!A:K`;
  const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values || [];

  // Build plate → rowIndex map
  const plateToRow = new Map();
  for (let i = rows.length - 1; i >= 1; i--) {
    const plate = rows[i][1];
    const status = rows[i][7];
    if (status === 'Đang trong xưởng' && !plateToRow.has(plate)) {
      plateToRow.set(plate, i + 1); // 1-based
    }
  }

  // Build batch data
  const data = [];
  for (const c of changes) {
    const rowIndex = plateToRow.get(c.plate);
    if (!rowIndex) continue;
    data.push({
      range: `'${tabNames.main}'!I${rowIndex}:K${rowIndex}`,
      values: [[c.priority, rows[rowIndex - 1][9] || '', c.updatedAt]],
    });
  }

  if (!data.length) return;

  // 1 API call: batch update all priorities
  await sheetsApi.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data,
    },
  });

  logger.info('Batch updated priorities', { count: data.length });
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

// updateLogResult REMOVED — log tab is append-only, result stored in DB

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

// isMessageProcessed REMOVED — idempotency check uses DB

// ──────────────────────────────────────────────
// Archive (xe đã ra)
// ──────────────────────────────────────────────

/**
 * Append a completed vehicle row to the "ĐÃ HOÀN THÀNH" tab.
 */
async function archiveCompletedVehicle(rowData) {
  const values = [[
    rowData.vehicleId || '',
    rowData.plate || '',
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
    range: `'${tabNames.completed}'!A:K`,
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
// TỔNG QUAN (Dashboard tab — full rewrite each time)
// ──────────────────────────────────────────────

/**
 * Write the dashboard tab. Clears all content, writes blocks, applies formatting.
 * Moves tab to index 0 (first position).
 *
 * @param {string} tabName - Tab name (TỔNG QUAN)
 * @param {Array<Array<string>>} rows - All rows to write (flat array of row arrays)
 * @param {Array<{type: string, startRow: number, endRow: number, level?: string, columns?: number}>} blockPositions
 */
async function writeDashboardTab(tabName, rows, blockPositions) {
  // 1. Get or create tab
  const spreadsheet = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const existing = spreadsheet.data.sheets;
  let sheetId = null;
  let currentIndex = -1;

  for (const s of existing) {
    if (s.properties.title === tabName) {
      sheetId = s.properties.sheetId;
      currentIndex = s.properties.index;
      break;
    }
  }

  if (sheetId == null) {
    const addRes = await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tabName } } }],
      },
    });
    sheetId = addRes.data.replies[0].addSheet.properties.sheetId;
    logger.info(`Created dashboard tab: "${tabName}"`);
  }

  // 2. Clear entire tab
  await sheetsApi.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${tabName}'`,
  });

  // 3. Determine max columns across all rows
  const maxCols = Math.max(...rows.map(r => r.length), 2);
  const endCol = colLetter(maxCols);

  // 4. Write all rows at once
  if (rows.length > 0) {
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tabName}'!A1:${endCol}${rows.length}`,
      valueInputOption: 'RAW',
      requestBody: { values: rows },
    });
  }

  // 5. Apply formatting + move tab to index 0
  try {
    const { buildDashboardFormatting } = require('./sheets-format');
    const formatRequests = buildDashboardFormatting(sheetId, blockPositions, rows.length, maxCols);

    // Move tab to first position
    if (currentIndex !== 0) {
      formatRequests.push({
        updateSheetProperties: {
          properties: { sheetId, index: 0 },
          fields: 'index',
        },
      });
    }

    if (formatRequests.length > 0) {
      await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: formatRequests },
      });
    }
  } catch (err) {
    logger.error('Dashboard formatting failed (non-blocking)', { error: err.message });
  }

  logger.info('Dashboard tab written', { tabName, rows: rows.length });
}

/**
 * Rewrite the main tab (ĐANG TRONG XƯỞNG) as a sorted snapshot.
 * Keeps header row (row 1), clears data rows (row 2+), writes sorted data.
 *
 * @param {Array<Array<string>>} rows - Data rows (without header)
 */
async function rewriteMainTab(rows) {
  const mainTabName = tabNames.main;

  // Clear data rows (keep header at row 1)
  try {
    await sheetsApi.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${mainTabName}'!A2:K`,
    });
  } catch (err) {
    // Tab might be empty — that's fine
    logger.warn('Clear main tab data rows failed (non-blocking)', { error: err.message });
  }

  if (rows.length === 0) return;

  // Write sorted data starting at row 2
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `'${mainTabName}'!A2:K${rows.length + 1}`,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });

  logger.info('Main tab rewritten as snapshot', { rows: rows.length });
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
  batchUpdatePriorities,
  appendLogRow,
  appendReviewRow,
  writeDailyReportTab,
  archiveCompletedVehicle,
  deleteMainRow,
  getSheetIdByName,
  writeDashboardTab,
  rewriteMainTab,
};
