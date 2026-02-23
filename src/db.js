'use strict';

/**
 * Luu tru du lieu bang SQLite (thay the Google Sheets).
 * Giu nguyen interface cua sheets.js de khong phai sua matcher.js.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

let db = null;

// Cache in-memory de kiem tra idempotency nhanh
const processedMessageIds = new Set();

// ──────────────────────────────────────────────
// Init
// ──────────────────────────────────────────────

function initSheets(config) {
  const dbPath = config.dbPath || path.join(process.cwd(), 'data', 'xuong.db');

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL'); // Ghi nhanh hon, an toan hon

  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id  TEXT NOT NULL,
      plate       TEXT NOT NULL,
      time_in     TEXT NOT NULL,
      time_out    TEXT DEFAULT '',
      duration    TEXT DEFAULT '',
      image_in    TEXT DEFAULT '',
      image_out   TEXT DEFAULT '',
      status      TEXT DEFAULT 'Dang trong xuong',
      priority    TEXT DEFAULT 'Binh thuong',
      note        TEXT DEFAULT '',
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS logs (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id          TEXT NOT NULL UNIQUE,
      timestamp         TEXT NOT NULL,
      record_type       TEXT DEFAULT '',
      plate_ai          TEXT DEFAULT '',
      confidence_label  TEXT DEFAULT '',
      image_url         TEXT DEFAULT '',
      sender            TEXT DEFAULT '',
      original_message  TEXT DEFAULT '',
      result            TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      error_id       TEXT NOT NULL,
      event_id       TEXT NOT NULL,
      timestamp      TEXT NOT NULL,
      image_url      TEXT DEFAULT '',
      plate_ai       TEXT DEFAULT '',
      reason         TEXT DEFAULT '',
      suggestion     TEXT DEFAULT '',
      review_status  TEXT DEFAULT 'Chua xu ly',
      review_note    TEXT DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_vehicles_plate_status ON vehicles(plate, status);
    CREATE INDEX IF NOT EXISTS idx_logs_msg ON logs(original_message);
  `);

  logger.info('SQLite database initialized', { path: dbPath });
  return Promise.resolve();
}

// ──────────────────────────────────────────────
// VEHICLES (DANH SACH CHINH)
// ──────────────────────────────────────────────

function appendMainRow(row) {
  db.prepare(`
    INSERT INTO vehicles
      (vehicle_id, plate, time_in, time_out, duration,
       image_in, image_out, status, priority, note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.vehicleId, row.plate,
    row.timeIn || '', row.timeOut || '',
    String(row.duration || ''),
    row.imageIn || '', row.imageOut || '',
    row.status || 'Dang trong xuong',
    row.priority || 'Binh thuong',
    row.note || '', row.updatedAt || ''
  );
  logger.info('Inserted vehicle', { vehicleId: row.vehicleId, plate: row.plate });
  return Promise.resolve();
}

function findMainRow(plate, status) {
  const row = db.prepare(`
    SELECT * FROM vehicles WHERE plate = ? AND status = ? ORDER BY id DESC LIMIT 1
  `).get(plate, status);

  if (!row) return Promise.resolve(null);

  return Promise.resolve({
    rowIndex: row.id,
    data: {
      vehicleId: row.vehicle_id,
      plate:     row.plate,
      timeIn:    row.time_in,
      timeOut:   row.time_out,
      duration:  row.duration,
      imageIn:   row.image_in,
      imageOut:  row.image_out,
      status:    row.status,
      priority:  row.priority,
      note:      row.note,
      updatedAt: row.updated_at,
    },
  });
}

function updateMainRow(rowId, updates) {
  const fieldMap = {
    vehicleId: 'vehicle_id', plate:     'plate',
    timeIn:    'time_in',    timeOut:   'time_out',
    duration:  'duration',   imageIn:   'image_in',
    imageOut:  'image_out',  status:    'status',
    priority:  'priority',   note:      'note',
    updatedAt: 'updated_at',
  };

  const setClauses = [];
  const values = [];

  for (const [field, value] of Object.entries(updates)) {
    const col = fieldMap[field];
    if (col) {
      setClauses.push(`${col} = ?`);
      values.push(String(value));
    }
  }

  if (setClauses.length === 0) return Promise.resolve();

  values.push(rowId);
  db.prepare(`UPDATE vehicles SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
  logger.info('Updated vehicle', { rowId, updates });
  return Promise.resolve();
}

function getAllInWorkshop() {
  const rows = db.prepare(`
    SELECT * FROM vehicles WHERE status = 'Dang trong xuong' ORDER BY id ASC
  `).all();

  return Promise.resolve(rows.map(row => ({
    rowIndex:  row.id,
    vehicleId: row.vehicle_id,
    plate:     row.plate,
    timeIn:    row.time_in,
    priority:  row.priority,
    note:      row.note || '',
  })));
}

function getDailySummary(tz) {
  const { DateTime } = require('luxon');
  const today = DateTime.now().setZone(tz).toFormat('dd/MM/yyyy');

  const allVehicles = db.prepare('SELECT * FROM vehicles').all();

  let totalIn = 0, totalOut = 0, inWorkshop = 0;
  let warningCount = 0, urgentCount = 0;
  let totalDuration = 0, completedCount = 0;

  for (const row of allVehicles) {
    if ((row.time_in || '').startsWith(today))  totalIn++;
    if ((row.time_out || '').startsWith(today)) totalOut++;

    if (row.status === 'Dang trong xuong') {
      inWorkshop++;
      if (row.priority === 'Canh bao') warningCount++;
      if (row.priority === 'Khan')     urgentCount++;
    }

    if ((row.time_out || '').startsWith(today)) {
      const d = parseInt(row.duration, 10);
      if (!isNaN(d)) { totalDuration += d; completedCount++; }
    }
  }

  const pendingReview = db.prepare(`
    SELECT COUNT(*) as cnt FROM reviews WHERE review_status = 'Chua xu ly'
  `).get().cnt;

  return Promise.resolve({
    today, totalIn, totalOut, inWorkshop,
    warningCount, urgentCount, pendingReview,
    avgDuration: completedCount > 0 ? Math.round(totalDuration / completedCount) : 0,
  });
}

// ──────────────────────────────────────────────
// LOGS (NHAT KY)
// ──────────────────────────────────────────────

function appendLogRow(row) {
  db.prepare(`
    INSERT OR IGNORE INTO logs
      (event_id, timestamp, record_type, plate_ai, confidence_label,
       image_url, sender, original_message, result)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.eventId, row.timestamp,
    row.recordType || '', row.plateAI || '',
    row.confidenceLabel || '', row.imageUrl || '',
    row.sender || '', row.originalMessage || '', row.result || ''
  );
  logger.info('Inserted log', { eventId: row.eventId });
  return Promise.resolve();
}

function updateLogResult(eventId, result) {
  db.prepare('UPDATE logs SET result = ? WHERE event_id = ?').run(result, eventId);
  return Promise.resolve();
}

// ──────────────────────────────────────────────
// REVIEWS (CAN KIEM TRA)
// ──────────────────────────────────────────────

function appendReviewRow(row) {
  db.prepare(`
    INSERT INTO reviews
      (error_id, event_id, timestamp, image_url, plate_ai,
       reason, suggestion, review_status, review_note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.errorId, row.eventId, row.timestamp,
    row.imageUrl || '', row.plateAI || '',
    row.reason || '', row.suggestion || '',
    row.reviewStatus || 'Chua xu ly', row.reviewNote || ''
  );
  logger.info('Inserted review', { errorId: row.errorId });
  return Promise.resolve();
}

// ──────────────────────────────────────────────
// Idempotency
// ──────────────────────────────────────────────

function isMessageProcessed(messageId) {
  // Fast path: in-memory Set
  if (processedMessageIds.has(messageId)) return Promise.resolve(true);

  // Slow path: kiem tra DB (sau khi server restart)
  const marker = `[MSG_ID:${messageId}]`;
  const row = db.prepare(
    'SELECT id FROM logs WHERE original_message LIKE ? LIMIT 1'
  ).get(`%${marker}%`);

  if (row) {
    processedMessageIds.add(messageId);
    return Promise.resolve(true);
  }

  // Danh dau ngay de tranh xu ly trung neu 2 request den cung luc
  processedMessageIds.add(messageId);
  return Promise.resolve(false);
}

module.exports = {
  initSheets,
  appendMainRow,
  findMainRow,
  updateMainRow,
  getAllInWorkshop,
  getDailySummary,
  appendLogRow,
  updateLogResult,
  appendReviewRow,
  isMessageProcessed,
  COLUMNS: {},
};
