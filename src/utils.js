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

/** Format so phut thanh chuoi "X gio Y phut" */
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
 * Parse text tin nhan - chi nhan dang TONKHO va HELP.
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
  formatDuration,
  normalizePlate,
  isValidVietnamPlate,
  parseMessage,
  confidenceLabel,
  TEXT_ONLY_ACTIONS,
};
