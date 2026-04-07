'use strict';

const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { parseSweepReply } = require('../src/utils');

// ──────────────────────────────────────────────
// parseSweepReply: pure function, no DB
// ──────────────────────────────────────────────

describe('parseSweepReply — accepts digit-only patterns', () => {
  it('parses space-separated digits', () => {
    assert.deepEqual(parseSweepReply('1 3 5'), [1, 3, 5]);
  });

  it('parses comma-separated digits', () => {
    assert.deepEqual(parseSweepReply('1,3,5'), [1, 3, 5]);
  });

  it('parses comma+space mix', () => {
    assert.deepEqual(parseSweepReply('1, 3, 5'), [1, 3, 5]);
  });

  it('parses semicolon-separated digits', () => {
    assert.deepEqual(parseSweepReply('1;3;5'), [1, 3, 5]);
  });

  it('parses dot-separated digits', () => {
    assert.deepEqual(parseSweepReply('1.3.5'), [1, 3, 5]);
  });

  it('parses single digit', () => {
    assert.deepEqual(parseSweepReply('7'), [7]);
  });

  it('parses multi-digit number', () => {
    assert.deepEqual(parseSweepReply('12'), [12]);
  });

  it('parses mixed multi-digit', () => {
    assert.deepEqual(parseSweepReply('1 12 3'), [1, 12, 3]);
  });

  it('handles leading/trailing whitespace', () => {
    assert.deepEqual(parseSweepReply('  1 3 5  '), [1, 3, 5]);
  });

  it('dedupes repeated indices', () => {
    assert.deepEqual(parseSweepReply('1 3 1 3 5'), [1, 3, 5]);
  });

  it('drops zero', () => {
    assert.deepEqual(parseSweepReply('0 1 3'), [1, 3]);
  });
});

describe('parseSweepReply — rejects non-digit patterns', () => {
  it('rejects empty string', () => {
    assert.equal(parseSweepReply(''), null);
  });

  it('rejects null/undefined', () => {
    assert.equal(parseSweepReply(null), null);
    assert.equal(parseSweepReply(undefined), null);
  });

  it('rejects whitespace only', () => {
    assert.equal(parseSweepReply('   '), null);
  });

  it('rejects plate format', () => {
    assert.equal(parseSweepReply('30A-12345'), null);
  });

  it('rejects RA command', () => {
    assert.equal(parseSweepReply('RA 30A-12345'), null);
  });

  it('rejects TONKHO command', () => {
    assert.equal(parseSweepReply('TONKHO'), null);
  });

  it('rejects mixed letters', () => {
    assert.equal(parseSweepReply('1 abc 3'), null);
  });

  it('rejects all zeros (no positive indices)', () => {
    assert.equal(parseSweepReply('0 0 0'), null);
  });
});

// ──────────────────────────────────────────────
// processSweepReply: integration with mocked db
// ──────────────────────────────────────────────

describe('processSweepReply', () => {
  let sweepSessions;
  let dbMock;
  let originalDb;
  let processSweepReply;

  beforeEach(() => {
    sweepSessions = new Map();
    // Mock db.forceExitVehicle to return a result for known IDs
    const db = require('../src/db');
    originalDb = { forceExitVehicle: db.forceExitVehicle };
    db.forceExitVehicle = mock.fn(async (vehicleId, _nowIso) => {
      if (vehicleId === 'VH-FAIL') return null;
      if (vehicleId === 'VH-THROW') throw new Error('db down');
      return { vehicle_id: vehicleId, plate: 'MOCKED' };
    });

    // Mock sheets-sync to no-op
    const sheetsSync = require('../src/sheets-sync');
    sheetsSync.syncVehicleOut = mock.fn(() => {});

    // Re-require matcher to pick up mocks (cached, so just require)
    processSweepReply = require('../src/matcher').processSweepReply;
  });

  const config = { timezone: 'Asia/Ho_Chi_Minh' };

  it('returns null when no session exists', async () => {
    const result = await processSweepReply([1], 'chat-1', sweepSessions, 'A', config);
    assert.equal(result, null);
  });

  it('returns null when session expired', async () => {
    sweepSessions.set('chat-1', {
      date: '2026-04-07',
      createdAt: Date.now() - 5 * 60 * 60 * 1000,
      expiresAt: Date.now() - 60 * 1000,
      vehicles: [{ vehicleId: 'VH-1', plate: '30A-12345' }],
    });
    const result = await processSweepReply([1], 'chat-1', sweepSessions, 'A', config);
    assert.equal(result, null);
    assert.equal(sweepSessions.has('chat-1'), false, 'expired session cleared');
  });

  it('closes valid vehicles and clears session', async () => {
    sweepSessions.set('chat-1', {
      date: '2026-04-07',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60 * 60 * 1000,
      vehicles: [
        { vehicleId: 'VH-1', plate: '30A-11111' },
        { vehicleId: 'VH-2', plate: '30A-22222' },
        { vehicleId: 'VH-3', plate: '30A-33333' },
      ],
    });

    const result = await processSweepReply([1, 3], 'chat-1', sweepSessions, 'BaoVe', config);
    assert.ok(result.replyMessage);
    assert.match(result.replyMessage, /Đã đóng 2 xe/);
    assert.match(result.replyMessage, /30A-11111/);
    assert.match(result.replyMessage, /30A-33333/);
    assert.match(result.replyMessage, /BaoVe/);
    // Session is cleared after any reply (current behavior — see comment in matcher.js)
    assert.equal(sweepSessions.has('chat-1'), false);
  });

  it('reports invalid indices but processes valid ones', async () => {
    sweepSessions.set('chat-1', {
      date: '2026-04-07',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60 * 60 * 1000,
      vehicles: [{ vehicleId: 'VH-1', plate: '30A-11111' }],
    });

    const result = await processSweepReply([1, 99], 'chat-1', sweepSessions, 'A', config);
    assert.match(result.replyMessage, /Đã đóng 1 xe/);
    assert.match(result.replyMessage, /99 không có trong list/);
  });

  it('returns warning when all indices are out of range', async () => {
    sweepSessions.set('chat-1', {
      date: '2026-04-07',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60 * 60 * 1000,
      vehicles: [{ vehicleId: 'VH-1', plate: '30A-11111' }],
    });

    const result = await processSweepReply([5, 10], 'chat-1', sweepSessions, 'A', config);
    assert.match(result.replyMessage, /không có trong danh sách/);
    assert.match(result.replyMessage, /chỉ có 1-1/);
    // Session preserved so guard can retry
    assert.equal(sweepSessions.has('chat-1'), true);
  });

  it('handles forceExitVehicle returning null (already closed)', async () => {
    sweepSessions.set('chat-1', {
      date: '2026-04-07',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60 * 60 * 1000,
      vehicles: [{ vehicleId: 'VH-FAIL', plate: '30A-FAIL' }],
    });

    const result = await processSweepReply([1], 'chat-1', sweepSessions, 'A', config);
    assert.match(result.replyMessage, /đã được đóng trước đó/);
  });

  it('handles forceExitVehicle throwing', async () => {
    sweepSessions.set('chat-1', {
      date: '2026-04-07',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60 * 60 * 1000,
      vehicles: [{ vehicleId: 'VH-THROW', plate: '30A-ERR' }],
    });

    const result = await processSweepReply([1], 'chat-1', sweepSessions, 'A', config);
    assert.match(result.replyMessage, /lỗi: db down/);
  });
});
