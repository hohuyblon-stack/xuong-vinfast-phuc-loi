'use strict';

/**
 * Report Intelligence Module — smart analysis for workshop reports.
 *
 * Pure functions: no DB calls, no side effects.
 * Takes data in, returns computed insights.
 */

const { DateTime } = require('luxon');

// ──────────────────────────────────────────────
// Duration color system
// ──────────────────────────────────────────────

/**
 * Assign color emoji based on hours in workshop.
 * @param {number} hours
 * @param {{ fast: number, normal: number, slow: number }} thresholds
 * @returns {{ emoji: string, label: string }}
 */
function computeDurationColor(hours, thresholds) {
  if (hours < thresholds.fast)   return { emoji: '🟢', label: 'nhanh' };
  if (hours < thresholds.normal) return { emoji: '🟡', label: 'bình thường' };
  if (hours < thresholds.slow)   return { emoji: '🟠', label: 'chậm' };
  return { emoji: '🔴', label: 'rất chậm' };
}

// ──────────────────────────────────────────────
// Predictive alerts
// ──────────────────────────────────────────────

/**
 * Find vehicles approaching 24h/48h thresholds within bufferHours.
 * @param {Array} vehicles — in-workshop vehicles with { plate, timeIn, hoursIn }
 * @param {{ warningHours: number, urgentHours: number }} alertThresholds
 * @param {number} bufferHours — look-ahead window (default 12)
 * @returns {{ approaching24h: Array, approaching48h: Array }}
 */
function computePredictiveAlerts(vehicles, alertThresholds, bufferHours = 12) {
  const approaching24h = [];
  const approaching48h = [];

  for (const v of vehicles) {
    const hoursIn = v.hoursIn;
    const hoursUntil24 = alertThresholds.warningHours - hoursIn;
    const hoursUntil48 = alertThresholds.urgentHours - hoursIn;

    // Already past threshold → skip (handled by action-required section)
    if (hoursUntil24 > 0 && hoursUntil24 <= bufferHours) {
      approaching24h.push({ ...v, hoursUntil: hoursUntil24 });
    }
    if (hoursUntil48 > 0 && hoursUntil48 <= bufferHours) {
      approaching48h.push({ ...v, hoursUntil: hoursUntil48 });
    }
  }

  // Sort by most urgent first (least hours until threshold)
  approaching24h.sort((a, b) => a.hoursUntil - b.hoursUntil);
  approaching48h.sort((a, b) => a.hoursUntil - b.hoursUntil);

  return { approaching24h, approaching48h };
}

// ──────────────────────────────────────────────
// Repeat visitor detection
// ──────────────────────────────────────────────

/**
 * Detect plates that appeared multiple times in recent history.
 * @param {Array} recentVehicles — vehicles from last N days [{ plate, timeIn, timeOut }]
 * @returns {Array<{ plate: string, visitCount: number, visits: Array }>}
 */
function detectRepeatVisitors(recentVehicles) {
  const plateMap = new Map();
  for (const v of recentVehicles) {
    if (!plateMap.has(v.plate)) plateMap.set(v.plate, []);
    plateMap.get(v.plate).push(v);
  }

  const repeats = [];
  for (const [plate, visits] of plateMap) {
    if (visits.length >= 2) {
      repeats.push({ plate, visitCount: visits.length, visits });
    }
  }

  // Sort by visit count descending
  repeats.sort((a, b) => b.visitCount - a.visitCount);
  return repeats;
}

// ──────────────────────────────────────────────
// Anomaly detection
// ──────────────────────────────────────────────

/**
 * Find vehicles with duration exceeding p90 from historical data.
 * @param {Array} vehicles — in-workshop vehicles with { plate, hoursIn }
 * @param {number} p90Hours — 90th percentile duration from history
 * @returns {Array<{ vehicle: object, expectedMax: number, actual: number }>}
 */
function detectAnomalies(vehicles, p90Hours) {
  if (!p90Hours || p90Hours <= 0) return [];

  return vehicles
    .filter(v => v.hoursIn > p90Hours)
    .map(v => ({
      ...v,
      expectedMax: p90Hours,
      actual: v.hoursIn,
    }))
    .sort((a, b) => b.actual - a.actual);
}

// ──────────────────────────────────────────────
// Capacity forecast
// ──────────────────────────────────────────────

/**
 * @param {number} currentCount — vehicles currently in workshop
 * @param {number} avgDailyIn — average daily intake (7-day)
 * @param {number} maxCapacity — workshop max capacity
 * @returns {{ available: number, utilizationPct: number, recommendation: string }}
 */
function computeCapacityForecast(currentCount, avgDailyIn, maxCapacity) {
  const available = maxCapacity - currentCount;
  const utilizationPct = maxCapacity > 0 ? Math.round((currentCount / maxCapacity) * 100) : 0;

  let recommendation;
  if (utilizationPct >= 90) {
    recommendation = '🚨 GẦN ĐẦY — hạn chế nhận xe mới';
  } else if (utilizationPct >= 70) {
    recommendation = '⚠️ Khá đông — theo dõi capacity';
  } else {
    recommendation = '✅ THOẢI MÁI';
  }

  return { available, utilizationPct, recommendation };
}

// ──────────────────────────────────────────────
// Trend comparison
// ──────────────────────────────────────────────

/**
 * Compare today's value to a baseline (yesterday or weekly avg).
 * @param {number} todayValue
 * @param {number} baselineValue
 * @returns {{ arrow: string, diff: number, pctChange: number, label: string }}
 */
function compareToBaseline(todayValue, baselineValue) {
  if (!baselineValue || baselineValue === 0) {
    return { arrow: '→', diff: 0, pctChange: 0, label: 'N/A' };
  }
  const diff = todayValue - baselineValue;
  const pctChange = Math.round((diff / baselineValue) * 100);
  const absPct = Math.abs(pctChange);

  let arrow, label;
  if (absPct <= 10) {
    arrow = '→';
    label = `±${absPct}%`;
  } else if (diff > 0) {
    arrow = '↑';
    label = `+${diff}↑ (+${absPct}%)`;
  } else {
    arrow = '↓';
    label = `${diff}↓ (-${absPct}%)`;
  }

  return { arrow, diff, pctChange, label };
}

// ──────────────────────────────────────────────
// Duration bucket summary
// ──────────────────────────────────────────────

/**
 * Bucket completed vehicles by duration.
 * @param {Array} vehicles — completed vehicles with { durationMinutes }
 * @param {{ fast: number, normal: number, slow: number }} thresholds — in hours
 * @returns {{ fast: Array, normal: Array, slow: Array, critical: Array }}
 */
function bucketCompletedVehicles(vehicles, thresholds) {
  const buckets = { fast: [], normal: [], slow: [], critical: [] };

  for (const v of vehicles) {
    const hours = (v.durationMinutes || 0) / 60;
    if (hours < thresholds.fast)        buckets.fast.push(v);
    else if (hours < thresholds.normal) buckets.normal.push(v);
    else if (hours < thresholds.slow)   buckets.slow.push(v);
    else                                buckets.critical.push(v);
  }

  return buckets;
}

// ──────────────────────────────────────────────
// Visual progress bar
// ──────────────────────────────────────────────

/**
 * Build a text-based progress bar.
 * @param {number} count
 * @param {number} total
 * @param {number} [width=10]
 * @returns {string} e.g. "████░░░░░░ 42%"
 */
function buildProgressBar(count, total, width = 10) {
  if (total <= 0) return '░'.repeat(width) + ' 0%';
  const pct = Math.round((count / total) * 100);
  const filled = Math.round((count / total) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty) + ` ${pct}%`;
}

// ──────────────────────────────────────────────
// End-of-day checklist
// ──────────────────────────────────────────────

/**
 * Generate end-of-day action items.
 * @param {object} params
 * @returns {Array<{ text: string }>}
 */
function generateChecklist({
  inWorkshopCount,
  capacityForecast,
  urgentCount,
  warningCount,
  predictive24hCount,
  pendingReviewCount,
  slowTodayCount,
}) {
  const items = [];

  items.push({ text: `Tồn kho qua đêm: ${inWorkshopCount} xe` });
  items.push({ text: `Capacity ngày mai: còn ${capacityForecast.available} chỗ → ${capacityForecast.recommendation}` });

  if (urgentCount + warningCount > 0) {
    items.push({ text: `${urgentCount + warningCount} xe cần action >24h (xem section 2)` });
  }
  if (predictive24hCount > 0) {
    items.push({ text: `${predictive24hCount} xe sắp chạm 24h đêm nay (xem section 3)` });
  }
  if (pendingReviewCount > 0) {
    items.push({ text: `Review OCR: ${pendingReviewCount} mục confidence thấp` });
  }
  if (slowTodayCount > 0) {
    items.push({ text: `Sáng mai ưu tiên: ${slowTodayCount} xe 🟠 chậm tiến độ` });
  }

  return items;
}

// ──────────────────────────────────────────────
// Morning priorities
// ──────────────────────────────────────────────

/**
 * Compute ranked priority list for morning briefing.
 * @param {object} params
 * @returns {Array<{ rank: number, text: string }>}
 */
function computeMorningPriorities({
  urgentVehicles,
  approaching48h,
  capacityForecast,
}) {
  const priorities = [];
  let rank = 1;

  if (urgentVehicles.length > 0) {
    priorities.push({
      rank: rank++,
      text: `Xử lý ${urgentVehicles.length} xe Khẩn >48h trước 12h`,
    });
  }

  if (approaching48h.length > 0) {
    const mostUrgent = approaching48h[0];
    priorities.push({
      rank: rank++,
      text: `${mostUrgent.plate} sắp chạm 48h — kiểm tra ngay`,
    });
  }

  priorities.push({
    rank: rank++,
    text: `Capacity ${capacityForecast.recommendation.replace(/^[^\s]+\s/, '')}— ${capacityForecast.utilizationPct >= 70 ? 'hạn chế nhận xe' : 'nhận xe bình thường'}`,
  });

  return priorities;
}

// ──────────────────────────────────────────────
// Duration percentile calculator
// ──────────────────────────────────────────────

/**
 * Compute percentile from sorted array of numbers.
 * @param {number[]} sorted — sorted ascending
 * @param {number} p — percentile (0-100)
 * @returns {number}
 */
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

module.exports = {
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
};
