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

supabaseMock.from = (_table) => ({
  select(_cols) {
    return {
      eq(_col, _val) {
        return {
          limit(_n)            { return Promise.resolve(supabaseMock._selectResult); },
          order(_col2, _opts)  { return Promise.resolve(supabaseMock._selectResult); },
          gte(_col2, _val2)    { return Promise.resolve(supabaseMock._selectResult); },
        };
      },
      gte(_col, _val) { return Promise.resolve(supabaseMock._selectResult); },
    };
  },
  insert(_row) {
    return Promise.resolve({ error: supabaseMock._insertError });
  },
  update(_row) {
    return {
      eq(_col, _val) { return Promise.resolve({ error: supabaseMock._updateError }); },
    };
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
