'use strict';

/**
 * Tests for sheets-sync.js (WRITE-ONLY mirror)
 *
 * Core guarantee: ALL functions are fire-and-forget.
 * Errors from Sheets MUST be swallowed and logged — never propagated.
 * No Sheets READ operations — DB is source of truth.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockSheets = {
  appendMainRow:           async () => {},
  appendLogRow:            async () => {},
  appendReviewRow:         async () => {},
  archiveCompletedVehicle: async () => {},
  deleteMainRow:           async () => {},
  batchUpdatePriorities:   async () => {},
};

let lastLoggedError = null;
const mockLogger = {
  info:  () => {},
  warn:  () => {},
  error: (_msg, meta) => { lastLoggedError = meta; },
};

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

function tick(ms = 20) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('sheets-sync — fire-and-forget guarantee', () => {
  beforeEach(() => {
    lastLoggedError = null;
    mockSheets.appendMainRow           = async () => {};
    mockSheets.appendLogRow            = async () => {};
    mockSheets.appendReviewRow         = async () => {};
    mockSheets.archiveCompletedVehicle = async () => {};
    mockSheets.deleteMainRow           = async () => {};
    mockSheets.batchUpdatePriorities   = async () => {};
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

  it('syncLogResult — is a no-op (log is append-only)', async () => {
    sheetsSync.syncLogResult('SK-001', 'VAO: 30A-12345');
    await tick();
    assert.equal(lastLoggedError, null);
  });

  it('syncReviewInsert — swallows sheets error', async () => {
    mockSheets.appendReviewRow = async () => { throw new Error('Auth expired'); };

    sheetsSync.syncReviewInsert({ errorId: 'ERR-001' });
    await tick();

    assert.ok(lastLoggedError);
  });

  it('syncVehicleOut — archives vehicle (write-only, no reads)', async () => {
    let archiveCalled = false;
    mockSheets.archiveCompletedVehicle = async (rowData) => {
      archiveCalled = true;
      assert.equal(rowData.plate, '30A-12345');
      assert.equal(rowData.status, 'Đã ra xưởng');
    };

    sheetsSync.syncVehicleOut('30A-12345', 'LX-001', {
      status: 'Đã ra xưởng',
      timeOut: '08/03/2026 10:00:00',
    });
    await tick();

    assert.ok(archiveCalled, 'archiveCompletedVehicle must be called');
    assert.equal(lastLoggedError, null);
  });

  it('syncVehicleOut — swallows archive error', async () => {
    mockSheets.archiveCompletedVehicle = async () => { throw new Error('API error'); };

    sheetsSync.syncVehicleOut('30A-12345', 'LX-001', { status: 'Đã ra xưởng' });
    await tick();

    assert.ok(lastLoggedError);
  });

  it('syncVehiclePriority — is a no-op (batch handles this)', async () => {
    sheetsSync.syncVehiclePriority('30A-12345', 'Khẩn', new Date().toISOString());
    await tick();
    assert.equal(lastLoggedError, null);
  });

  it('syncPrioritiesBatch — calls batchUpdatePriorities', async () => {
    let batchCalled = false;
    mockSheets.batchUpdatePriorities = async (changes) => {
      batchCalled = true;
      assert.equal(changes.length, 2);
    };

    sheetsSync.syncPrioritiesBatch([
      { plate: '30A-111', priority: 'Khẩn', updatedAt: '2026-03-28' },
      { plate: '30A-222', priority: 'Cảnh báo', updatedAt: '2026-03-28' },
    ]);
    await tick();

    assert.ok(batchCalled);
    assert.equal(lastLoggedError, null);
  });

  it('syncPrioritiesBatch — swallows batch error', async () => {
    mockSheets.batchUpdatePriorities = async () => { throw new Error('Quota exceeded'); };

    sheetsSync.syncPrioritiesBatch([{ plate: '30A-111', priority: 'Khẩn', updatedAt: '2026-03-28' }]);
    await tick();

    assert.ok(lastLoggedError);
  });
});
