'use strict';

/**
 * Tests for sheets-sync.js
 *
 * Core guarantee: ALL functions are fire-and-forget.
 * Errors from Sheets MUST be swallowed and logged — never propagated.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Mocks (injected before requiring the module under test) ──────────────────

const mockSheets = {
  appendMainRow:  async () => {},
  appendLogRow:   async () => {},
  appendReviewRow: async () => {},
  updateLogResult: async () => {},
  findMainRow:    async () => null,
  updateMainRow:  async () => {},
};

let lastLoggedError = null;
const mockLogger = {
  info:  () => {},
  warn:  () => {},
  error: (_msg, meta) => { lastLoggedError = meta; },
};

// Pre-populate require cache so sheets-sync picks up our mocks
before(() => {
  require.cache[require.resolve('../src/sheets')] = { exports: mockSheets };
  require.cache[require.resolve('../src/logger')] = { exports: mockLogger };
});

after(() => {
  delete require.cache[require.resolve('../src/sheets-sync')];
  delete require.cache[require.resolve('../src/sheets')];
  delete require.cache[require.resolve('../src/logger')];
});

const sheetsSync = require('../src/sheets-sync');

// Helper: wait for the fire-and-forget Promise to settle
function tick(ms = 20) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Core guarantee: errors never propagate ───────────────────────────────────

describe('sheets-sync — fire-and-forget guarantee', () => {
  beforeEach(() => {
    lastLoggedError = null;
    // Reset all mocks to success
    mockSheets.appendMainRow   = async () => {};
    mockSheets.appendLogRow    = async () => {};
    mockSheets.appendReviewRow = async () => {};
    mockSheets.updateLogResult = async () => {};
    mockSheets.findMainRow     = async () => null;
    mockSheets.updateMainRow   = async () => {};
  });

  it('syncVehicleIn — returns undefined synchronously (fire-and-forget)', () => {
    const result = sheetsSync.syncVehicleIn({ vehicleId: 'LX-001', plate: '30A-12345' });
    assert.equal(result, undefined);
  });

  it('syncVehicleIn — does not throw when sheets succeeds', async () => {
    sheetsSync.syncVehicleIn({ vehicleId: 'LX-001', plate: '30A-12345' });
    await tick();
    assert.equal(lastLoggedError, null);
  });

  it('syncVehicleIn — swallows sheets error and logs it', async () => {
    mockSheets.appendMainRow = async () => { throw new Error('Network timeout'); };

    sheetsSync.syncVehicleIn({ vehicleId: 'LX-002', plate: '51F1-99999' });
    await tick();

    assert.ok(lastLoggedError, 'error must be logged');
    assert.ok(lastLoggedError.error.includes('Network timeout'));
  });

  it('syncLogInsert — swallows sheets error', async () => {
    mockSheets.appendLogRow = async () => { throw new Error('Quota exceeded'); };

    sheetsSync.syncLogInsert({ eventId: 'SK-001' });
    await tick();

    assert.ok(lastLoggedError, 'error must be logged');
    assert.ok(lastLoggedError.error.includes('Quota exceeded'));
  });

  it('syncLogResult — swallows sheets error', async () => {
    mockSheets.updateLogResult = async () => { throw new Error('Sheet locked'); };

    sheetsSync.syncLogResult('SK-001', 'VAO: 30A-12345');
    await tick();

    assert.ok(lastLoggedError);
  });

  it('syncReviewInsert — swallows sheets error', async () => {
    mockSheets.appendReviewRow = async () => { throw new Error('Auth expired'); };

    sheetsSync.syncReviewInsert({ errorId: 'ERR-001' });
    await tick();

    assert.ok(lastLoggedError);
  });

  it('syncVehicleOut — warns when row not found, does not throw', async () => {
    let warnCalled = false;
    mockLogger.warn = () => { warnCalled = true; };
    mockSheets.findMainRow = async () => null;

    sheetsSync.syncVehicleOut('30A-12345', 'LX-001', { status: 'Đã ra xưởng' });
    await tick();

    assert.ok(warnCalled, 'warn should be called when row not found');
    assert.equal(lastLoggedError, null, 'no error should be logged');
    mockLogger.warn = () => {};
  });

  it('syncVehicleOut — updates row when found', async () => {
    let updateCalled = false;
    mockSheets.findMainRow = async () => ({ rowIndex: 5 });
    mockSheets.updateMainRow = async (rowIndex, updates) => {
      updateCalled = true;
      assert.equal(rowIndex, 5);
      assert.ok(updates.status || updates.timeOut || updates.duration);
    };

    sheetsSync.syncVehicleOut('30A-12345', 'LX-001', { status: 'Đã ra xưởng', timeOut: '08/03/2026 10:00:00' });
    await tick();

    assert.ok(updateCalled, 'updateMainRow must be called');
    assert.equal(lastLoggedError, null);
  });

  it('syncVehiclePriority — updates row when found', async () => {
    let updateCalled = false;
    mockSheets.findMainRow = async () => ({ rowIndex: 3 });
    mockSheets.updateMainRow = async (rowIndex, updates) => {
      updateCalled = true;
      assert.equal(updates.priority, 'Khẩn');
    };

    sheetsSync.syncVehiclePriority('30A-12345', 'Khẩn', new Date().toISOString());
    await tick();

    assert.ok(updateCalled);
    assert.equal(lastLoggedError, null);
  });

  it('syncVehiclePriority — swallows error from findMainRow', async () => {
    mockSheets.findMainRow = async () => { throw new Error('API error'); };

    sheetsSync.syncVehiclePriority('30A-12345', 'Cảnh báo', new Date().toISOString());
    await tick();

    assert.ok(lastLoggedError);
  });
});
