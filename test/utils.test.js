'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePlate,
  isValidVietnamPlate,
  parseMessage,
  calcMinutesBetween,
  confidenceLabel,
  generateVehicleId,
  generateEventId,
  generateErrorId,
} = require('../src/utils');

// ──────────────────────────────────────────────
// Test: normalizePlate
// ──────────────────────────────────────────────

describe('normalizePlate', () => {
  it('chuẩn hóa biển số cơ bản', () => {
    assert.equal(normalizePlate('30A 12345'), '30A-12345');
    assert.equal(normalizePlate('30a-12345'), '30A-12345');
    assert.equal(normalizePlate(' 51F1 99999 '), '51F1-99999');
  });

  it('xử lý ký tự đặc biệt', () => {
    assert.equal(normalizePlate('30A.123.45'), '30A-12345');
    assert.equal(normalizePlate('30A-123-45'), '30A-12345');
  });

  it('trả về empty string cho input rỗng', () => {
    assert.equal(normalizePlate(''), '');
    assert.equal(normalizePlate(null), '');
    assert.equal(normalizePlate(undefined), '');
  });
});

// ──────────────────────────────────────────────
// Test: isValidVietnamPlate
// ──────────────────────────────────────────────

describe('isValidVietnamPlate', () => {
  it('chấp nhận biển xe con', () => {
    assert.equal(isValidVietnamPlate('30A-12345'), true);
    assert.equal(isValidVietnamPlate('51F1-99999'), true);
    assert.equal(isValidVietnamPlate('98A1-12345'), true);
  });

  it('chấp nhận biển không có gạch ngang', () => {
    assert.equal(isValidVietnamPlate('30A12345'), true);
  });

  it('từ chối biển sai format', () => {
    assert.equal(isValidVietnamPlate('ABC123'), false);
    assert.equal(isValidVietnamPlate('1A-123'), false);
    assert.equal(isValidVietnamPlate(''), false);
    assert.equal(isValidVietnamPlate(null), false);
  });
});

// ──────────────────────────────────────────────
// Test: parseMessage
// ──────────────────────────────────────────────

describe('parseMessage', () => {
  it('nhận diện VAO', () => {
    assert.deepEqual(parseMessage('VAO'), { action: 'VAO', vehicleType: '' });
    assert.deepEqual(parseMessage('vao'), { action: 'VAO', vehicleType: '' });
  });

  it('nhận diện RA', () => {
    assert.deepEqual(parseMessage('RA'), { action: 'RA', vehicleType: '' });
    assert.deepEqual(parseMessage('ra'), { action: 'RA', vehicleType: '' });
  });

  it('nhận diện VAO với loại xe', () => {
    const result = parseMessage('VAO | xe tải');
    assert.equal(result.action, 'VAO');
    assert.equal(result.vehicleType, 'XE TAI');
  });

  it('trả null cho text không có từ khóa', () => {
    assert.equal(parseMessage('xin chào').action, null);
    assert.equal(parseMessage('').action, null);
    assert.equal(parseMessage(null).action, null);
  });
});

// ──────────────────────────────────────────────
// Test: calcMinutesBetween
// ──────────────────────────────────────────────

describe('calcMinutesBetween', () => {
  it('tính đúng số phút', () => {
    assert.equal(calcMinutesBetween('12/02/2026 08:00:00', '12/02/2026 10:30:00'), 150);
  });

  it('trả empty string cho input invalid', () => {
    assert.equal(calcMinutesBetween('invalid', '12/02/2026 10:30:00'), '');
  });
});

// ──────────────────────────────────────────────
// Test: confidenceLabel
// ──────────────────────────────────────────────

describe('confidenceLabel', () => {
  const thresholds = { confidenceHigh: 0.8, confidenceMedium: 0.5 };

  it('Rõ khi confidence >= 0.8', () => {
    assert.equal(confidenceLabel(0.9, thresholds), 'Rõ');
    assert.equal(confidenceLabel(0.8, thresholds), 'Rõ');
  });

  it('Tạm được khi 0.5 <= confidence < 0.8', () => {
    assert.equal(confidenceLabel(0.6, thresholds), 'Tạm được');
    assert.equal(confidenceLabel(0.5, thresholds), 'Tạm được');
  });

  it('Mờ khi confidence < 0.5', () => {
    assert.equal(confidenceLabel(0.3, thresholds), 'Mờ / không chắc');
    assert.equal(confidenceLabel(0, thresholds), 'Mờ / không chắc');
  });
});

// ──────────────────────────────────────────────
// Test: ID generation
// ──────────────────────────────────────────────

describe('ID generation', () => {
  it('tạo ID đúng format', () => {
    const tz = 'Asia/Ho_Chi_Minh';
    assert.match(generateVehicleId(tz), /^LX-\d{12}-[A-F0-9]{4}$/);
    assert.match(generateEventId(tz), /^SK-\d{12}-[A-F0-9]{4}$/);
    assert.match(generateErrorId(tz), /^ERR-\d{12}-[A-F0-9]{4}$/);
  });

  it('tạo ID unique', () => {
    const tz = 'Asia/Ho_Chi_Minh';
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateVehicleId(tz));
    }
    assert.equal(ids.size, 100);
  });
});
