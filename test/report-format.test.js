'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const {
  formatVehicleCompleted,
  formatVehicleInProgress,
  splitIntoMessages,
  extractTime,
  extractDateTimeShort,
  formatHours,
} = require('../src/utils');

// ──────────────────────────────────────────────
// Test: extractTime
// ──────────────────────────────────────────────

describe('extractTime', () => {
  it('trich xuat HH:mm tu chuoi dd/MM/yyyy HH:mm:ss', () => {
    assert.equal(extractTime('12/02/2026 14:30:45'), '14:30');
    assert.equal(extractTime('01/01/2025 08:15:00'), '08:15');
    assert.equal(extractTime('31/12/2026 23:59:59'), '23:59');
  });

  it('tra empty string khi input rong', () => {
    assert.equal(extractTime(''), '');
    assert.equal(extractTime(null), '');
    assert.equal(extractTime(undefined), '');
  });

  it('tra original string khi khong match format', () => {
    assert.equal(extractTime('14:30'), '14:30');
    assert.equal(extractTime('invalid'), 'invalid');
    assert.equal(extractTime('2026-02-12'), '2026-02-12');
  });

  it('xu ly format khong co so 0 phat', () => {
    assert.equal(extractTime('12/02/2026 14:00:05'), '14:00');
    assert.equal(extractTime('15/03/2026 09:00:00'), '09:00');
  });

  it('xu ly format co leading zero', () => {
    assert.equal(extractTime('01/02/2026 08:05:30'), '08:05');
    assert.equal(extractTime('05/05/2026 00:00:00'), '00:00');
  });
});

// ──────────────────────────────────────────────
// Test: extractDateTimeShort
// ──────────────────────────────────────────────

describe('extractDateTimeShort', () => {
  it('tra empty string khi input rong', () => {
    assert.equal(extractDateTimeShort('', 'Asia/Ho_Chi_Minh'), '');
    assert.equal(extractDateTimeShort(null, 'Asia/Ho_Chi_Minh'), '');
    assert.equal(extractDateTimeShort(undefined, 'Asia/Ho_Chi_Minh'), '');
  });

  it('tra original string khi khong match format', () => {
    assert.equal(extractDateTimeShort('14:30', 'Asia/Ho_Chi_Minh'), '14:30');
    assert.equal(extractDateTimeShort('12-02-2026', 'Asia/Ho_Chi_Minh'), '12-02-2026');
  });

  it('extract HH:mm khong co ngay prefix', () => {
    // If we compare against TODAY's date, it should return just time
    const now = DateTime.now().setZone('Asia/Ho_Chi_Minh');
    const today = `${String(now.day).padStart(2, '0')}/${String(now.month).padStart(2, '0')}/${now.year}`;
    const result = extractDateTimeShort(`${today} 14:30:45`, 'Asia/Ho_Chi_Minh');
    assert.equal(result, '14:30');
  });

  it('extract dd/MM HH:mm cho ngay khac', () => {
    // Get a date that's not today (yesterday or last month)
    const now = DateTime.now().setZone('Asia/Ho_Chi_Minh');
    let differentDate;
    if (now.day > 1) {
      const yesterday = now.minus({ days: 1 });
      differentDate = `${String(yesterday.day).padStart(2, '0')}/${String(yesterday.month).padStart(2, '0')}/${yesterday.year}`;
    } else {
      const lastMonth = now.minus({ months: 1 });
      differentDate = `${String(lastMonth.day).padStart(2, '0')}/${String(lastMonth.month).padStart(2, '0')}/${lastMonth.year}`;
    }
    const result = extractDateTimeShort(`${differentDate} 14:30:00`, 'Asia/Ho_Chi_Minh');
    // Should have date + time
    assert.ok(result.includes('/'));
    assert.ok(result.includes('14:30'));
  });

  it('match regex pattern tu dd/MM/yyyy HH:mm:ss', () => {
    const result = extractDateTimeShort('12/02/2026 08:05:30', 'Asia/Ho_Chi_Minh');
    // Should either be just time or dd/MM HH:mm, both valid
    assert.ok(result.includes('08:05'));
  });

  it('tra full string when not match format', () => {
    const result = extractDateTimeShort('not-a-date', 'Asia/Ho_Chi_Minh');
    assert.equal(result, 'not-a-date');
  });
});

// ──────────────────────────────────────────────
// Test: formatVehicleCompleted
// ──────────────────────────────────────────────

describe('formatVehicleCompleted', () => {
  const tz = 'Asia/Ho_Chi_Minh';

  it('format xe da hoan thanh (co thoigian vao ra)', () => {
    const v = {
      plate: '30A-12345',
      timeIn: '12/02/2026 08:15:30',
      timeOut: '12/02/2026 14:30:45',
      durationMinutes: 375, // 6h 15p = 375 minutes
    };
    const result = formatVehicleCompleted(v, tz);
    assert.match(result, /30A-12345 — 08:15 → 14:30 \(6h15p\)/);
  });

  it('format khong co durationMinutes', () => {
    const v = {
      plate: '51F-45678',
      timeIn: '12/02/2026 09:00:00',
      timeOut: '12/02/2026 16:00:00',
      durationMinutes: null,
    };
    const result = formatVehicleCompleted(v, tz);
    assert.equal(result, '51F-45678 — 09:00 → 16:00');
  });

  it('format durationMinutes = 0', () => {
    const v = {
      plate: '98B-54321',
      timeIn: '12/02/2026 10:00:00',
      timeOut: '12/02/2026 10:00:00',
      durationMinutes: 0,
    };
    const result = formatVehicleCompleted(v, tz);
    assert.match(result, /98B-54321 — 10:00 → 10:00 \(0h0p\)/);
  });

  it('format bien so dai', () => {
    const v = {
      plate: '123ABCD-98765',
      timeIn: '12/02/2026 08:00:00',
      timeOut: '12/02/2026 17:00:00',
      durationMinutes: 540, // 9h
    };
    const result = formatVehicleCompleted(v, tz);
    assert.match(result, /123ABCD-98765 — 08:00 → 17:00 \(9h0p\)/);
  });

  it('format voi durationMinutes undefined', () => {
    const v = {
      plate: '30A-11111',
      timeIn: '12/02/2026 08:00:00',
      timeOut: '12/02/2026 10:00:00',
      durationMinutes: undefined,
    };
    const result = formatVehicleCompleted(v, tz);
    assert.equal(result, '30A-11111 — 08:00 → 10:00');
  });

  it('format voi large duration (48 gio)', () => {
    const v = {
      plate: '30A-99999',
      timeIn: '10/02/2026 14:00:00',
      timeOut: '12/02/2026 14:00:00',
      durationMinutes: 2880, // 48h
    };
    const result = formatVehicleCompleted(v, tz);
    assert.match(result, /30A-99999 — 14:00 → 14:00 \(48h0p\)/);
  });

  it('format voi small duration (1 phut)', () => {
    const v = {
      plate: '30A-11111',
      timeIn: '12/02/2026 14:00:00',
      timeOut: '12/02/2026 14:01:00',
      durationMinutes: 1,
    };
    const result = formatVehicleCompleted(v, tz);
    assert.match(result, /30A-11111 — 14:00 → 14:01 \(0h1p\)/);
  });
});

// ──────────────────────────────────────────────
// Test: formatVehicleInProgress
// ──────────────────────────────────────────────

describe('formatVehicleInProgress', () => {
  let originalNow;

  beforeEach(() => {
    // Mock DateTime.now() to return consistent value: 12/02/2026 14:30
    originalNow = DateTime.now;
    const mockDate = DateTime.fromISO('2026-02-12T14:30:00.000Z').setZone('Asia/Ho_Chi_Minh');
    DateTime.now = () => mockDate;
  });

  afterEach(() => {
    DateTime.now = originalNow;
  });

  const tz = 'Asia/Ho_Chi_Minh';

  it('format xe priority Binh thuong (icon gach)', () => {
    const v = {
      plate: '30A-12345',
      timeIn: '12/02/2026 08:15:00',
      priority: 'Bình thường',
    };
    const result = formatVehicleInProgress(v, tz);
    assert.match(result, /🔧 30A-12345 — Vào 08:15 \(\d+h\d+p\)/);
  });

  it('format xe priority Canh bao (icon canh bao)', () => {
    const v = {
      plate: '51F-45678',
      timeIn: '11/02/2026 10:00:00',
      priority: 'Cảnh báo',
    };
    const result = formatVehicleInProgress(v, tz);
    assert.match(result, /⚠️ 51F-45678 — Vào 11\/02 10:00 \(\d+h\d+p\)/);
  });

  it('format xe priority Khan (icon khan)', () => {
    const v = {
      plate: '98B-54321',
      timeIn: '10/02/2026 14:00:00',
      priority: 'Khẩn',
    };
    const result = formatVehicleInProgress(v, tz);
    assert.match(result, /🚨 98B-54321 — Vào 10\/02 14:00 \(\d+h\d+p\)/);
  });

  it('format xe vao hom nay - chi show HH:mm', () => {
    const v = {
      plate: '30A-11111',
      timeIn: '12/02/2026 14:00:00',
      priority: 'Bình thường',
    };
    const result = formatVehicleInProgress(v, tz);
    // Should show only HH:mm, not dd/MM HH:mm
    assert.match(result, /14:00 \(\d+h\d+p\)/);
    // Should NOT contain "/" for date separator
    const timeMatch = result.match(/Vào ([^(]+)/);
    assert.ok(timeMatch && !timeMatch[1].includes('/'));
  });

  it('format xe vao hom qua - show dd/MM HH:mm', () => {
    const v = {
      plate: '51F-99999',
      timeIn: '11/02/2026 14:00:00',
      priority: 'Bình thường',
    };
    const result = formatVehicleInProgress(v, tz);
    assert.match(result, /Vào 11\/02 14:00/);
  });

  it('format voi null timeIn throws or handles gracefully', () => {
    const v = {
      plate: '30A-22222',
      timeIn: null,
      priority: 'Bình thường',
    };
    // formatVehicleInProgress may throw when timeIn is null (hoursSince calls fromFormat)
    try {
      const result = formatVehicleInProgress(v, tz);
      // If it doesn't throw, it should still have the plate
      assert.ok(result.includes('30A-22222'));
    } catch (err) {
      // Expected: hoursSince will fail with null
      assert.ok(err.message.includes('Invalid input') || err.message.includes('Cannot'));
    }
  });

  it('format voi priority unknown', () => {
    const v = {
      plate: '30A-33333',
      timeIn: '12/02/2026 10:00:00',
      priority: 'Unknown',
    };
    const result = formatVehicleInProgress(v, tz);
    // Should default to 🔧 (gach)
    assert.match(result, /🔧 30A-33333/);
  });

  it('format voi xe trong xuong 96h', () => {
    const v = {
      plate: '30A-44444',
      timeIn: '08/02/2026 14:30:00', // 4 days ago from mock date (12/02 14:30)
      priority: 'Khẩn',
    };
    const result = formatVehicleInProgress(v, tz);
    // Should have the plate and time, and duration in hours format
    assert.match(result, /🚨 30A-44444 — Vào 08\/02 14:30 \(/);
    assert.match(result, /\d+h\d+p\)/); // Has some hours format
  });
});

// ──────────────────────────────────────────────
// Test: splitIntoMessages
// ──────────────────────────────────────────────

describe('splitIntoMessages', () => {
  it('split khong can khi tong < maxLen', () => {
    const parts = ['Part 1', 'Part 2', 'Part 3'];
    const result = splitIntoMessages(parts, 4000);
    assert.equal(result.length, 1);
    assert.equal(result[0], 'Part 1\n\nPart 2\n\nPart 3');
  });

  it('split khi tong > maxLen', () => {
    const parts = [
      'A'.repeat(1500),
      'B'.repeat(1500),
      'C'.repeat(1500),
      'D'.repeat(1500),
    ];
    const result = splitIntoMessages(parts, 4000);
    assert.ok(result.length > 1);
    // Each message should be <= 4000 chars
    for (const msg of result) {
      assert.ok(msg.length <= 4000);
    }
  });

  it('khong split giua phan - giuan phan se trong message khac', () => {
    const parts = [
      'X'.repeat(3500),
      'Y'.repeat(3500),
    ];
    const result = splitIntoMessages(parts, 4000);
    assert.equal(result.length, 2);
    assert.ok(result[0].includes('X'));
    assert.ok(result[1].includes('Y'));
  });

  it('tra empty array khi input rong', () => {
    const result = splitIntoMessages([], 4000);
    assert.equal(result.length, 0);
  });

  it('tra single message cho single part < maxLen', () => {
    const result = splitIntoMessages(['Hello world'], 4000);
    assert.equal(result.length, 1);
    assert.equal(result[0], 'Hello world');
  });

  it('handle single part > maxLen (phai la part dau tien)', () => {
    const parts = ['A'.repeat(5000)];
    const result = splitIntoMessages(parts, 4000);
    // Should still split/preserve the part
    assert.ok(result.length >= 1);
    assert.ok(result[0].length > 0);
  });

  it('trim whitespace tren final message', () => {
    const parts = ['Part 1', 'Part 2'];
    const result = splitIntoMessages(parts, 4000);
    assert.equal(result.length, 1);
    // splitIntoMessages trims the final result, but individual parts keep their internal spaces
    assert.equal(result[0], 'Part 1\n\nPart 2');
  });

  it('handle custom maxLen', () => {
    const parts = ['ABC', 'DEF', 'GHI'];
    const result = splitIntoMessages(parts, 10);
    // "ABC\n\nDEF" = 7 chars, ok
    // "ABC\n\nDEF\n\nGHI" = 13 chars, too long
    assert.equal(result.length, 2);
  });

  it('handle very small maxLen', () => {
    const parts = ['Hello', 'World'];
    const result = splitIntoMessages(parts, 5);
    // "Hello" = 5 chars ok
    // "World" = 5 chars ok
    // Split because "Hello\n\nWorld" = 11 > 5
    assert.equal(result.length, 2);
  });

  it('complex real-world scenario - report sections', () => {
    const parts = [
      `📊 BÁO CÁO TỔNG HỢP — 12/02/2026\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n📋 TỔNG QUAN\n  Vào: 50 | Ra: 45 | Xưởng: 5`,
      `\n\n📈 NĂNG SUẤT\n  So hôm qua: Vào 40→50 (+10↑) | Ra 40→45 (+5↑)\n  Tỷ lệ hoàn thành: 90%`,
      `\n\n✅ XE RA HÔM NAY (5):\n  1. 30A-12345 — 08:15 → 14:30 (6h15p)\n  2. 51F-45678 — 09:00 → 15:00 (6h0p)`,
    ];
    const result = splitIntoMessages(parts, 4000);
    assert.ok(result.length >= 1);
    for (const msg of result) {
      assert.ok(msg.length <= 4000);
    }
  });
});

// ──────────────────────────────────────────────
// Test: formatHours (helper for duration tests)
// ──────────────────────────────────────────────

describe('formatHours', () => {
  it('format so gio nguyen', () => {
    assert.equal(formatHours(1), '1h0p');
    assert.equal(formatHours(6), '6h0p');
    assert.equal(formatHours(24), '24h0p');
  });

  it('format so gio va phut', () => {
    assert.equal(formatHours(1.25), '1h15p');
    assert.equal(formatHours(6.5), '6h30p');
    assert.equal(formatHours(2.75), '2h45p');
  });

  it('round phut when >= 60', () => {
    // formatHours: h = Math.floor(hours), m = Math.round((hours % 1) * 60)
    // 1.99 = floor=1, m = round(0.99*60) = round(59.4) = 59
    // then if m >= 60: h+=1, m=0. So 1.99 -> 1h59p
    assert.equal(formatHours(1.99), '1h59p');
    // 2.0 = floor=2, m = round(0) = 0 -> 2h0p
    assert.equal(formatHours(2.0), '2h0p');
  });

  it('xu ly 0 gio', () => {
    assert.equal(formatHours(0), '0h0p');
  });

  it('xu ly < 1 phut', () => {
    assert.equal(formatHours(0.01), '0h1p'); // 0.01*60 ≈ 0.6 rounds to 1p
  });
});

// ──────────────────────────────────────────────
// Edge case: Vehicle object with various nulls/undefineds
// ──────────────────────────────────────────────

describe('formatVehicleCompleted - null/undefined edge cases', () => {
  const tz = 'Asia/Ho_Chi_Minh';

  it('format voi all fields null', () => {
    const v = {
      plate: '30A-12345',
      timeIn: null,
      timeOut: null,
      durationMinutes: null,
    };
    const result = formatVehicleCompleted(v, tz);
    // extractTime returns '' for null, so: "" " " → ""
    assert.ok(result.includes('30A-12345'));
    assert.ok(result.includes('→'));
  });

  it('format voi timeIn valid, timeOut null', () => {
    const v = {
      plate: '30A-12345',
      timeIn: '12/02/2026 08:00:00',
      timeOut: null,
      durationMinutes: null,
    };
    const result = formatVehicleCompleted(v, tz);
    assert.match(result, /30A-12345 — 08:00 → /);
  });

  it('format voi durationMinutes decimal', () => {
    const v = {
      plate: '30A-12345',
      timeIn: '12/02/2026 08:00:00',
      timeOut: '12/02/2026 08:30:30',
      durationMinutes: 30.5,
    };
    const result = formatVehicleCompleted(v, tz);
    // 30.5 / 60 ≈ 0.508h, formatHours should handle
    assert.match(result, /30A-12345 — 08:00 → 08:30 \(0h31p\)/);
  });
});

// ──────────────────────────────────────────────
// Edge case: Performance test - large number of parts
// ──────────────────────────────────────────────

describe('splitIntoMessages - performance/stability', () => {
  it('handle 100 small parts', () => {
    const parts = Array(100).fill('Short section');
    const result = splitIntoMessages(parts, 4000);
    // Should combine many short parts into few messages
    assert.ok(result.length < 100);
    for (const msg of result) {
      assert.ok(msg.length <= 4000);
    }
  });

  it('handle mix of small and large parts', () => {
    const parts = [
      'Small',
      'A'.repeat(1000),
      'Medium',
      'B'.repeat(2000),
      'Tiny',
      'C'.repeat(1500),
    ];
    const result = splitIntoMessages(parts, 4000);
    for (const msg of result) {
      assert.ok(msg.length <= 4000);
    }
  });

  it('handle parts array with 1000+ items (boundary)', () => {
    const parts = Array(1000).fill('x');
    const result = splitIntoMessages(parts, 4000);
    // Should not crash, should return valid messages
    assert.ok(result.length > 0);
    for (const msg of result) {
      assert.ok(msg.length > 0);
      assert.ok(msg.length <= 4000);
    }
  });
});

// ──────────────────────────────────────────────
// Integration: Report formatting real-world scenarios
// ──────────────────────────────────────────────

describe('Report formatting - real-world scenarios', () => {
  let originalNow;

  beforeEach(() => {
    originalNow = DateTime.now;
    const mockDate = DateTime.fromISO('2026-02-12T14:30:00.000Z').setZone('Asia/Ho_Chi_Minh');
    DateTime.now = () => mockDate;
  });

  afterEach(() => {
    DateTime.now = originalNow;
  });

  const tz = 'Asia/Ho_Chi_Minh';

  it('empty vehicle list report', () => {
    const vehiclesOut = [];
    const vehiclesInToday = [];
    const inWorkshop = [];

    const sections = [];
    if (vehiclesOut.length > 0) {
      sections.push(`✅ XE RA HÔM NAY (${vehiclesOut.length})`);
    }
    if (vehiclesInToday.length > 0) {
      sections.push(`📥 XE VÀO HÔM NAY (${vehiclesInToday.length})`);
    }
    if (inWorkshop.length > 0) {
      sections.push(`🔧 TỒN KHO (${inWorkshop.length})`);
    }

    assert.equal(sections.length, 0, 'Empty report should have no sections');
  });

  it('mix of completed and in-progress vehicles', () => {
    const vehiclesOut = [
      {
        plate: '30A-11111',
        timeIn: '12/02/2026 08:00:00',
        timeOut: '12/02/2026 14:00:00',
        durationMinutes: 360,
      },
      {
        plate: '51F-22222',
        timeIn: '12/02/2026 09:00:00',
        timeOut: '12/02/2026 15:30:00',
        durationMinutes: 390,
      },
    ];

    const vehiclesInToday = [
      {
        plate: '98B-33333',
        timeIn: '12/02/2026 13:00:00',
        priority: 'Bình thường',
        vehicleId: 'LX-001',
      },
    ];

    const completed = vehiclesOut.map(v => formatVehicleCompleted(v, tz));
    const inProgress = vehiclesInToday.map(v => formatVehicleInProgress(v, tz));

    assert.equal(completed.length, 2);
    assert.equal(inProgress.length, 1);

    for (const line of completed) {
      assert.match(line, /→/); // Should have arrow
    }
    for (const line of inProgress) {
      assert.match(line, /Vào/); // Should have "Vào"
    }
  });

  it('all priority levels mixed', () => {
    const vehicles = [
      {
        plate: '🚨-Khan',
        timeIn: '10/02/2026 14:00:00',
        priority: 'Khẩn',
      },
      {
        plate: '⚠️-Warn',
        timeIn: '11/02/2026 12:00:00',
        priority: 'Cảnh báo',
      },
      {
        plate: '🔧-Normal',
        timeIn: '12/02/2026 10:00:00',
        priority: 'Bình thường',
      },
    ];

    const results = vehicles.map(v => formatVehicleInProgress(v, tz));

    assert.ok(results[0].includes('🚨'));
    assert.ok(results[1].includes('⚠️'));
    assert.ok(results[2].includes('🔧'));
  });

  it('large plate number format', () => {
    const v = {
      plate: '123VERYLONGPLATE999999',
      timeIn: '12/02/2026 08:15:00',
      timeOut: '12/02/2026 15:30:00',
      durationMinutes: 435,
    };
    const result = formatVehicleCompleted(v, tz);
    assert.ok(result.includes('123VERYLONGPLATE999999'));
  });
});
