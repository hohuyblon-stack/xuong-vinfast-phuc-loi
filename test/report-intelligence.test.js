'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeDurationColor,
  computePredictiveAlerts,
  detectRepeatVisitors,
  detectAnomalies,
  computeCapacityForecast,
  compareToBaseline,
  bucketCompletedVehicles,
  buildProgressBar,
  generateChecklist,
  computeMorningPriorities,
  percentile,
} = require('../src/report-intelligence');

const THRESHOLDS = { fast: 3, normal: 5, slow: 8 };

// ──────────────────────────────────────────────
// computeDurationColor
// ──────────────────────────────────────────────

describe('computeDurationColor', () => {
  it('returns green for fast vehicles', () => {
    const r = computeDurationColor(1.5, THRESHOLDS);
    assert.equal(r.emoji, '🟢');
    assert.equal(r.label, 'nhanh');
  });

  it('returns yellow for normal duration', () => {
    const r = computeDurationColor(4, THRESHOLDS);
    assert.equal(r.emoji, '🟡');
  });

  it('returns orange for slow', () => {
    const r = computeDurationColor(6, THRESHOLDS);
    assert.equal(r.emoji, '🟠');
  });

  it('returns red for very slow', () => {
    const r = computeDurationColor(10, THRESHOLDS);
    assert.equal(r.emoji, '🔴');
    assert.equal(r.label, 'rất chậm');
  });

  it('returns green at exactly 0 hours', () => {
    const r = computeDurationColor(0, THRESHOLDS);
    assert.equal(r.emoji, '🟢');
  });

  it('boundary: exactly fast threshold returns yellow', () => {
    const r = computeDurationColor(3, THRESHOLDS);
    assert.equal(r.emoji, '🟡');
  });
});

// ──────────────────────────────────────────────
// computePredictiveAlerts
// ──────────────────────────────────────────────

describe('computePredictiveAlerts', () => {
  const alerts = { warningHours: 24, urgentHours: 48 };

  it('finds vehicles approaching 24h threshold', () => {
    const vehicles = [
      { plate: '30A-111', hoursIn: 20 },
      { plate: '30A-222', hoursIn: 10 },
      { plate: '30A-333', hoursIn: 25 }, // already past 24h
    ];
    const r = computePredictiveAlerts(vehicles, alerts, 12);
    assert.equal(r.approaching24h.length, 1);
    assert.equal(r.approaching24h[0].plate, '30A-111');
    assert.equal(r.approaching24h[0].hoursUntil, 4);
  });

  it('finds vehicles approaching 48h threshold', () => {
    const vehicles = [
      { plate: '30A-444', hoursIn: 40 },
      { plate: '30A-555', hoursIn: 50 }, // already past
    ];
    const r = computePredictiveAlerts(vehicles, alerts, 12);
    assert.equal(r.approaching48h.length, 1);
    assert.equal(r.approaching48h[0].plate, '30A-444');
  });

  it('returns empty arrays when no vehicles approaching', () => {
    const vehicles = [{ plate: '30A-666', hoursIn: 2 }];
    const r = computePredictiveAlerts(vehicles, alerts, 12);
    assert.equal(r.approaching24h.length, 0);
    assert.equal(r.approaching48h.length, 0);
  });

  it('handles empty vehicle list', () => {
    const r = computePredictiveAlerts([], alerts, 12);
    assert.equal(r.approaching24h.length, 0);
    assert.equal(r.approaching48h.length, 0);
  });

  it('sorts by most urgent first', () => {
    const vehicles = [
      { plate: '30A-AAA', hoursIn: 18 }, // 6h until 24h
      { plate: '30A-BBB', hoursIn: 22 }, // 2h until 24h
    ];
    const r = computePredictiveAlerts(vehicles, alerts, 12);
    assert.equal(r.approaching24h[0].plate, '30A-BBB'); // more urgent first
  });
});

// ──────────────────────────────────────────────
// detectRepeatVisitors
// ──────────────────────────────────────────────

describe('detectRepeatVisitors', () => {
  it('detects plates with multiple visits', () => {
    const vehicles = [
      { plate: '30A-111', timeIn: '2026-03-20', timeOut: '2026-03-20' },
      { plate: '30A-111', timeIn: '2026-03-25', timeOut: null },
      { plate: '30A-222', timeIn: '2026-03-21', timeOut: '2026-03-21' },
    ];
    const r = detectRepeatVisitors(vehicles);
    assert.equal(r.length, 1);
    assert.equal(r[0].plate, '30A-111');
    assert.equal(r[0].visitCount, 2);
  });

  it('returns empty for unique plates', () => {
    const vehicles = [
      { plate: '30A-111' },
      { plate: '30A-222' },
    ];
    assert.equal(detectRepeatVisitors(vehicles).length, 0);
  });

  it('sorts by visit count descending', () => {
    const vehicles = [
      { plate: '30A-111' }, { plate: '30A-111' },
      { plate: '30A-222' }, { plate: '30A-222' }, { plate: '30A-222' },
    ];
    const r = detectRepeatVisitors(vehicles);
    assert.equal(r[0].plate, '30A-222');
    assert.equal(r[0].visitCount, 3);
  });
});

// ──────────────────────────────────────────────
// detectAnomalies
// ──────────────────────────────────────────────

describe('detectAnomalies', () => {
  it('detects vehicles exceeding p90', () => {
    const vehicles = [
      { plate: '30A-111', hoursIn: 12 },
      { plate: '30A-222', hoursIn: 5 },
      { plate: '30A-333', hoursIn: 20 },
    ];
    const r = detectAnomalies(vehicles, 8);
    assert.equal(r.length, 2);
    assert.equal(r[0].plate, '30A-333'); // sorted by actual desc
    assert.equal(r[1].plate, '30A-111');
  });

  it('returns empty when no anomalies', () => {
    const vehicles = [{ plate: '30A-111', hoursIn: 3 }];
    assert.equal(detectAnomalies(vehicles, 8).length, 0);
  });

  it('returns empty when p90 is 0', () => {
    const vehicles = [{ plate: '30A-111', hoursIn: 100 }];
    assert.equal(detectAnomalies(vehicles, 0).length, 0);
  });
});

// ──────────────────────────────────────────────
// computeCapacityForecast
// ──────────────────────────────────────────────

describe('computeCapacityForecast', () => {
  it('reports comfortable when utilization low', () => {
    const r = computeCapacityForecast(30, 50, 130);
    assert.equal(r.available, 100);
    assert.equal(r.utilizationPct, 23);
    assert.ok(r.recommendation.includes('✅'));
  });

  it('warns when utilization high', () => {
    const r = computeCapacityForecast(100, 50, 130);
    assert.equal(r.utilizationPct, 77);
    assert.ok(r.recommendation.includes('⚠️'));
  });

  it('alerts when near full', () => {
    const r = computeCapacityForecast(120, 50, 130);
    assert.equal(r.utilizationPct, 92);
    assert.ok(r.recommendation.includes('🚨'));
  });

  it('handles zero capacity', () => {
    const r = computeCapacityForecast(0, 0, 0);
    assert.equal(r.utilizationPct, 0);
  });
});

// ──────────────────────────────────────────────
// compareToBaseline
// ──────────────────────────────────────────────

describe('compareToBaseline', () => {
  it('shows stable when within 10%', () => {
    const r = compareToBaseline(55, 50);
    assert.equal(r.arrow, '→');
    assert.equal(r.pctChange, 10);
  });

  it('shows increase', () => {
    const r = compareToBaseline(80, 50);
    assert.equal(r.arrow, '↑');
    assert.equal(r.pctChange, 60);
  });

  it('shows decrease', () => {
    const r = compareToBaseline(30, 50);
    assert.equal(r.arrow, '↓');
    assert.equal(r.pctChange, -40);
  });

  it('handles zero baseline', () => {
    const r = compareToBaseline(10, 0);
    assert.equal(r.arrow, '→');
    assert.equal(r.label, 'N/A');
  });
});

// ──────────────────────────────────────────────
// bucketCompletedVehicles
// ──────────────────────────────────────────────

describe('bucketCompletedVehicles', () => {
  it('distributes vehicles into correct buckets', () => {
    const vehicles = [
      { durationMinutes: 60 },   // 1h → fast
      { durationMinutes: 120 },  // 2h → fast
      { durationMinutes: 200 },  // 3.3h → normal
      { durationMinutes: 360 },  // 6h → slow
      { durationMinutes: 600 },  // 10h → critical
    ];
    const r = bucketCompletedVehicles(vehicles, THRESHOLDS);
    assert.equal(r.fast.length, 2);
    assert.equal(r.normal.length, 1);
    assert.equal(r.slow.length, 1);
    assert.equal(r.critical.length, 1);
  });

  it('handles empty list', () => {
    const r = bucketCompletedVehicles([], THRESHOLDS);
    assert.equal(r.fast.length, 0);
    assert.equal(r.critical.length, 0);
  });
});

// ──────────────────────────────────────────────
// buildProgressBar
// ──────────────────────────────────────────────

describe('buildProgressBar', () => {
  it('builds correct bar for 50%', () => {
    const r = buildProgressBar(5, 10, 10);
    assert.equal(r, '█████░░░░░ 50%');
  });

  it('builds full bar for 100%', () => {
    const r = buildProgressBar(10, 10, 10);
    assert.equal(r, '██████████ 100%');
  });

  it('builds empty bar for 0%', () => {
    const r = buildProgressBar(0, 10, 10);
    assert.equal(r, '░░░░░░░░░░ 0%');
  });

  it('handles total=0', () => {
    const r = buildProgressBar(0, 0, 10);
    assert.equal(r, '░░░░░░░░░░ 0%');
  });
});

// ──────────────────────────────────────────────
// generateChecklist
// ──────────────────────────────────────────────

describe('generateChecklist', () => {
  it('includes capacity and workshop count', () => {
    const items = generateChecklist({
      inWorkshopCount: 45,
      capacityForecast: { available: 85, recommendation: '✅ THOẢI MÁI' },
      urgentCount: 0,
      warningCount: 0,
      predictive24hCount: 0,
      pendingReviewCount: 0,
      slowTodayCount: 0,
    });
    assert.ok(items.length >= 2);
    assert.ok(items[0].text.includes('45'));
  });

  it('includes urgent items when present', () => {
    const items = generateChecklist({
      inWorkshopCount: 45,
      capacityForecast: { available: 85, recommendation: '✅ THOẢI MÁI' },
      urgentCount: 3,
      warningCount: 2,
      predictive24hCount: 4,
      pendingReviewCount: 5,
      slowTodayCount: 2,
    });
    assert.ok(items.length >= 5);
    assert.ok(items.some(i => i.text.includes('5 xe cần action')));
    assert.ok(items.some(i => i.text.includes('4 xe sắp chạm 24h')));
    assert.ok(items.some(i => i.text.includes('Review OCR')));
  });
});

// ──────────────────────────────────────────────
// computeMorningPriorities
// ──────────────────────────────────────────────

describe('computeMorningPriorities', () => {
  it('includes urgent vehicles as top priority', () => {
    const r = computeMorningPriorities({
      urgentVehicles: [{ plate: '30A-111' }, { plate: '30A-222' }],
      approaching48h: [],
      capacityForecast: { utilizationPct: 40, recommendation: '✅ THOẢI MÁI' },
    });
    assert.ok(r.length >= 2);
    assert.equal(r[0].rank, 1);
    assert.ok(r[0].text.includes('2 xe Khẩn'));
  });

  it('includes approaching 48h as priority', () => {
    const r = computeMorningPriorities({
      urgentVehicles: [],
      approaching48h: [{ plate: '51F-333', hoursUntil: 4 }],
      capacityForecast: { utilizationPct: 40, recommendation: '✅ THOẢI MÁI' },
    });
    assert.ok(r.some(p => p.text.includes('51F-333')));
  });

  it('always includes capacity recommendation', () => {
    const r = computeMorningPriorities({
      urgentVehicles: [],
      approaching48h: [],
      capacityForecast: { utilizationPct: 80, recommendation: '⚠️ Khá đông — theo dõi capacity' },
    });
    assert.ok(r.some(p => p.text.includes('hạn chế nhận xe')));
  });

  it('says normal intake when utilization low', () => {
    const r = computeMorningPriorities({
      urgentVehicles: [],
      approaching48h: [],
      capacityForecast: { utilizationPct: 30, recommendation: '✅ THOẢI MÁI' },
    });
    assert.ok(r.some(p => p.text.includes('nhận xe bình thường')));
  });

  it('ranks correctly: urgent > approaching48h > capacity', () => {
    const r = computeMorningPriorities({
      urgentVehicles: [{ plate: '30A-URG' }],
      approaching48h: [{ plate: '51F-APP' }],
      capacityForecast: { utilizationPct: 40, recommendation: '✅ THOẢI MÁI' },
    });
    assert.equal(r.length, 3);
    assert.equal(r[0].rank, 1);
    assert.ok(r[0].text.includes('Khẩn'));
    assert.equal(r[1].rank, 2);
    assert.ok(r[1].text.includes('51F-APP'));
    assert.equal(r[2].rank, 3);
  });
});

// ──────────────────────────────────────────────
// percentile
// ──────────────────────────────────────────────

describe('percentile', () => {
  it('returns correct p50', () => {
    assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
  });

  it('returns correct p90', () => {
    assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
  });

  it('handles empty array', () => {
    assert.equal(percentile([], 50), 0);
  });

  it('handles single element', () => {
    assert.equal(percentile([42], 50), 42);
  });
});
