'use strict';

/**
 * Tests for db.js
 *
 * All Supabase calls are mocked via require-cache injection.
 * IMPORTANT: mocks must be injected SYNCHRONOUSLY at module level
 * before db.js is first required, otherwise createClient runs with
 * the real @supabase/supabase-js client.
 */

const { describe, it, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Supabase mock (built synchronously at module level) ──────────────────────

const supabaseMock = {
  _rpcResult: null,
  _selectResult: { data: [], error: null },
  _insertError: null,
  _updateError: null,
};

supabaseMock.rpc = (_name, _args) => Promise.resolve(supabaseMock._rpcResult);

// Chainable query builder mock — every method returns `this` for chaining,
// then resolves to the configured result when awaited (via .then()).
function makeChain(result) {
  const chain = {
    eq()    { return chain; },
    neq()   { return chain; },
    gt()    { return chain; },
    gte()   { return chain; },
    lt()    { return chain; },
    lte()   { return chain; },
    order() { return chain; },
    limit() { return chain; },
    not()   { return chain; },
    select(){ return chain; },
    then(resolve, reject) {
      const r = typeof result === 'function' ? result() : result;
      return Promise.resolve(r).then(resolve, reject);
    },
  };
  return chain;
}

supabaseMock.from = (_table) => ({
  select(_cols, _opts) {
    return makeChain(() => supabaseMock._selectResult);
  },
  insert(_row) {
    return Promise.resolve({ error: supabaseMock._insertError });
  },
  update(_row) {
    return makeChain(() => ({ data: supabaseMock._updateData || null, error: supabaseMock._updateError }));
  },
});

// ── Inject into require cache BEFORE requiring db.js ────────────────────────

require.cache[require.resolve('../src/logger')] = {
  exports: { info: () => {}, warn: () => {}, error: () => {} },
};
require.cache[require.resolve('@supabase/supabase-js')] = {
  exports: { createClient: () => supabaseMock },
};

// Now db.js will pick up our mock when it calls require('@supabase/supabase-js')
const db = require('../src/db');
db.initDb({
  timezone: 'Asia/Ho_Chi_Minh',
  supabase: { url: 'http://fake', serviceKey: 'fake-key' },
});

after(() => {
  delete require.cache[require.resolve('../src/db')];
  delete require.cache[require.resolve('../src/logger')];
  delete require.cache[require.resolve('@supabase/supabase-js')];
});

// ── isMessageProcessed ───────────────────────────────────────────────────────

describe('db.isMessageProcessed', () => {
  beforeEach(() => {
    supabaseMock._selectResult = { data: [], error: null };
  });

  it('returns false when no row found', async () => {
    supabaseMock._selectResult = { data: [], error: null };
    const result = await db.isMessageProcessed('123_456');
    assert.equal(result, false);
  });

  it('returns true when row found', async () => {
    supabaseMock._selectResult = { data: [{ event_id: 'SK-001' }], error: null };
    const result = await db.isMessageProcessed('123_456');
    assert.equal(result, true);
  });

  it('fails open (returns false) on DB error — never blocks messages', async () => {
    supabaseMock._selectResult = { data: null, error: { message: 'DB timeout' } };
    const result = await db.isMessageProcessed('123_456');
    assert.equal(result, false, 'must fail open on DB error');
  });
});

// ── processVehicleDecision ───────────────────────────────────────────────────

describe('db.processVehicleDecision', () => {
  it('returns RPC result on success (VAO)', async () => {
    supabaseMock._rpcResult = {
      data: [{ action: 'VAO', vehicle_id: 'LX-001', time_in_ts: new Date().toISOString(), seconds_in: 0 }],
      error: null,
    };

    const res = await db.processVehicleDecision('30A-12345', 'LX-001', new Date().toISOString(), 'http://img/1.jpg');
    assert.equal(res.action, 'VAO');
    assert.equal(res.vehicle_id, 'LX-001');
  });

  it('returns RPC result on success (RA)', async () => {
    supabaseMock._rpcResult = {
      data: [{ action: 'RA', vehicle_id: 'LX-001', time_in_ts: new Date().toISOString(), seconds_in: 3600 }],
      error: null,
    };

    const res = await db.processVehicleDecision('30A-12345', 'LX-999', new Date().toISOString(), 'http://img/2.jpg');
    assert.equal(res.action, 'RA');
    assert.equal(res.seconds_in, 3600);
  });

  it('returns RA_DUPLICATE when car just entered', async () => {
    supabaseMock._rpcResult = {
      data: [{ action: 'RA_DUPLICATE', vehicle_id: 'LX-001', time_in_ts: new Date().toISOString(), seconds_in: 5 }],
      error: null,
    };

    const res = await db.processVehicleDecision('30A-12345', 'LX-999', new Date().toISOString(), 'http://img/3.jpg');
    assert.equal(res.action, 'RA_DUPLICATE');
  });

  it('throws when RPC returns an error', async () => {
    supabaseMock._rpcResult = { data: null, error: { message: 'deadlock detected' } };

    await assert.rejects(
      () => db.processVehicleDecision('30A-12345', 'LX-001', new Date().toISOString(), ''),
      /process_vehicle RPC failed/
    );
  });

  it('throws when RPC returns empty data', async () => {
    supabaseMock._rpcResult = { data: [], error: null };

    await assert.rejects(
      () => db.processVehicleDecision('30A-12345', 'LX-001', new Date().toISOString(), ''),
      /returned no rows/
    );
  });
});

// ── insertEvent ──────────────────────────────────────────────────────────────

describe('db.insertEvent', () => {
  it('resolves without error on success', async () => {
    supabaseMock._insertError = null;
    await assert.doesNotReject(() =>
      db.insertEvent({
        eventId: 'SK-001',
        timestamp: new Date().toISOString(),
        recordType: 'VAO',
        plateAI: '30A-12345',
        confidenceLabel: 'Ro',
        imageUrl: '',
        sender: 'Test',
        messageKey: '[MSG_ID:123_456]',
        result: '',
      })
    );
  });

  it('throws on DB insert error', async () => {
    supabaseMock._insertError = { message: 'unique violation' };
    await assert.rejects(
      () => db.insertEvent({
        eventId: 'SK-DUP',
        timestamp: new Date().toISOString(),
      }),
      /insertEvent failed/
    );
  });
});

// ── updateEventResult ────────────────────────────────────────────────────────

describe('db.updateEventResult', () => {
  it('resolves without error on success', async () => {
    supabaseMock._updateError = null;
    await assert.doesNotReject(() =>
      db.updateEventResult('SK-001', 'VAO: 30A-12345 | 08/03/2026 08:00:00')
    );
  });

  it('throws on DB update error', async () => {
    supabaseMock._updateError = { message: 'row not found' };
    await assert.rejects(
      () => db.updateEventResult('SK-MISSING', 'some result'),
      /updateEventResult failed/
    );
  });
});

// ── insertReview ─────────────────────────────────────────────────────────────

describe('db.insertReview', () => {
  it('resolves without error on success', async () => {
    supabaseMock._insertError = null;
    await assert.doesNotReject(() =>
      db.insertReview({
        errorId: 'ERR-001',
        timestamp: new Date().toISOString(),
        plateAI: '30A-1234',
        reason: 'Ảnh mờ',
      })
    );
  });

  it('throws on DB insert error', async () => {
    supabaseMock._insertError = { message: 'constraint violation' };
    await assert.rejects(
      () => db.insertReview({ errorId: 'ERR-DUP', timestamp: new Date().toISOString() }),
      /insertReview failed/
    );
  });
});

// ── testConnection ──────────────────────────────────────────────────────────

describe('db.testConnection', () => {
  it('resolves when count query succeeds', async () => {
    supabaseMock._selectResult = { count: 42, error: null };
    await assert.doesNotReject(() => db.testConnection());
  });

  it('throws when count query fails', async () => {
    supabaseMock._selectResult = { count: null, error: { message: 'auth failed' } };
    await assert.rejects(() => db.testConnection(), /Supabase connection test failed/);
  });
});

// ── getAllInWorkshop ─────────────────────────────────────────────────────────

describe('db.getAllInWorkshop', () => {
  it('returns formatted vehicle list', async () => {
    supabaseMock._selectResult = {
      data: [
        { vehicle_id: 'LX-001', plate: '30A-12345', time_in: '2026-04-03T08:00:00Z', priority: 'Bình thường', note: '', vehicle_model: 'VF 8' },
      ],
      error: null,
    };
    const result = await db.getAllInWorkshop('Asia/Ho_Chi_Minh');
    assert.equal(result.length, 1);
    assert.equal(result[0].plate, '30A-12345');
    assert.equal(result[0].vehicleModel, 'VF 8');
    assert.ok(result[0].timeIn.includes('/'));
  });

  it('returns empty array when no data', async () => {
    supabaseMock._selectResult = { data: null, error: null };
    const result = await db.getAllInWorkshop();
    assert.equal(result.length, 0);
  });

  it('throws on error', async () => {
    supabaseMock._selectResult = { data: null, error: { message: 'timeout' } };
    await assert.rejects(() => db.getAllInWorkshop(), /getAllInWorkshop failed/);
  });
});

// ── countInWorkshop ─────────────────────────────────────────────────────────

describe('db.countInWorkshop', () => {
  it('returns count', async () => {
    supabaseMock._selectResult = { count: 55, error: null };
    const count = await db.countInWorkshop();
    assert.equal(count, 55);
  });

  it('returns 0 when count is null', async () => {
    supabaseMock._selectResult = { count: null, error: null };
    const count = await db.countInWorkshop();
    assert.equal(count, 0);
  });

  it('throws on error', async () => {
    supabaseMock._selectResult = { count: null, error: { message: 'err' } };
    await assert.rejects(() => db.countInWorkshop(), /countInWorkshop failed/);
  });
});

// ── expireStaleVehicles ─────────────────────────────────────────────────────

describe('db.expireStaleVehicles', () => {
  it('returns count of expired vehicles', async () => {
    supabaseMock._updateError = null;
    supabaseMock._updateData = [{ vehicle_id: 'LX-001' }, { vehicle_id: 'LX-002' }];
    const count = await db.expireStaleVehicles('2026-03-01T00:00:00Z', '2026-04-03T00:00:00Z');
    assert.equal(count, 2);
  });

  it('returns 0 when no vehicles expired', async () => {
    supabaseMock._updateError = null;
    supabaseMock._updateData = null;
    const count = await db.expireStaleVehicles('2026-03-01T00:00:00Z', '2026-04-03T00:00:00Z');
    assert.equal(count, 0);
  });

  it('throws on error', async () => {
    supabaseMock._updateError = { message: 'err' };
    supabaseMock._updateData = null;
    await assert.rejects(() => db.expireStaleVehicles('2026-03-01T00:00:00Z', '2026-04-03T00:00:00Z'), /expireStaleVehicles failed/);
  });
});

// ── forceExitVehicle ────────────────────────────────────────────────────────

describe('db.forceExitVehicle', () => {
  it('returns vehicle data on success', async () => {
    supabaseMock._updateError = null;
    supabaseMock._updateData = [{ vehicle_id: 'LX-001', plate: '30A-12345' }];
    const result = await db.forceExitVehicle('LX-001', '2026-04-03T10:00:00Z');
    assert.equal(result.vehicle_id, 'LX-001');
  });

  it('returns null when vehicle not found', async () => {
    supabaseMock._updateError = null;
    supabaseMock._updateData = [];
    const result = await db.forceExitVehicle('LX-MISSING', '2026-04-03T10:00:00Z');
    assert.equal(result, null);
  });

  it('throws on error', async () => {
    supabaseMock._updateError = { message: 'err' };
    supabaseMock._updateData = null;
    await assert.rejects(() => db.forceExitVehicle('LX-001', '2026-04-03T10:00:00Z'), /forceExitVehicle failed/);
  });
});

// ── updateVehiclePriority ───────────────────────────────────────────────────

describe('db.updateVehiclePriority', () => {
  it('resolves on success', async () => {
    supabaseMock._updateError = null;
    await assert.doesNotReject(() => db.updateVehiclePriority('LX-001', 'Khẩn', '2026-04-03T10:00:00Z'));
  });

  it('throws on error', async () => {
    supabaseMock._updateError = { message: 'err' };
    await assert.rejects(() => db.updateVehiclePriority('LX-001', 'Khẩn', '2026-04-03T10:00:00Z'), /updateVehiclePriority failed/);
  });
});

// ── getDailySummary ─────────────────────────────────────────────────────────

describe('db.getDailySummary', () => {
  it('returns summary object', async () => {
    supabaseMock._selectResult = { data: [], error: null, count: 0 };
    const result = await db.getDailySummary('Asia/Ho_Chi_Minh');
    assert.ok(result.today);
    assert.equal(typeof result.totalIn, 'number');
    assert.equal(typeof result.totalOut, 'number');
    assert.equal(typeof result.inWorkshop, 'number');
  });
});

// ── getProductivityData ─────────────────────────────────────────────────────

describe('db.getProductivityData', () => {
  it('returns productivity data', async () => {
    supabaseMock._selectResult = { data: [], error: null, count: 0 };
    const result = await db.getProductivityData('Asia/Ho_Chi_Minh');
    assert.ok(result.today);
    assert.equal(typeof result.todayIn, 'number');
    assert.equal(typeof result.completionRate, 'number');
  });
});

// ── getFullDailyReport ──────────────────────────────────────────────────────

describe('db.getFullDailyReport', () => {
  it('returns full report data', async () => {
    supabaseMock._selectResult = { data: [], error: null, count: 0 };
    const result = await db.getFullDailyReport('Asia/Ho_Chi_Minh');
    assert.ok(result.today);
    assert.ok(Array.isArray(result.vehiclesOut));
    assert.ok(Array.isArray(result.vehiclesInToday));
    assert.ok(Array.isArray(result.inWorkshop));
  });
});

// ── getWeeklyAverages ───────────────────────────────────────────────────────

describe('db.getWeeklyAverages', () => {
  it('returns averages', async () => {
    supabaseMock._selectResult = { data: [], error: null };
    const result = await db.getWeeklyAverages('Asia/Ho_Chi_Minh');
    assert.equal(typeof result.avgDailyIn, 'number');
    assert.equal(typeof result.avgDailyOut, 'number');
  });

  it('returns zeros on error', async () => {
    supabaseMock._selectResult = { data: null, error: { message: 'err' } };
    const result = await db.getWeeklyAverages('Asia/Ho_Chi_Minh');
    assert.equal(result.avgDailyIn, 0);
  });
});

// ── getInWorkshopWithHours ──────────────────────────────────────────────────

describe('db.getInWorkshopWithHours', () => {
  it('returns vehicles with hoursIn', async () => {
    supabaseMock._selectResult = {
      data: [{ vehicle_id: 'LX-001', plate: '30A-12345', time_in: '2026-04-03T02:00:00Z', priority: 'Bình thường', vehicle_model: '' }],
      error: null,
    };
    const result = await db.getInWorkshopWithHours('Asia/Ho_Chi_Minh');
    assert.equal(result.length, 1);
    assert.equal(result[0].plate, '30A-12345');
    assert.equal(typeof result[0].hoursIn, 'number');
  });

  it('returns empty on error', async () => {
    supabaseMock._selectResult = { data: null, error: { message: 'err' } };
    const result = await db.getInWorkshopWithHours();
    assert.equal(result.length, 0);
  });
});

// ── getDurationStats ────────────────────────────────────────────────────────

describe('db.getDurationStats', () => {
  it('returns percentiles', async () => {
    supabaseMock._selectResult = {
      data: Array.from({ length: 100 }, (_, i) => ({ duration_minutes: (i + 1) * 10 })),
      error: null,
    };
    const result = await db.getDurationStats('Asia/Ho_Chi_Minh');
    assert.ok(result.p50 > 0);
    assert.ok(result.p90 > result.p50);
    assert.equal(result.count, 100);
  });

  it('returns zeros for empty data', async () => {
    supabaseMock._selectResult = { data: [], error: null };
    const result = await db.getDurationStats();
    assert.equal(result.p50, 0);
    assert.equal(result.count, 0);
  });

  it('returns zeros on error', async () => {
    supabaseMock._selectResult = { data: null, error: { message: 'err' } };
    const result = await db.getDurationStats();
    assert.equal(result.count, 0);
  });
});

// ── getPendingReviews ───────────────────────────────────────────────────────

describe('db.getPendingReviews', () => {
  it('returns pending reviews', async () => {
    supabaseMock._selectResult = {
      data: [{ error_id: 'ERR-001', plate_ai: '30A-111', reason: 'Mờ', timestamp: '2026-04-03T08:00:00Z' }],
      error: null,
    };
    const result = await db.getPendingReviews();
    assert.equal(result.count, 1);
    assert.equal(result.items[0].plate, '30A-111');
  });

  it('returns empty on error', async () => {
    supabaseMock._selectResult = { data: null, error: { message: 'err' } };
    const result = await db.getPendingReviews();
    assert.equal(result.count, 0);
  });
});

// ── getRepeatVisitors ───────────────────────────────────────────────────────

describe('db.getRepeatVisitors', () => {
  it('returns formatted visitor list', async () => {
    supabaseMock._selectResult = {
      data: [
        { plate: '30A-111', time_in: '2026-04-01T08:00:00Z', time_out: '2026-04-01T14:00:00Z' },
        { plate: '30A-111', time_in: '2026-04-03T08:00:00Z', time_out: null },
      ],
      error: null,
    };
    const result = await db.getRepeatVisitors('Asia/Ho_Chi_Minh');
    assert.equal(result.length, 2);
    assert.equal(result[0].plate, '30A-111');
    assert.ok(result[0].timeIn.includes('/'));
  });

  it('returns empty on error', async () => {
    supabaseMock._selectResult = { data: null, error: { message: 'err' } };
    const result = await db.getRepeatVisitors();
    assert.equal(result.length, 0);
  });
});

// ── getAllMainRows ───────────────────────────────────────────────────────────

describe('db.getAllMainRows', () => {
  it('returns formatted rows', async () => {
    supabaseMock._selectResult = {
      data: [{
        vehicle_id: 'LX-001', plate: '30A-12345',
        time_in: '2026-04-03T08:00:00Z', time_out: '2026-04-03T14:00:00Z',
        duration_minutes: 360, status: 'Đã ra xưởng', priority: 'Bình thường',
        note: '', vehicle_model: 'VF 8',
      }],
      error: null,
    };
    const result = await db.getAllMainRows('Asia/Ho_Chi_Minh');
    assert.equal(result.length, 1);
    assert.equal(result[0].vehicleModel, 'VF 8');
    assert.equal(result[0].duration, '360');
  });

  it('throws on error', async () => {
    supabaseMock._selectResult = { data: null, error: { message: 'err' } };
    await assert.rejects(() => db.getAllMainRows(), /getAllMainRows failed/);
  });
});
