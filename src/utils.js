'use strict';

const { DateTime } = require('luxon');
const crypto = require('crypto');

// ──────────────────────────────────────────────
// ID Generation
// ──────────────────────────────────────────────

/** Ma luot xe: LX-YYMMDDHHmmss-XXXX */
function generateVehicleId(tz) {
  const ts = DateTime.now().setZone(tz).toFormat('yyMMddHHmmss');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `LX-${ts}-${rand}`;
}

/** Ma su kien: SK-YYMMDDHHmmss-XXXX */
function generateEventId(tz) {
  const ts = DateTime.now().setZone(tz).toFormat('yyMMddHHmmss');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `SK-${ts}-${rand}`;
}

/** Ma loi: ERR-YYMMDDHHmmss-XXXX */
function generateErrorId(tz) {
  const ts = DateTime.now().setZone(tz).toFormat('yyMMddHHmmss');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `ERR-${ts}-${rand}`;
}

// ──────────────────────────────────────────────
// Time Formatting
// ──────────────────────────────────────────────

/** Tra ve chuoi datetime: "12/02/2026 14:30:05" */
function nowFormatted(tz) {
  return DateTime.now().setZone(tz).toFormat('dd/MM/yyyy HH:mm:ss');
}

/** Tinh so phut giua 2 chuoi datetime (cung format dd/MM/yyyy HH:mm:ss) */
function calcMinutesBetween(startStr, endStr) {
  const fmt = 'dd/MM/yyyy HH:mm:ss';
  const start = DateTime.fromFormat(startStr, fmt);
  const end = DateTime.fromFormat(endStr, fmt);
  if (!start.isValid || !end.isValid) return '';
  return Math.round(end.diff(start, 'minutes').minutes);
}

/** Tinh so gio tu 1 chuoi datetime den bay gio */
function hoursSince(startStr, tz) {
  const fmt = 'dd/MM/yyyy HH:mm:ss';
  const start = DateTime.fromFormat(startStr, fmt, { zone: tz });
  if (!start.isValid) return 0;
  return DateTime.now().setZone(tz).diff(start, 'hours').hours;
}

/** Format so gio (float) thanh "Xh Yp", xu ly 60p → +1h */
function formatHours(hours) {
  let h = Math.floor(hours);
  let m = Math.round((hours % 1) * 60);
  if (m >= 60) { h += 1; m = 0; }
  return `${h}h${m}p`;
}

/** Format so phut thanh chuoi "X gio Y phut" */
function formatDuration(minutes) {
  if (!minutes && minutes !== 0) return '';
  const m = parseInt(minutes, 10);
  if (isNaN(m)) return '';
  const hours = Math.floor(m / 60);
  const mins = m % 60;
  if (hours > 0) return `${hours} gio ${mins} phut`;
  return `${mins} phut`;
}

// ──────────────────────────────────────────────
// Plate Normalization
// ──────────────────────────────────────────────

/**
 * Chuan hoa bien so xe Viet Nam.
 * VD: "30a 123.45" -> "30A-12345"
 */
function normalizePlate(raw) {
  if (!raw) return '';
  let plate = raw.toUpperCase().trim();
  plate = plate.replace(/[^A-Z0-9]/g, '');
  const match1 = plate.match(/^(\d{2,3})([A-Z])(\d{3,5})$/);
  const match2 = plate.match(/^(\d{2,3})([A-Z][A-Z0-9])(\d{4,5})$/);
  const match = match1 || match2;
  if (match) {
    plate = `${match[1]}${match[2]}-${match[3]}`;
  }
  return plate;
}

/**
 * Regex validation bien so Viet Nam (tolerant).
 */
function isValidVietnamPlate(plate) {
  if (!plate) return false;
  return /^\d{2,3}[A-Z][A-Z0-9]?-?\d{3,5}$/.test(plate);
}

// ──────────────────────────────────────────────
// Message Parsing
// ──────────────────────────────────────────────

/**
 * Cac lenh text-only (khong can anh).
 */
const TEXT_ONLY_ACTIONS = ['TONKHO', 'HELP', 'BAOCAO', 'NANGSUAT'];

/**
 * Parse text tin nhan - chi nhan dang TONKHO, HELP, BAOCAO, NANGSUAT.
 * Vao/Ra duoc tu dong xac dinh qua anh bien so.
 */
function parseMessage(text) {
  if (!text) return { action: null, params: '' };

  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

  let action = null;

  if (/^(TONKHO|TON KHO)$/.test(normalized)) {
    action = 'TONKHO';
  } else if (/^(HELP|HUONGDAN|HUONG DAN)$/.test(normalized)) {
    action = 'HELP';
  } else if (/^(BAOCAO|BAO CAO)$/.test(normalized)) {
    action = 'BAOCAO';
  } else if (/^(NANGSUAT|NANG SUAT)$/.test(normalized)) {
    action = 'NANGSUAT';
  }

  return { action, params: '' };
}

// ──────────────────────────────────────────────
// Report formatting helpers
// ──────────────────────────────────────────────

/**
 * Format xe đã hoàn thành (có giờ ra).
 * "30A-12345 — 08:15 → 14:30 (6h15p)"
 */
function formatVehicleCompleted(v, tz) {
  const tIn  = extractTime(v.timeIn);
  const tOut = extractTime(v.timeOut);
  const dur  = v.durationMinutes != null ? ` (${formatHours(v.durationMinutes / 60)})` : '';
  return `${v.plate} — ${tIn} → ${tOut}${dur}`;
}

/**
 * Format xe đang trong xưởng.
 * "🚨 51F-45678 — Vào 16/03 08:15 (96h)"
 */
function formatVehicleInProgress(v, tz) {
  const hours = hoursSince(v.timeIn, tz);
  const icon  = v.priority === 'Khẩn' ? '🚨' : v.priority === 'Cảnh báo' ? '⚠️' : '🔧';
  const dateTime = extractDateTimeShort(v.timeIn, tz);
  return `${icon} ${v.plate} — Vào ${dateTime} (${formatHours(hours)})`;
}

/**
 * Trich xuat HH:mm tu chuoi "dd/MM/yyyy HH:mm:ss".
 */
function extractTime(dateStr) {
  if (!dateStr) return '';
  const match = dateStr.match(/\d{2}\/\d{2}\/\d{4} (\d{2}:\d{2})/);
  return match ? match[1] : dateStr;
}

/**
 * Trich xuat "dd/MM HH:mm" tu chuoi "dd/MM/yyyy HH:mm:ss".
 * Neu cung ngay hom nay thi chi hien HH:mm.
 */
function extractDateTimeShort(dateStr, tz) {
  if (!dateStr) return '';
  const match = dateStr.match(/(\d{2})\/(\d{2})\/\d{4} (\d{2}:\d{2})/);
  if (!match) return dateStr;
  const now = DateTime.now().setZone(tz || 'Asia/Ho_Chi_Minh');
  const day = match[1], month = match[2], time = match[3];
  if (parseInt(day) === now.day && parseInt(month) === now.month) return time;
  return `${day}/${month} ${time}`;
}

/**
 * Split report sections into multiple messages respecting Telegram 4000 char limit.
 * Never splits in the middle of a section.
 */
function splitIntoMessages(parts, maxLen = 4000) {
  const messages = [];
  let current = '';
  for (const part of parts) {
    if (current.length + part.length + 2 > maxLen) {
      if (current) messages.push(current.trim());
      current = part;
    } else {
      current += (current ? '\n\n' : '') + part;
    }
  }
  if (current) messages.push(current.trim());
  return messages;
}

// ──────────────────────────────────────────────
// Confidence mapping
// ──────────────────────────────────────────────

function confidenceLabel(confidence, thresholds) {
  if (confidence >= thresholds.confidenceHigh) return 'Ro';
  if (confidence >= thresholds.confidenceMedium) return 'Tam duoc';
  return 'Mo / khong chac';
}

module.exports = {
  generateVehicleId,
  generateEventId,
  generateErrorId,
  nowFormatted,
  calcMinutesBetween,
  hoursSince,
  formatHours,
  formatDuration,
  normalizePlate,
  isValidVietnamPlate,
  parseMessage,
  confidenceLabel,
  TEXT_ONLY_ACTIONS,
  formatVehicleCompleted,
  formatVehicleInProgress,
  splitIntoMessages,
  extractTime,
  extractDateTimeShort,
};
