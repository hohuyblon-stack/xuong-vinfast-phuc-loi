'use strict';

/**
 * Async WRITE-ONLY mirror of DB writes to Google Sheets.
 *
 * All functions are fire-and-forget.
 * Sheets failures are logged but NEVER throw — they never block the bot.
 * The DB (Supabase) is the source of truth; Sheets is a write-only mirror.
 *
 * OPTIMIZATION: No Sheets READ operations. All reads go through Supabase.
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
  const { vehicleModel, ...rowWithoutModel } = row;
  fire(() => sheets.appendMainRow(rowWithoutModel), `appendMainRow:${row.vehicleId}`);
}

/**
 * Sync vehicle exit — write-only, no Sheets reads.
 * Data comes from matcher.js (already in Supabase).
 */
function syncVehicleOut(plate, vehicleId, updates) {
  fire(async () => {
    // Archive to completed tab (append-only, 1 API call)
    await sheets.archiveCompletedVehicle({
      vehicleId,
      plate,
      ...updates,
    });
    logger.info('Vehicle archived to Sheets', { plate, vehicleId });
  }, `archiveVehicle:${vehicleId}`);
}

function syncLogInsert(row) {
  fire(() => sheets.appendLogRow(row), `appendLogRow:${row.eventId}`);
}

/**
 * No-op: log tab is append-only. Result lives in DB.
 */
function syncLogResult(_eventId, _result) {
  // Intentionally empty — DB is source of truth
}

function syncReviewInsert(row) {
  fire(() => sheets.appendReviewRow(row), `appendReviewRow:${row.errorId}`);
}

/**
 * No-op for individual priority sync.
 * Use syncPrioritiesBatch() instead (called from checkTimeAlerts).
 */
function syncVehiclePriority(_plate, _priority, _updatedAt) {
  // Intentionally empty — batch sync handles this
}

/**
 * Batch update all priority changes in 2 API calls (1 read + 1 write).
 * Replaces N × syncVehiclePriority (was N × 2 API calls).
 */
function syncPrioritiesBatch(changes) {
  fire(
    () => sheets.batchUpdatePriorities(changes),
    `batchPriority:${changes.length}`,
  );
}

function syncDailyReport(tabName, rows, sectionRowIndices, summaryRowIndex) {
  fire(
    () => sheets.writeDailyReportTab(tabName, rows, sectionRowIndices, summaryRowIndex),
    `dailyReport:${tabName}`,
  );
}

// ──────────────────────────────────────────────
// Dashboard sync with 30s throttle
// ──────────────────────────────────────────────

let dashboardTimer = null;
let dashboardConfig = null;
const DASHBOARD_THROTTLE_MS = 30 * 1000;

/**
 * Schedule a dashboard refresh with throttle.
 * If multiple calls arrive within 30s, only the last one executes.
 */
function syncDashboard(config) {
  dashboardConfig = config;

  if (dashboardTimer) {
    // Already scheduled — the pending timer will use the latest config
    return;
  }

  dashboardTimer = setTimeout(() => {
    dashboardTimer = null;
    const cfg = dashboardConfig;
    fire(async () => {
      const { refreshDashboard } = require('./sheets-dashboard');
      await refreshDashboard(cfg);
    }, 'dashboard-refresh');
  }, DASHBOARD_THROTTLE_MS);
}

/**
 * Force immediate dashboard refresh (no throttle). For cron/scheduled use.
 */
function syncDashboardImmediate(config) {
  if (dashboardTimer) {
    clearTimeout(dashboardTimer);
    dashboardTimer = null;
  }
  fire(async () => {
    const { refreshDashboard } = require('./sheets-dashboard');
    await refreshDashboard(config);
  }, 'dashboard-refresh-immediate');
}

module.exports = {
  syncVehicleIn,
  syncVehicleOut,
  syncLogInsert,
  syncLogResult,
  syncReviewInsert,
  syncVehiclePriority,
  syncPrioritiesBatch,
  syncDailyReport,
  syncDashboard,
  syncDashboardImmediate,
};
