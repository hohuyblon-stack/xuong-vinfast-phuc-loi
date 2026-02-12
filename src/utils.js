'use strict';

const { DateTime } = require('luxon');
const crypto = require('crypto');

// ──────────────────────────────────────────────
// ID Generation
// ──────────────────────────────────────────────

/** Mã lượt xe: LX-YYMMDDHHmmss-XXXX */
function generateVehicleId(tz) {
  const ts = DateTime.now().setZone(tz).toFormat('yyMMddHHmmss');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `LX-${ts}-${rand}`;
}

/** Mã sự kiện: SK-YYMMDDHHmmss-XXXX */
function generateEventId(tz) {
  const ts = DateTime.now().setZone(tz).toFormat('yyMMddHHmmss');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `SK-${ts}-${rand}`;
}

/** Mã lỗi: ERR-YYMMDDHHmmss-XXXX */
function generateErrorId(tz) {
  const ts = DateTime.now().setZone(tz).toFormat('yyMMddHHmmss');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `ERR-${ts}-${rand}`;
}

// ──────────────────────────────────────────────
// Time Formatting
// ──────────────────────────────────────────────

/** Trả về chuỗi datetime đẹp: "12/02/2026 14:30:05" */
function nowFormatted(tz) {
  return DateTime.now().setZone(tz).toFormat('dd/MM/yyyy HH:mm:ss');
}

/** Tính số phút giữa 2 chuỗi datetime (cùng format dd/MM/yyyy HH:mm:ss) */
function calcMinutesBetween(startStr, endStr) {
  const fmt = 'dd/MM/yyyy HH:mm:ss';
  const start = DateTime.fromFormat(startStr, fmt);
  const end = DateTime.fromFormat(endStr, fmt);
  if (!start.isValid || !end.isValid) return '';
  return Math.round(end.diff(start, 'minutes').minutes);
}

/** Tính số giờ từ 1 chuỗi datetime đến bây giờ */
function hoursSince(startStr, tz) {
  const fmt = 'dd/MM/yyyy HH:mm:ss';
  const start = DateTime.fromFormat(startStr, fmt, { zone: tz });
  if (!start.isValid) return 0;
  return DateTime.now().setZone(tz).diff(start, 'hours').hours;
}

// ──────────────────────────────────────────────
// Plate Normalization
// ──────────────────────────────────────────────

/**
 * Chuẩn hóa biển số xe Việt Nam.
 * - Uppercase, bỏ khoảng trắng thừa
 * - Thay dấu chấm/gạch ngang thành dấu gạch ngang chuẩn
 * - VD: "30a 123.45" -> "30A-12345", "51F-999.99" -> "51F-99999"
 */
function normalizePlate(raw) {
  if (!raw) return '';
  let plate = raw.toUpperCase().trim();
  // Bỏ ký tự đặc biệt không phải chữ/số
  plate = plate.replace(/[^A-Z0-9]/g, '');
  // Thử các pattern biển số Việt Nam
  // Ưu tiên pattern 1 chữ cái trước (phổ biến hơn: 30A-12345)
  // Chỉ dùng pattern 2 ký tự prefix khi có gạch ngang rõ ràng hoặc pattern 1 không khớp
  // Pattern 1: 2-3 số + 1 chữ + 3-5 số (biển thường: 30A-12345, 30A-1234)
  const match1 = plate.match(/^(\d{2,3})([A-Z])(\d{3,5})$/);
  // Pattern 2: 2-3 số + 1 chữ + 1 ký tự + 4-5 số (biển đặc biệt: 51F1-99999)
  const match2 = plate.match(/^(\d{2,3})([A-Z][A-Z0-9])(\d{4,5})$/);
  const match = match1 || match2;
  if (match) {
    plate = `${match[1]}${match[2]}-${match[3]}`;
  }
  return plate;
}

/**
 * Regex validation biển số Việt Nam (tolerant).
 * Chấp nhận: 30A-12345, 51F1-99999, 98A1-12345, v.v.
 */
function isValidVietnamPlate(plate) {
  if (!plate) return false;
  // Tolerant: 2-3 chữ số, 1-2 ký tự chữ/số, dấu gạch (optional), 3-5 chữ số
  return /^\d{2,3}[A-Z][A-Z0-9]?-?\d{3,5}$/.test(plate);
}

// ──────────────────────────────────────────────
// Message Parsing
// ──────────────────────────────────────────────

/**
 * Parse text tin nhắn để xác định loại ghi nhận + loại xe.
 * Trả về { action: 'VAO'|'RA'|null, vehicleType: string|'' }
 *
 * Chấp nhận: "VAO", "vao", "VÀO", "RA"
 * Option mở rộng: "VAO | xe tải", "RA | xe con"
 */
function parseMessage(text) {
  if (!text) return { action: null, vehicleType: '' };

  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // bỏ dấu tiếng Việt
    .toUpperCase()
    .trim();

  let action = null;
  let vehicleType = '';

  // Tách phần action và phần mô tả bằng dấu |
  const parts = normalized.split('|').map(p => p.trim());

  const keyword = parts[0];
  if (/^(VAO|VA O|V AO)$/.test(keyword) || keyword === 'VÀO' || keyword === 'VAO') {
    action = 'VAO';
  } else if (/^RA$/.test(keyword)) {
    action = 'RA';
  }

  if (parts[1]) {
    vehicleType = parts[1].trim();
  }

  return { action, vehicleType };
}

// ──────────────────────────────────────────────
// Confidence mapping
// ──────────────────────────────────────────────

function confidenceLabel(confidence, thresholds) {
  if (confidence >= thresholds.confidenceHigh) return 'Rõ';
  if (confidence >= thresholds.confidenceMedium) return 'Tạm được';
  return 'Mờ / không chắc';
}

module.exports = {
  generateVehicleId,
  generateEventId,
  generateErrorId,
  nowFormatted,
  calcMinutesBetween,
  hoursSince,
  normalizePlate,
  isValidVietnamPlate,
  parseMessage,
  confidenceLabel,
};
