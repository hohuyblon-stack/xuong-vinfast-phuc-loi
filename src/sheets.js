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
    'Ma luot xe', 'Bien so', 'Gio vao', 'Gio ra',
    'Luu trong xuong (phut)', 'Anh luc vao', 'Anh luc ra',
    'Trang thai', 'Ghi chu', 'Cap nhat luc',
  ],
  log: [
    'Ma su kien', 'Thoi diem', 'Loai ghi nhan', 'Bien so (AI doc)',
    'Chat luong nhan dang', 'Anh', 'Nguoi gui', 'Tin nhan goc', 'Ket qua xu ly',
  ],
  review: [
    'Ma loi', 'Ma su kien', 'Thoi diem', 'Anh', 'Bien so (AI doc)',
    'Ly do', 'Huong xu ly', 'Trang thai xu ly', 'Ghi chu',
  ],
  archive: [
    'Ma luot xe', 'Bien so', 'Gio vao', 'Gio ra',
    'Luu trong xuong (phut)', 'Anh luc vao', 'Anh luc ra',
    'Trang thai', 'Ghi chu', 'Cap nhat luc',
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
    { key: 'log', name: tabNames.log, columns: COLUMNS.log },
    { key: 'review', name: tabNames.review, columns: COLUMNS.review },
    { key: 'archive', name: tabNames.archive, columns: COLUMNS.archive },
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
    }
  }
}

// ──────────────────────────────────────────────
// DANH SACH CHINH (10 columns: A-J)
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
    row.status || 'Dang trong xuong',
    row.note || '',
    row.updatedAt || '',
  ]];

  await sheetsApi.spreadsheets.values.append({
    spreadsheetId,
    range: `'${tabNames.main}'!A:J`,
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
  const range = `'${tabNames.main}'!A:J`;
  const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values || [];

  for (let i = rows.length - 1; i >= 1; i--) {
    const row = rows[i];
    if (row[1] === plate && row[7] === status) {
      return {
        rowIndex: i + 1,
        data: {
          vehicleId: row[0],
          plate: row[1],
          timeIn: row[2],
          timeOut: row[3],
          duration: row[4],
          imageIn: row[5],
          imageOut: row[6],
          status: row[7],
          note: row[8],
          updatedAt: row[9],
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
  const range = `'${tabNames.main}'!A${rowIndex}:J${rowIndex}`;
  const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
  const current = (res.data.values && res.data.values[0]) || [];

  const fieldMap = {
    vehicleId: 0, plate: 1, timeIn: 2, timeOut: 3,
    duration: 4, imageIn: 5, imageOut: 6, status: 7,
    note: 8, updatedAt: 9,
  };

  const updated = [...current];
  while (updated.length < 10) updated.push('');

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

// ──────────────────────────────────────────────
// LUU TRU - Tu dong chuyen xe da RA > 24h
// ──────────────────────────────────────────────

/**
 * Tim tat ca xe "Da ra xuong" qua archiveAfterHours,
 * copy sang tab LUU TRU roi xoa khoi DANH SACH CHINH.
 */
async function archiveOldVehicles(archiveAfterHours, tz) {
  const { DateTime } = require('luxon');
  const fmt = 'dd/MM/yyyy HH:mm:ss';
  const now = DateTime.now().setZone(tz);

  const range = `'${tabNames.main}'!A:J`;
  const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values || [];

  // Tim cac dong can archive (duyet nguoc de xoa khong lech index)
  const toArchive = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const status = row[7] || '';
    const timeOut = row[3] || '';

    if (status !== 'Da ra xuong' || !timeOut) continue;

    const outTime = DateTime.fromFormat(timeOut, fmt, { zone: tz });
    if (!outTime.isValid) continue;

    const hoursSinceOut = now.diff(outTime, 'hours').hours;
    if (hoursSinceOut >= archiveAfterHours) {
      toArchive.push({ rowIndex: i + 1, data: row });
    }
  }

  if (toArchive.length === 0) return 0;

  // Buoc 1: Copy sang LUU TRU
  const archiveValues = toArchive.map(item => item.data);
  await sheetsApi.spreadsheets.values.append({
    spreadsheetId,
    range: `'${tabNames.archive}'!A:J`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: archiveValues },
  });

  // Buoc 2: Xoa khoi DANH SACH CHINH (tu duoi len de khong lech index)
  // Lay sheetId cua tab main
  const spreadsheet = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const mainSheet = spreadsheet.data.sheets.find(
    s => s.properties.title === tabNames.main
  );
  const mainSheetId = mainSheet.properties.sheetId;

  const deleteRequests = [];
  for (let i = toArchive.length - 1; i >= 0; i--) {
    const rowIdx = toArchive[i].rowIndex;
    deleteRequests.push({
      deleteDimension: {
        range: {
          sheetId: mainSheetId,
          dimension: 'ROWS',
          startIndex: rowIdx - 1,
          endIndex: rowIdx,
        },
      },
    });
  }

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: deleteRequests },
  });

  logger.info('Archived vehicles', { count: toArchive.length });
  return toArchive.length;
}

// ──────────────────────────────────────────────
// NHAT KY
// ──────────────────────────────────────────────

async function appendLogRow(row) {
  const values = [[
    row.eventId,
    row.timestamp,
    row.recordType || 'Khong xac dinh',
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
    row.reason || '',
    row.suggestion || '',
    row.reviewStatus || 'Chua xu ly',
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
  archiveOldVehicles,
  appendLogRow,
  updateLogResult,
  appendReviewRow,
  isMessageProcessed,
  COLUMNS,
};
