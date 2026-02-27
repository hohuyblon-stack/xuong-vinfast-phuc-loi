'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePlate,
  isValidVietnamPlate,
  calcMinutesBetween,
  confidenceLabel,
  generateVehicleId,
  generateEventId,
  generateErrorId,
  formatDuration,
} = require('../src/utils');

// ──────────────────────────────────────────────
// Test: normalizePlate
// ──────────────────────────────────────────────

describe('normalizePlate', () => {
  it('chuan hoa bien so co ban', () => {
    assert.equal(normalizePlate('30A 12345'), '30A-12345');
    assert.equal(normalizePlate('30a-12345'), '30A-12345');
    assert.equal(normalizePlate(' 51F1 99999 '), '51F1-99999');
  });

  it('xu ly ky tu dac biet', () => {
    assert.equal(normalizePlate('30A.123.45'), '30A-12345');
    assert.equal(normalizePlate('30A-123-45'), '30A-12345');
  });

  it('tra ve empty string cho input rong', () => {
    assert.equal(normalizePlate(''), '');
    assert.equal(normalizePlate(null), '');
    assert.equal(normalizePlate(undefined), '');
  });
});

// ──────────────────────────────────────────────
// Test: isValidVietnamPlate
// ──────────────────────────────────────────────

describe('isValidVietnamPlate', () => {
  it('chap nhan bien xe con', () => {
    assert.equal(isValidVietnamPlate('30A-12345'), true);
    assert.equal(isValidVietnamPlate('51F1-99999'), true);
    assert.equal(isValidVietnamPlate('98A1-12345'), true);
  });

  it('chap nhan bien khong co gach ngang', () => {
    assert.equal(isValidVietnamPlate('30A12345'), true);
  });

  it('tu choi bien sai format', () => {
    assert.equal(isValidVietnamPlate('ABC123'), false);
    assert.equal(isValidVietnamPlate('1A-123'), false);
    assert.equal(isValidVietnamPlate(''), false);
    assert.equal(isValidVietnamPlate(null), false);
  });
});

// ──────────────────────────────────────────────
// Test: calcMinutesBetween
// ──────────────────────────────────────────────

describe('calcMinutesBetween', () => {
  it('tinh dung so phut', () => {
    assert.equal(calcMinutesBetween('12/02/2026 08:00:00', '12/02/2026 10:30:00'), 150);
  });

  it('tra empty string cho input invalid', () => {
    assert.equal(calcMinutesBetween('invalid', '12/02/2026 10:30:00'), '');
  });
});

// ──────────────────────────────────────────────
// Test: formatDuration
// ──────────────────────────────────────────────

describe('formatDuration', () => {
  it('format phut thuong', () => {
    assert.equal(formatDuration(30), '30 phut');
    assert.equal(formatDuration(0), '0 phut');
  });

  it('format gio + phut', () => {
    assert.equal(formatDuration(150), '2 gio 30 phut');
    assert.equal(formatDuration(60), '1 gio 0 phut');
  });

  it('format string number', () => {
    assert.equal(formatDuration('90'), '1 gio 30 phut');
  });

  it('tra empty string cho invalid', () => {
    assert.equal(formatDuration(''), '');
    assert.equal(formatDuration(null), '');
    assert.equal(formatDuration(undefined), '');
  });
});

// ──────────────────────────────────────────────
// Test: confidenceLabel
// ──────────────────────────────────────────────

describe('confidenceLabel', () => {
  const thresholds = { confidenceHigh: 0.8, confidenceMedium: 0.5 };

  it('Ro khi confidence >= 0.8', () => {
    assert.equal(confidenceLabel(0.9, thresholds), 'Ro');
    assert.equal(confidenceLabel(0.8, thresholds), 'Ro');
  });

  it('Tam duoc khi 0.5 <= confidence < 0.8', () => {
    assert.equal(confidenceLabel(0.6, thresholds), 'Tam duoc');
    assert.equal(confidenceLabel(0.5, thresholds), 'Tam duoc');
  });

  it('Mo khi confidence < 0.5', () => {
    assert.equal(confidenceLabel(0.3, thresholds), 'Mo / khong chac');
    assert.equal(confidenceLabel(0, thresholds), 'Mo / khong chac');
  });
});

// ──────────────────────────────────────────────
// Test: ID generation
// ──────────────────────────────────────────────

describe('ID generation', () => {
  it('tao ID dung format', () => {
    const tz = 'Asia/Ho_Chi_Minh';
    assert.match(generateVehicleId(tz), /^LX-\d{12}-[A-F0-9]{4}$/);
    assert.match(generateEventId(tz), /^SK-\d{12}-[A-F0-9]{4}$/);
    assert.match(generateErrorId(tz), /^ERR-\d{12}-[A-F0-9]{4}$/);
  });

  it('tao ID unique', () => {
    const tz = 'Asia/Ho_Chi_Minh';
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateVehicleId(tz));
    }
    assert.equal(ids.size, 100);
  });
});
