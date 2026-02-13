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

/** Mã cập nhật tiến độ: CN-YYMMDDHHmmss-XXXX */
function generateProgressId(tz) {
  const ts = DateTime.now().setZone(tz).toFormat('yyMMddHHmmss');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `CN-${ts}-${rand}`;
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

/** Format số phút thành chuỗi đẹp "X giờ Y phút" */
function formatDuration(minutes) {
  if (!minutes && minutes !== 0) return '';
  const m = parseInt(minutes, 10);
  if (isNaN(m)) return '';
  const hours = Math.floor(m / 60);
  const mins = m % 60;
  if (hours > 0) return `${hours} giờ ${mins} phút`;
  return `${mins} phút`;
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
 * Danh sách commands không cần ảnh (text-only).
 */
const TEXT_ONLY_ACTIONS = ['TRACUU', 'CAPNHAT', 'DANGKY', 'BAOCAO', 'HUONGDAN'];

/**
 * Parse text tin nhắn để xác định loại ghi nhận.
 * Trả về { action, vehicleType, params }
 *
 * Các lệnh:
 * - VAO [| loại xe]           → Ghi nhận xe vào (cần ảnh)
 * - RA [| loại xe]            → Ghi nhận xe ra (cần ảnh)
 * - TRACUU <biển số>          → Tra cứu trạng thái xe
 * - CAPNHAT <biển số> | <nội dung> → Cập nhật tiến độ sửa chữa
 * - DANGKY <biển số> | <SĐT>  → Đăng ký SĐT khách hàng
 * - BAOCAO                    → Xem báo cáo tổng hợp
 * - HUONGDAN / HELP           → Xem hướng dẫn sử dụng
 */
function parseMessage(text) {
  if (!text) return { action: null, vehicleType: '', params: '' };

  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // bỏ dấu tiếng Việt
    .toUpperCase()
    .trim();

  let action = null;
  let vehicleType = '';
  let params = '';

  // Tách phần action và phần mô tả bằng dấu |
  const parts = normalized.split('|').map(p => p.trim());
  const keyword = parts[0];

  // Detect multi-word commands (keyword + params)
  if (/^TRACUU\b/.test(keyword)) {
    action = 'TRACUU';
    params = keyword.replace(/^TRACUU\s*/, '').trim();
  } else if (/^CAPNHAT\b/.test(keyword)) {
    action = 'CAPNHAT';
    params = keyword.replace(/^CAPNHAT\s*/, '').trim();
    if (parts[1]) params += '|' + parts[1].trim();
  } else if (/^DANGKY\b/.test(keyword)) {
    action = 'DANGKY';
    params = keyword.replace(/^DANGKY\s*/, '').trim();
    if (parts[1]) params += '|' + parts[1].trim();
  } else if (/^BAOCAO$/.test(keyword)) {
    action = 'BAOCAO';
  } else if (/^(HUONGDAN|HELP)$/.test(keyword)) {
    action = 'HUONGDAN';
  } else if (/^(VAO|VA O|V AO)$/.test(keyword) || keyword === 'VAO') {
    action = 'VAO';
    if (parts[1]) vehicleType = parts[1].trim();
  } else if (/^RA$/.test(keyword)) {
    action = 'RA';
    if (parts[1]) vehicleType = parts[1].trim();
  }

  return { action, vehicleType, params };
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
  generateProgressId,
  nowFormatted,
  calcMinutesBetween,
  hoursSince,
  formatDuration,
  normalizePlate,
  isValidVietnamPlate,
  parseMessage,
  confidenceLabel,
  TEXT_ONLY_ACTIONS,
};
