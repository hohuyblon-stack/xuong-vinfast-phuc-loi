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
    'Trang thai', 'Muc uu tien', 'Ghi chu', 'Cap nhat luc',
  ],
  log: [
    'Ma su kien', 'Thoi diem', 'Loai ghi nhan', 'Bien so (AI doc)',
    'Chat luong nhan dang', 'Anh', 'Nguoi gui', 'Tin nhan goc', 'Ket qua xu ly',
  ],
  review: [
    'Ma loi', 'Ma su kien', 'Thoi diem', 'Anh', 'Bien so (AI doc)',
    'Ly do', 'Huong xu ly', 'Trang thai xu ly', 'Ghi chu',
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
    row.status || 'Dang trong xuong',
    row.priority || 'Binh thuong',
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
 * Tim dong theo bien so + trang thai.
 * Tra ve { rowIndex (1-based), data } hoac null.
 */
async function findMainRow(plate, status) {
  const range = `'${tabNames.main}'!A:K`;
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
          priority: row[8],
          note: row[9],
          updatedAt: row[10],
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
  const range = `'${tabNames.main}'!A${rowIndex}:K${rowIndex}`;
  const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
  const current = (res.data.values && res.data.values[0]) || [];

  const fieldMap = {
    vehicleId: 0, plate: 1, timeIn: 2, timeOut: 3,
    duration: 4, imageIn: 5, imageOut: 6, status: 7,
    priority: 8, note: 9, updatedAt: 10,
  };

  const updated = [...current];
  while (updated.length < 11) updated.push('');

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
  const range = `'${tabNames.main}'!A:K`;
  const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values || [];
  const results = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[7] === 'Dang trong xuong') {
      results.push({
        rowIndex: i + 1,
        vehicleId: row[0],
        plate: row[1],
        timeIn: row[2],
        priority: row[8],
        note: row[9] || '',
      });
    }
  }
  return results;
}

/**
 * Lay thong ke tong hop.
 */
async function getDailySummary(tz) {
  const { DateTime } = require('luxon');
  const today = DateTime.now().setZone(tz).toFormat('dd/MM/yyyy');

  const range = `'${tabNames.main}'!A:K`;
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
    const timeIn = row[2] || '';
    const timeOut = row[3] || '';
    const duration = parseInt(row[4], 10);
    const status = row[7] || '';
    const priority = row[8] || '';

    if (timeIn.startsWith(today)) totalIn++;
    if (timeOut.startsWith(today)) totalOut++;
    if (status === 'Dang trong xuong') {
      inWorkshop++;
      if (priority === 'Canh bao') warningCount++;
      if (priority === 'Khan') urgentCount++;
    }
    if (timeOut.startsWith(today) && !isNaN(duration)) {
      totalDuration += duration;
      completedCount++;
    }
  }

  const reviewRange = `'${tabNames.review}'!A:I`;
  const reviewRes = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: reviewRange });
  const reviewRows = reviewRes.data.values || [];
  let pendingReview = 0;
  for (let i = 1; i < reviewRows.length; i++) {
    if (reviewRows[i][7] === 'Chua xu ly') pendingReview++;
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
 * Lay du lieu nang suat chi tiet cho bao cao.
 * Tra ve: hom nay, hom qua, xe nhanh nhat/cham nhat, phan bo theo khung gio, v.v.
 */
async function getProductivityData(tz) {
  const { DateTime } = require('luxon');
  const now = DateTime.now().setZone(tz);
  const today = now.toFormat('dd/MM/yyyy');
  const yesterday = now.minus({ days: 1 }).toFormat('dd/MM/yyyy');

  const range = `'${tabNames.main}'!A:K`;
  const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values || [];

  // Stats cho hom nay
  let todayIn = 0;
  let todayOut = 0;
  let inWorkshop = 0;
  let warningCount = 0;
  let urgentCount = 0;
  let totalDuration = 0;
  let completedCount = 0;
  let fastestVehicle = null;   // { plate, duration }
  let slowestVehicle = null;   // { plate, duration }
  const completedToday = [];   // danh sach xe hoan thanh hom nay

  // Stats cho hom qua (de so sanh)
  let yesterdayIn = 0;
  let yesterdayOut = 0;
  let yesterdayTotalDuration = 0;
  let yesterdayCompletedCount = 0;

  // Phan bo theo khung gio (sang 6-12, chieu 12-18, toi 18-24, dem 0-6)
  const timeSlots = { sang: 0, chieu: 0, toi: 0, dem: 0 };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const plate = row[1] || '';
    const timeIn = row[2] || '';
    const timeOut = row[3] || '';
    const duration = parseInt(row[4], 10);
    const status = row[7] || '';
    const priority = row[8] || '';

    // Hom nay
    if (timeIn.startsWith(today)) {
      todayIn++;
      // Phan bo khung gio vao
      const hourMatch = timeIn.match(/\d{2}\/\d{2}\/\d{4} (\d{2}):/);
      if (hourMatch) {
        const h = parseInt(hourMatch[1], 10);
        if (h >= 6 && h < 12) timeSlots.sang++;
        else if (h >= 12 && h < 18) timeSlots.chieu++;
        else if (h >= 18) timeSlots.toi++;
        else timeSlots.dem++;
      }
    }
    if (timeOut.startsWith(today)) {
      todayOut++;
    }

    // Hom qua
    if (timeIn.startsWith(yesterday)) yesterdayIn++;
    if (timeOut.startsWith(yesterday)) yesterdayOut++;

    // Dang trong xuong
    if (status === 'Dang trong xuong') {
      inWorkshop++;
      if (priority === 'Canh bao') warningCount++;
      if (priority === 'Khan') urgentCount++;
    }

    // Xe hoan thanh hom nay (co thoi gian ra la hom nay + co duration)
    if (timeOut.startsWith(today) && !isNaN(duration)) {
      totalDuration += duration;
      completedCount++;
      completedToday.push({ plate, duration });

      if (!fastestVehicle || duration < fastestVehicle.duration) {
        fastestVehicle = { plate, duration };
      }
      if (!slowestVehicle || duration > slowestVehicle.duration) {
        slowestVehicle = { plate, duration };
      }
    }

    // Xe hoan thanh hom qua
    if (timeOut.startsWith(yesterday) && !isNaN(duration)) {
      yesterdayTotalDuration += duration;
      yesterdayCompletedCount++;
    }
  }

  // Pending review
  const reviewRange = `'${tabNames.review}'!A:I`;
  const reviewRes = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: reviewRange });
  const reviewRows = reviewRes.data.values || [];
  let pendingReview = 0;
  for (let i = 1; i < reviewRows.length; i++) {
    if (reviewRows[i][7] === 'Chua xu ly') pendingReview++;
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
    // So sanh hom qua
    yesterdayIn,
    yesterdayOut,
    yesterdayAvgDuration: yesterdayCompletedCount > 0
      ? Math.round(yesterdayTotalDuration / yesterdayCompletedCount) : 0,
    // Ty le hoan thanh trong ngay
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
  getAllInWorkshop,
  getDailySummary,
  getProductivityData,
  appendLogRow,
  updateLogResult,
  appendReviewRow,
  isMessageProcessed,
  COLUMNS,
};
