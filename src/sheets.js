'use strict';

const { google } = require('googleapis');
const logger = require('./logger');

let sheetsApi = null;
let spreadsheetId = '';
let tabNames = {};

// Cache sheetId theo tên tab — tránh gọi spreadsheets.get() mỗi lần
const sheetIdCache = new Map();

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

  // Nạp cache sheetId ngay khi khởi động
  for (const s of sheets) {
    sheetIdCache.set(s.properties.title, s.properties.sheetId);
  }

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
  const values = [
    row.eventId,
    row.timestamp,
    row.recordType || 'Không xác định',
    row.plateAI || '',
    row.confidenceLabel || '',
    row.imageUrl || '',
    row.sender || '',
    row.originalMessage || '',
    row.result || '',
  ];

  await prependRow(tabNames.log, values, COLUMNS.log.length);
  logger.info('Ghi nhật ký (mới nhất trên đầu)', { eventId: row.eventId });
}

// updateLogResult REMOVED — log tab is append-only, result stored in DB

// ──────────────────────────────────────────────
// CAN KIEM TRA
// ──────────────────────────────────────────────

async function appendReviewRow(row) {
  const values = [
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
  ];

  await prependRow(tabNames.review, values, COLUMNS.review.length);
  logger.info('Ghi cần kiểm tra (mới nhất trên đầu)', { errorId: row.errorId, reason: row.reason });
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
  const values = [
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
  ];

  await prependRow(tabNames.completed, values, COLUMNS.completed.length);
  logger.info('Xe đã ra xưởng (mới nhất trên đầu)', { plate: rowData.plate });
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
 * Lấy sheetId (số) theo tên tab. Dùng cache để tránh gọi API mỗi lần.
 * Cache được nạp khi initSheets() và khi tạo tab mới.
 */
async function getSheetIdByName(name) {
  if (sheetIdCache.has(name)) return sheetIdCache.get(name);

  const spreadsheet = await sheetsApi.spreadsheets.get({ spreadsheetId });
  // Nạp lại toàn bộ cache
  for (const s of spreadsheet.data.sheets) {
    sheetIdCache.set(s.properties.title, s.properties.sheetId);
  }
  return sheetIdCache.get(name) ?? null;
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

  // 2. Clear entire tab: values + stale merges from prior runs.
  //    Leftover merges cause values.update to discard columns B+ on merged rows.
  await sheetsApi.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${tabName}'`,
  });

  // Unmerge all cells so the next write isn't corrupted by stale merges
  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        unmergeCells: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 9999, startColumnIndex: 0, endColumnIndex: 26 },
        },
      }],
    },
  });

  // 3. Determine max columns and normalize all rows to same width.
  //    Mixed-length rows (hero=2 cols, tables=6 cols) cause the Sheets API
  //    to corrupt trailing data in subsequent rows. Pad every row to maxCols.
  const maxCols = Math.max(...rows.map(r => r.length), 2);
  const endCol = colLetter(maxCols);
  const normalized = rows.map(r => {
    if (r.length >= maxCols) return r;
    const padded = [...r];
    while (padded.length < maxCols) padded.push('');
    return padded;
  });

  // 4. Write all rows at once
  if (normalized.length > 0) {
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tabName}'!A1:${endCol}${normalized.length}`,
      valueInputOption: 'RAW',
      requestBody: { values: normalized },
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

/**
 * Chèn 1 dòng vào đầu tab (sau header) — mới nhất trên đầu.
 * Bước 1: insertDimension tạo dòng trống ở row 2
 * Bước 2: values.update ghi dữ liệu vào dòng mới
 */
async function prependRow(tabName, values, colCount) {
  const sheetId = await getSheetIdByName(tabName);
  if (sheetId == null) {
    logger.error('prependRow: không tìm thấy tab', { tabName });
    return;
  }

  // Chèn 1 dòng trống sau header (row index 1 = dòng 2)
  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        insertDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2 },
          inheritFromBefore: false,
        },
      }],
    },
  });

  // Ghi dữ liệu vào dòng vừa chèn
  const endCol = colLetter(colCount);
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tabName}'!A2:${endCol}2`,
    valueInputOption: 'RAW',
    requestBody: { values: [values] },
  });
}

function colLetter(n) {
  let result = '';
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

/**
 * Delete report tabs (BC dd-MM-yyyy) older than `keepDays`.
 *
 * Daily report runs at 18:00 and creates a new "BC dd-MM-yyyy" tab each day
 * via writeDailyReportTab. Without cleanup these accumulate forever, cluttering
 * the spreadsheet (we hit 7+ stale tabs in production before noticing).
 *
 * Strategy: list tabs, parse dd-MM-yyyy from titles matching /^BC \d{2}-\d{2}-\d{4}$/,
 * delete any older than keepDays. Skip the tab matching today's date to avoid
 * a race when this runs concurrently with the daily report itself.
 *
 * Returns the list of deleted tab titles (empty if nothing to clean).
 */
async function cleanupOldReportTabs(keepDays = 7) {
  const meta = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const tabs = meta.data.sheets || [];
  const now = new Date();
  const cutoff = new Date(now.getTime() - keepDays * 24 * 60 * 60 * 1000);
  const todayStr = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;

  const toDelete = [];
  for (const s of tabs) {
    const title = s.properties.title;
    const match = title.match(/^BC (\d{2})-(\d{2})-(\d{4})$/);
    if (!match) continue;
    const [, dd, mm, yyyy] = match;
    if (`${dd}-${mm}-${yyyy}` === todayStr) continue; // never delete today
    const tabDate = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
    if (tabDate < cutoff) {
      toDelete.push({ sheetId: s.properties.sheetId, title });
    }
  }

  if (toDelete.length === 0) return [];

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: toDelete.map(t => ({ deleteSheet: { sheetId: t.sheetId } })),
    },
  });

  logger.info('Cleaned up old report tabs', {
    deleted: toDelete.length,
    titles: toDelete.map(t => t.title),
    keepDays,
  });

  return toDelete.map(t => t.title);
}

/**
 * Delete CẦN KIỂM TRA rows older than `keepDays`.
 *
 * Review rows accumulate forever otherwise (we hit 42 stale "Chưa xử lý" rows
 * from late March before noticing). Source of truth lives in Supabase reviews
 * table — Sheets is just a viewing surface for managers.
 *
 * Strategy: read column C (timestamp) for all rows, identify rows older than
 * cutoff, delete via batchUpdate deleteDimension requests in reverse order
 * (so indices stay valid).
 *
 * Returns count of rows deleted.
 */
async function cleanupOldReviewRows(keepDays = 7) {
  const tab = tabNames.review;
  const meta = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const sheet = (meta.data.sheets || []).find(s => s.properties.title === tab);
  if (!sheet) return 0;
  const sheetId = sheet.properties.sheetId;

  // Read timestamp column (C) — format "dd/MM/yyyy HH:mm:ss"
  const res = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tab}'!C2:C`, // skip header
  });
  const timestamps = res.data.values || [];
  if (timestamps.length === 0) return 0;

  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  const toDelete = []; // 0-based row indices in the sheet (header is row 0)

  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i] && timestamps[i][0];
    if (!ts) continue;
    // Parse "dd/MM/yyyy HH:mm:ss"
    const m = String(ts).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) continue;
    const d = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
    if (d.getTime() < cutoff) {
      toDelete.push(i + 1); // +1 because we skipped header at index 0
    }
  }

  if (toDelete.length === 0) return 0;

  // Delete in reverse order so earlier indices stay valid
  toDelete.sort((a, b) => b - a);
  const requests = toDelete.map(rowIdx => ({
    deleteDimension: {
      range: { sheetId, dimension: 'ROWS', startIndex: rowIdx, endIndex: rowIdx + 1 },
    },
  }));

  // Batch in chunks of 100 to avoid request size limits
  const CHUNK = 100;
  for (let i = 0; i < requests.length; i += CHUNK) {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: requests.slice(i, i + CHUNK) },
    });
  }

  logger.info('Cleaned up old review rows', { deleted: toDelete.length, keepDays });
  return toDelete.length;
}

/**
 * Write a single AI briefing cell into the TỔNG QUAN dashboard tab.
 *
 * Called by ai-briefing.js after generating narrative. We append it as a new
 * "block" at the bottom of the existing dashboard so it lives next to the
 * data managers are already looking at — not in a separate tab where it gets
 * forgotten. Cell location: row determined dynamically (after Block 4).
 *
 * @param {string} text - the narrative text to write
 * @param {string} updatedAt - "HH:mm dd/MM/yyyy" formatted timestamp
 */
async function writeAiBriefingCell(text, updatedAt) {
  const tab = 'TỔNG QUAN';
  const meta = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const sheet = (meta.data.sheets || []).find(s => s.properties.title === tab);
  if (!sheet) {
    logger.warn('writeAiBriefingCell: TỔNG QUAN tab not found');
    return;
  }

  // Find the next empty row (so we don't overwrite the dashboard data above)
  const allRes = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tab}'!A:A`,
  });
  const allRows = allRes.data.values || [];
  // Briefing lives at a fixed offset after the last data row + 2 blank rows
  const briefingStartRow = allRows.length + 2; // 1-based

  const lines = [
    [`🤖 NHẬN XÉT CỦA EM (cập nhật ${updatedAt})`],
    [text],
  ];

  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tab}'!A${briefingStartRow}:F${briefingStartRow + lines.length - 1}`,
    valueInputOption: 'RAW',
    requestBody: { values: lines },
  });

  // Format: title row blue + bold, body row wrap + italic
  const sheetId = sheet.properties.sheetId;
  const formatRequests = [
    // Title row
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: briefingStartRow - 1,
          endRowIndex: briefingStartRow,
          startColumnIndex: 0,
          endColumnIndex: 6,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.102, green: 0.451, blue: 0.910 },
            textFormat: {
              fontFamily: 'Google Sans',
              fontSize: 11,
              bold: true,
              foregroundColor: { red: 1, green: 1, blue: 1 },
            },
            horizontalAlignment: 'LEFT',
            verticalAlignment: 'MIDDLE',
            padding: { left: 8 },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)',
      },
    },
    // Merge title across A:F
    {
      mergeCells: {
        range: {
          sheetId,
          startRowIndex: briefingStartRow - 1,
          endRowIndex: briefingStartRow,
          startColumnIndex: 0,
          endColumnIndex: 6,
        },
        mergeType: 'MERGE_ALL',
      },
    },
    // Body row: italic, wrap, light bg
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: briefingStartRow,
          endRowIndex: briefingStartRow + 1,
          startColumnIndex: 0,
          endColumnIndex: 6,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.973, green: 0.976, blue: 0.980 },
            textFormat: {
              fontFamily: 'Google Sans',
              fontSize: 11,
              italic: true,
              foregroundColor: { red: 0.125, green: 0.129, blue: 0.141 },
            },
            wrapStrategy: 'WRAP',
            verticalAlignment: 'TOP',
            padding: { left: 12, top: 8, bottom: 8, right: 12 },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,wrapStrategy,verticalAlignment,padding)',
      },
    },
    // Merge body across A:F
    {
      mergeCells: {
        range: {
          sheetId,
          startRowIndex: briefingStartRow,
          endRowIndex: briefingStartRow + 1,
          startColumnIndex: 0,
          endColumnIndex: 6,
        },
        mergeType: 'MERGE_ALL',
      },
    },
    // Set body row tall enough for ~6 lines of wrapped text
    {
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: briefingStartRow,
          endIndex: briefingStartRow + 1,
        },
        properties: { pixelSize: 140 },
        fields: 'pixelSize',
      },
    },
  ];

  try {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: formatRequests },
    });
  } catch (err) {
    logger.warn('AI briefing formatting failed (non-blocking)', { error: err.message });
  }

  logger.info('AI briefing cell written', { row: briefingStartRow, length: text.length });
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
  cleanupOldReportTabs,
  cleanupOldReviewRows,
  writeAiBriefingCell,
};
