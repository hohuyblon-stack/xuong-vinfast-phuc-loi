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
  generateProgressId,
  formatDuration,
  TEXT_ONLY_ACTIONS,
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
// Test: parseMessage - VAO/RA (original)
// ──────────────────────────────────────────────

describe('parseMessage', () => {
  it('nhận diện VAO', () => {
    const r = parseMessage('VAO');
    assert.equal(r.action, 'VAO');
    assert.equal(r.vehicleType, '');
    assert.equal(r.params, '');
  });

  it('nhận diện vao (lowercase)', () => {
    assert.equal(parseMessage('vao').action, 'VAO');
  });

  it('nhận diện RA', () => {
    const r = parseMessage('RA');
    assert.equal(r.action, 'RA');
    assert.equal(r.vehicleType, '');
  });

  it('nhận diện ra (lowercase)', () => {
    assert.equal(parseMessage('ra').action, 'RA');
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
// Test: parseMessage - New commands
// ──────────────────────────────────────────────

describe('parseMessage - TRACUU', () => {
  it('nhận diện TRACUU với biển số', () => {
    const r = parseMessage('TRACUU 30A-12345');
    assert.equal(r.action, 'TRACUU');
    assert.equal(r.params, '30A-12345');
  });

  it('nhận diện tracuu (lowercase)', () => {
    const r = parseMessage('tracuu 30A-12345');
    assert.equal(r.action, 'TRACUU');
    assert.equal(r.params, '30A-12345');
  });

  it('nhận diện TRACUU không có biển số', () => {
    const r = parseMessage('TRACUU');
    assert.equal(r.action, 'TRACUU');
    assert.equal(r.params, '');
  });
});

describe('parseMessage - CAPNHAT', () => {
  it('nhận diện CAPNHAT với biển số và nội dung', () => {
    const r = parseMessage('CAPNHAT 30A-12345 | Đang kiểm tra');
    assert.equal(r.action, 'CAPNHAT');
    assert.ok(r.params.includes('30A-12345'));
    // "Đ" (U+0110) không bị strip bởi NFD, nên vẫn giữ nguyên
    assert.ok(r.params.includes('KIEM TRA'));
  });

  it('nhận diện CAPNHAT không có nội dung', () => {
    const r = parseMessage('CAPNHAT 30A-12345');
    assert.equal(r.action, 'CAPNHAT');
    assert.equal(r.params, '30A-12345');
  });
});

describe('parseMessage - DANGKY', () => {
  it('nhận diện DANGKY với biển số và SĐT', () => {
    const r = parseMessage('DANGKY 30A-12345 | 0901234567');
    assert.equal(r.action, 'DANGKY');
    assert.ok(r.params.includes('30A-12345'));
    assert.ok(r.params.includes('0901234567'));
  });
});

describe('parseMessage - BAOCAO', () => {
  it('nhận diện BAOCAO', () => {
    const r = parseMessage('BAOCAO');
    assert.equal(r.action, 'BAOCAO');
  });

  it('nhận diện baocao (lowercase)', () => {
    const r = parseMessage('baocao');
    assert.equal(r.action, 'BAOCAO');
  });
});

describe('parseMessage - HUONGDAN', () => {
  it('nhận diện HUONGDAN', () => {
    assert.equal(parseMessage('HUONGDAN').action, 'HUONGDAN');
  });

  it('nhận diện HELP', () => {
    assert.equal(parseMessage('HELP').action, 'HUONGDAN');
  });

  it('nhận diện help (lowercase)', () => {
    assert.equal(parseMessage('help').action, 'HUONGDAN');
  });
});

// ──────────────────────────────────────────────
// Test: TEXT_ONLY_ACTIONS
// ──────────────────────────────────────────────

describe('TEXT_ONLY_ACTIONS', () => {
  it('chứa đúng các command text-only', () => {
    assert.ok(TEXT_ONLY_ACTIONS.includes('TRACUU'));
    assert.ok(TEXT_ONLY_ACTIONS.includes('CAPNHAT'));
    assert.ok(TEXT_ONLY_ACTIONS.includes('DANGKY'));
    assert.ok(TEXT_ONLY_ACTIONS.includes('BAOCAO'));
    assert.ok(TEXT_ONLY_ACTIONS.includes('HUONGDAN'));
    assert.ok(!TEXT_ONLY_ACTIONS.includes('VAO'));
    assert.ok(!TEXT_ONLY_ACTIONS.includes('RA'));
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
// Test: formatDuration
// ──────────────────────────────────────────────

describe('formatDuration', () => {
  it('format phút thường', () => {
    assert.equal(formatDuration(30), '30 phút');
    assert.equal(formatDuration(0), '0 phút');
  });

  it('format giờ + phút', () => {
    assert.equal(formatDuration(150), '2 giờ 30 phút');
    assert.equal(formatDuration(60), '1 giờ 0 phút');
  });

  it('format string number', () => {
    assert.equal(formatDuration('90'), '1 giờ 30 phút');
  });

  it('trả empty string cho invalid', () => {
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
    assert.match(generateProgressId(tz), /^CN-\d{12}-[A-F0-9]{4}$/);
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
