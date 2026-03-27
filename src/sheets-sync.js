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
  // Remove vehicleModel before syncing to sheets (DB field remains, just not synced)
  const { vehicleModel, ...rowWithoutModel } = row;
  fire(() => sheets.appendMainRow(rowWithoutModel), `appendMainRow:${row.vehicleId}`);
}

function syncVehicleOut(plate, vehicleId, updates) {
  fire(async () => {
    const existing = await sheets.findMainRow(plate, 'Đang trong xưởng');
    if (!existing) {
      logger.warn('Sheets sync: row not found for RA', { plate, vehicleId });
      return;
    }

    // 1. Update row with exit data
    await sheets.updateMainRow(existing.rowIndex, updates);

    // 2. Read updated row data for archive
    const updatedRow = { ...existing.data, ...updates };

    // 3. Archive to "ĐÃ HOÀN THÀNH"
    await sheets.archiveCompletedVehicle(updatedRow);

    // 4. Delete from "DANH SÁCH CHÍNH"
    await sheets.deleteMainRow(existing.rowIndex);

    logger.info('Vehicle archived and removed from main', { plate, vehicleId });
  }, `archiveVehicle:${vehicleId}`);
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

function syncDailyReport(tabName, rows, sectionRowIndices, summaryRowIndex) {
  fire(
    () => sheets.writeDailyReportTab(tabName, rows, sectionRowIndices, summaryRowIndex),
    `dailyReport:${tabName}`,
  );
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
