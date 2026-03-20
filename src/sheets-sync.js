'use strict';

/**
 * Async mirror of DB writes to Google Sheets.
 *
 * All functions are fire-and-forget.
 * Sheets failures are logged but NEVER throw — they never block the bot.
 * The DB (Supabase) is the source of truth; Sheets is a read-only view
 * for the client.
 */

const sheets = require('./sheets');
const logger  = require('./logger');

function fire(fn, context) {
  Promise.resolve()
    .then(fn)
    .catch(err => {
      logger.error('Sheets sync failed', { context, error: err.message });
    });
}

function syncVehicleIn(row) {
  fire(() => sheets.appendMainRow(row), `appendMainRow:${row.vehicleId}`);
}

function syncVehicleOut(plate, vehicleId, updates) {
  fire(async () => {
    const existing = await sheets.findMainRow(plate, 'Đang trong xưởng');
    if (existing) {
      await sheets.updateMainRow(existing.rowIndex, updates);
    } else {
      logger.warn('Sheets sync: row not found for RA', { plate, vehicleId });
    }
  }, `updateMainRow:${vehicleId}`);
}

function syncLogInsert(row) {
  fire(() => sheets.appendLogRow(row), `appendLogRow:${row.eventId}`);
}

function syncLogResult(eventId, result) {
  fire(() => sheets.updateLogResult(eventId, result), `updateLogResult:${eventId}`);
}

function syncReviewInsert(row) {
  fire(() => sheets.appendReviewRow(row), `appendReviewRow:${row.errorId}`);
}

function syncVehiclePriority(plate, priority, updatedAt) {
  fire(async () => {
    const existing = await sheets.findMainRow(plate, 'Đang trong xưởng');
    if (existing) {
      await sheets.updateMainRow(existing.rowIndex, { priority, updatedAt });
    }
  }, `updatePriority:${plate}`);
}

function syncDailyReport(reportDate, rows) {
  fire(() => sheets.appendDailyReportRows(rows), `dailyReport:${reportDate}`);
}

module.exports = {
  syncVehicleIn,
  syncVehicleOut,
  syncLogInsert,
  syncLogResult,
  syncReviewInsert,
  syncVehiclePriority,
  syncDailyReport,
};
