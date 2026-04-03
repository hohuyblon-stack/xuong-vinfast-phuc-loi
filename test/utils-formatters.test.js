'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const {
  formatKPIDashboard,
  formatActionRequired,
  formatPredictiveAlerts,
  formatTodayEntries,
  formatCompletedSection,
  formatSpecialAttention,
  formatChecklist,
  formatMorningBriefing,
  computeThresholdTime,
  nowFormatted,
  hoursSince,
  formatVehicleInProgress,
} = require('../src/utils');

const tz = 'Asia/Ho_Chi_Minh';

// ──────────────────────────────────────────────
// Mock DateTime.now for deterministic tests
// ──────────────────────────────────────────────

let originalNow;

function mockNow(isoString) {
  originalNow = DateTime.now;
  const mock = DateTime.fromISO(isoString).setZone(tz);
  DateTime.now = () => mock;
}

function restoreNow() {
  if (originalNow) DateTime.now = originalNow;
}

// ──────────────────────────────────────────────
// nowFormatted
// ──────────────────────────────────────────────

describe('nowFormatted', () => {
  beforeEach(() => mockNow('2026-04-03T08:30:00.000+07:00'));
  afterEach(restoreNow);

  it('returns formatted current time', () => {
    const result = nowFormatted(tz);
    assert.equal(result, '03/04/2026 08:30:00');
  });
});

// ──────────────────────────────────────────────
// hoursSince
// ──────────────────────────────────────────────

describe('hoursSince', () => {
  beforeEach(() => mockNow('2026-04-03T14:00:00.000+07:00'));
  afterEach(restoreNow);

  it('returns hours since a past time', () => {
    const hours = hoursSince('03/04/2026 08:00:00', tz);
    assert.ok(Math.abs(hours - 6) < 0.01);
  });

  it('returns 0 for invalid input', () => {
    assert.equal(hoursSince('invalid', tz), 0);
  });
});

// ──────────────────────────────────────────────
// computeThresholdTime
// ──────────────────────────────────────────────

describe('computeThresholdTime', () => {
  it('computes correct threshold time', () => {
    const result = computeThresholdTime('03/04/2026 08:00:00', 24, tz);
    assert.equal(result, '08:00');
  });

  it('returns ??:?? for invalid input', () => {
    assert.equal(computeThresholdTime('invalid', 24, tz), '??:??');
  });
});

// ──────────────────────────────────────────────
// formatKPIDashboard
// ──────────────────────────────────────────────

describe('formatKPIDashboard', () => {
  it('formats complete KPI dashboard', () => {
    const result = formatKPIDashboard({
      data: {
        today: '03/04/2026',
        inWorkshopCount: 45,
        totalIn: 12,
        totalOut: 10,
        completionRate: 83,
        avgDuration: 240,
        fastestVehicle: { plate: '30A-111', durationMinutes: 60 },
        slowestVehicle: { plate: '30A-222', durationMinutes: 600 },
        yesterdayIn: 10,
        yesterdayOut: 8,
      },
      weeklyAvg: { avgDailyIn: 11, avgDailyOut: 9, avgDuration: 230 },
      capacityForecast: { available: 85, utilizationPct: 35, recommendation: '✅ THOẢI MÁI' },
    });

    assert.ok(result.includes('BÁO CÁO CUỐI NGÀY'));
    assert.ok(result.includes('Tồn kho: 45'));
    assert.ok(result.includes('Vào: 12'));
    assert.ok(result.includes('Ra: 10'));
    assert.ok(result.includes('So hôm qua'));
    assert.ok(result.includes('Capacity'));
  });

  it('handles zero avgDuration', () => {
    const result = formatKPIDashboard({
      data: {
        today: '03/04/2026', inWorkshopCount: 0, totalIn: 0, totalOut: 0,
        completionRate: 0, avgDuration: 0,
        fastestVehicle: null, slowestVehicle: null,
        yesterdayIn: 0, yesterdayOut: 0,
      },
      weeklyAvg: { avgDailyIn: 0, avgDailyOut: 0, avgDuration: 0 },
      capacityForecast: { available: 130, utilizationPct: 0, recommendation: '✅ THOẢI MÁI' },
    });
    assert.ok(result.includes('N/A'));
  });

  it('shows weekly comparison when avgDailyIn > 0', () => {
    const result = formatKPIDashboard({
      data: {
        today: '03/04/2026', inWorkshopCount: 50, totalIn: 20, totalOut: 15,
        completionRate: 75, avgDuration: 300,
        fastestVehicle: { durationMinutes: 60 }, slowestVehicle: { durationMinutes: 800 },
        yesterdayIn: 18, yesterdayOut: 16,
      },
      weeklyAvg: { avgDailyIn: 10, avgDailyOut: 10, avgDuration: 250 },
      capacityForecast: { available: 80, utilizationPct: 38, recommendation: '✅ THOẢI MÁI' },
    });
    assert.ok(result.includes('So 7 ngày'));
  });
});

// ──────────────────────────────────────────────
// formatActionRequired
// ──────────────────────────────────────────────

describe('formatActionRequired', () => {
  beforeEach(() => mockNow('2026-04-03T18:00:00.000+07:00'));
  afterEach(restoreNow);

  it('returns null when no urgent/warning vehicles', () => {
    assert.equal(formatActionRequired([], [], tz), null);
  });

  it('formats urgent vehicles', () => {
    const urgent = [{ plate: '30A-111', hoursIn: 52, timeIn: '01/04/2026 14:00:00' }];
    const result = formatActionRequired(urgent, [], tz);
    assert.ok(result.includes('CẦN HÀNH ĐỘNG NGAY'));
    assert.ok(result.includes('Khẩn >48h'));
    assert.ok(result.includes('30A-111'));
  });

  it('formats warning vehicles', () => {
    const warning = [{ plate: '51F-222', hoursIn: 30, timeIn: '02/04/2026 12:00:00' }];
    const result = formatActionRequired([], warning, tz);
    assert.ok(result.includes('Cảnh báo >24h'));
    assert.ok(result.includes('51F-222'));
  });

  it('formats both urgent and warning', () => {
    const urgent = [{ plate: '30A-111', hoursIn: 52, timeIn: '01/04/2026 14:00:00' }];
    const warning = [{ plate: '51F-222', hoursIn: 30, timeIn: '02/04/2026 12:00:00' }];
    const result = formatActionRequired(urgent, warning, tz);
    assert.ok(result.includes('2 xe'));
  });
});

// ──────────────────────────────────────────────
// formatPredictiveAlerts
// ──────────────────────────────────────────────

describe('formatPredictiveAlerts', () => {
  it('returns null when no approaching vehicles', () => {
    assert.equal(formatPredictiveAlerts({ approaching24h: [], approaching48h: [] }, tz), null);
  });

  it('formats approaching 24h alerts', () => {
    const predictions = {
      approaching24h: [{ plate: '30A-111', hoursIn: 20, timeIn: '02/04/2026 22:00:00' }],
      approaching48h: [],
    };
    const result = formatPredictiveAlerts(predictions, tz);
    assert.ok(result.includes('SẮP CHẠM NGƯỠNG'));
    assert.ok(result.includes('Chạm 24h'));
    assert.ok(result.includes('30A-111'));
  });

  it('formats approaching 48h alerts', () => {
    const predictions = {
      approaching24h: [],
      approaching48h: [{ plate: '51F-222', hoursIn: 42, timeIn: '01/04/2026 22:00:00' }],
    };
    const result = formatPredictiveAlerts(predictions, tz);
    assert.ok(result.includes('Chạm 48h'));
    assert.ok(result.includes('51F-222'));
  });
});

// ──────────────────────────────────────────────
// formatTodayEntries
// ──────────────────────────────────────────────

describe('formatTodayEntries', () => {
  beforeEach(() => mockNow('2026-04-03T16:00:00.000+07:00'));
  afterEach(restoreNow);

  it('returns null when no vehicles entered today', () => {
    assert.equal(formatTodayEntries([], [], { p90: 480 }, tz), null);
  });

  it('formats morning and afternoon entries', () => {
    const vehicles = [
      { plate: '30A-111', timeIn: '03/04/2026 08:00:00', priority: 'Bình thường' },
      { plate: '51F-222', timeIn: '03/04/2026 14:00:00', priority: 'Bình thường' },
    ];
    const result = formatTodayEntries(vehicles, [], { p90: 480 }, tz);
    assert.ok(result.includes('VÀO HÔM NAY'));
    assert.ok(result.includes('Sáng'));
    assert.ok(result.includes('Chiều'));
    assert.ok(result.includes('2 xe'));
  });

  it('highlights slow vehicles exceeding p90', () => {
    const vehicles = [
      { plate: '30A-SLOW', timeIn: '02/04/2026 08:00:00', priority: 'Cảnh báo' },
    ];
    const result = formatTodayEntries(vehicles, [], { p90: 60 }, tz);
    assert.ok(result.includes('Chậm hơn bình thường'));
    assert.ok(result.includes('30A-SLOW'));
  });

  it('limits slow vehicle display to 5', () => {
    const vehicles = Array.from({ length: 8 }, (_, i) => ({
      plate: `30A-${String(i).padStart(5, '0')}`,
      timeIn: '02/04/2026 08:00:00',
      priority: 'Cảnh báo',
    }));
    const result = formatTodayEntries(vehicles, [], { p90: 60 }, tz);
    assert.ok(result.includes('và 3 xe nữa'));
  });
});

// ──────────────────────────────────────────────
// formatCompletedSection
// ──────────────────────────────────────────────

describe('formatCompletedSection', () => {
  it('returns null when no completed vehicles', () => {
    assert.equal(formatCompletedSection([], { p90: 480 }, { avgDuration: 300 }, tz), null);
  });

  it('formats completed vehicles with speed buckets', () => {
    const vehicles = [
      { plate: '30A-FAST', durationMinutes: 120, timeIn: '03/04/2026 08:00:00', timeOut: '03/04/2026 10:00:00' },
      { plate: '30A-NORM', durationMinutes: 270, timeIn: '03/04/2026 08:00:00', timeOut: '03/04/2026 12:30:00' },
      { plate: '30A-SLOW', durationMinutes: 420, timeIn: '03/04/2026 08:00:00', timeOut: '03/04/2026 15:00:00' },
      { plate: '30A-CRIT', durationMinutes: 600, timeIn: '03/04/2026 06:00:00', timeOut: '03/04/2026 16:00:00' },
    ];
    const result = formatCompletedSection(vehicles, { p90: 480 }, { avgDuration: 300 }, tz);
    assert.ok(result.includes('ĐÃ RA HÔM NAY'));
    assert.ok(result.includes('Nhanh (<3h)'));
    assert.ok(result.includes('Rất chậm (>8h)'));
    assert.ok(result.includes('Nhanh nhất'));
    assert.ok(result.includes('Chậm nhất'));
    assert.ok(result.includes('30A-FAST'));
    assert.ok(result.includes('30A-CRIT'));
  });

  it('lists critical vehicles (>8h)', () => {
    const vehicles = [
      { plate: '30A-CRIT1', durationMinutes: 600, timeIn: '03/04/2026 06:00:00', timeOut: '03/04/2026 16:00:00' },
      { plate: '30A-CRIT2', durationMinutes: 720, timeIn: '03/04/2026 05:00:00', timeOut: '03/04/2026 17:00:00' },
    ];
    const result = formatCompletedSection(vehicles, { p90: 480 }, { avgDuration: 300 }, tz);
    assert.ok(result.includes('kiểm tra nguyên nhân'));
    assert.ok(result.includes('30A-CRIT2'));
  });
});

// ──────────────────────────────────────────────
// formatSpecialAttention
// ──────────────────────────────────────────────

describe('formatSpecialAttention', () => {
  it('returns null when no repeats or anomalies', () => {
    assert.equal(formatSpecialAttention([], [], tz), null);
  });

  it('formats repeat visitors', () => {
    const repeats = [{ plate: '30A-RPT', visitCount: 3 }];
    const result = formatSpecialAttention(repeats, [], tz);
    assert.ok(result.includes('CHÚ Ý ĐẶC BIỆT'));
    assert.ok(result.includes('Xe quay lại'));
    assert.ok(result.includes('30A-RPT'));
    assert.ok(result.includes('lần 3'));
  });

  it('formats anomalies', () => {
    const anomalies = [{ plate: '51F-ANM', actual: 15, expectedMax: 480 }];
    const result = formatSpecialAttention([], anomalies, tz);
    assert.ok(result.includes('Xe bất thường'));
    assert.ok(result.includes('51F-ANM'));
  });

  it('limits display to 3 each', () => {
    const repeats = Array.from({ length: 5 }, (_, i) => ({ plate: `RPT-${i}`, visitCount: 2 }));
    const anomalies = Array.from({ length: 5 }, (_, i) => ({ plate: `ANM-${i}`, actual: 20, expectedMax: 480 }));
    const result = formatSpecialAttention(repeats, anomalies, tz);
    // Should only show 3 of each
    const rptMatches = result.match(/RPT-/g);
    const anmMatches = result.match(/ANM-/g);
    assert.equal(rptMatches.length, 3);
    assert.equal(anmMatches.length, 3);
  });
});

// ──────────────────────────────────────────────
// formatChecklist
// ──────────────────────────────────────────────

describe('formatChecklist', () => {
  it('formats checklist items', () => {
    const items = [
      { text: 'Tồn kho qua đêm: 45 xe' },
      { text: 'Review OCR: 3 mục' },
    ];
    const result = formatChecklist(items);
    assert.ok(result.includes('CHECKLIST CUỐI NGÀY'));
    assert.ok(result.includes('☐ Tồn kho qua đêm: 45 xe'));
    assert.ok(result.includes('☐ Review OCR: 3 mục'));
  });
});

// ──────────────────────────────────────────────
// formatMorningBriefing
// ──────────────────────────────────────────────

describe('formatMorningBriefing', () => {
  it('formats complete morning briefing', () => {
    const result = formatMorningBriefing({
      today: '03/04/2026',
      inWorkshopCount: 45,
      urgentCount: 2,
      warningCount: 5,
      normalCount: 38,
      capacityForecast: { available: 85, utilizationPct: 35, recommendation: '✅ THOẢI MÁI' },
      approaching24h: [{ plate: '30A-111' }],
      approaching48h: [{ plate: '51F-222', timeIn: '01/04/2026 14:00:00', hoursUntil: 4 }],
      priorities: [{ rank: 1, text: 'Xử lý 2 xe Khẩn >48h trước 12h' }],
    });
    assert.ok(result.includes('SÁNG NAY'));
    assert.ok(result.includes('TỒN KHO: 45 xe'));
    assert.ok(result.includes('Khẩn >48h: 2'));
    assert.ok(result.includes('>24h: 5'));
    assert.ok(result.includes('SẮP CHẠM NGƯỠNG'));
    assert.ok(result.includes('ƯU TIÊN'));
  });

  it('omits sections when empty', () => {
    const result = formatMorningBriefing({
      today: '03/04/2026',
      inWorkshopCount: 5,
      urgentCount: 0,
      warningCount: 0,
      normalCount: 5,
      capacityForecast: { available: 125, utilizationPct: 4, recommendation: '✅ THOẢI MÁI' },
      approaching24h: [],
      approaching48h: [],
      priorities: [],
    });
    assert.ok(!result.includes('SẮP CHẠM NGƯỠNG'));
    assert.ok(!result.includes('ƯU TIÊN'));
    assert.ok(!result.includes('Khẩn'));
  });
});

// ──────────────────────────────────────────────
// formatVehicleInProgress — vehicleModel
// ──────────────────────────────────────────────

describe('formatVehicleInProgress - vehicleModel', () => {
  beforeEach(() => mockNow('2026-04-03T14:00:00.000+07:00'));
  afterEach(restoreNow);

  it('includes vehicle model when present', () => {
    const v = { plate: '30A-111', timeIn: '03/04/2026 08:00:00', priority: 'Bình thường', vehicleModel: 'VF 8' };
    const result = formatVehicleInProgress(v, tz);
    assert.ok(result.includes('(VF 8)'));
  });

  it('omits model parentheses when empty', () => {
    const v = { plate: '30A-111', timeIn: '03/04/2026 08:00:00', priority: 'Bình thường', vehicleModel: '' };
    const result = formatVehicleInProgress(v, tz);
    assert.ok(!result.includes('()'));
  });
});
