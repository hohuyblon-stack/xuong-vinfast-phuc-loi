'use strict';

const { DateTime } = require('luxon');
const sheets = require('./sheets');
const { normalizePlate } = require('./excel');
const utils = require('./utils');
const logger = require('./logger');

const MAX_MSG_LEN = 4000; // Telegram gioi han 4096, de du chenh lech

function formatMoney(amount) {
  if (!amount || isNaN(amount)) return '0d';
  return Number(amount).toLocaleString('vi-VN') + 'd';
}

function hoursLabel(timeIn, tz) {
  if (!timeIn) return '';
  const hours = utils.hoursSince(timeIn, tz);
  const h = Math.floor(hours);
  const m = Math.round((hours % 1) * 60);
  return `${h}h${m}p`;
}

/**
 * Cross-reference Excel work orders voi tracking data trong Google Sheets.
 * Tao bao cao tong hop theo 6 nhom.
 *
 * @param {Array}  excelOrders - Ket qua tu excel.parseExcelBuffer / downloadAndParseExcel
 * @param {object} config      - App config
 * @returns {Promise<string[]>} - Mang cac tin nhan (co the > 1 do gioi han Telegram)
 */
async function generateAccountingReport(excelOrders, config) {
  const tz = config.timezone;

  // Lay tat ca dong trong DANH SACH CHINH
  const allTracking = await sheets.getAllMainRows();

  // Index tracking theo bien so chuan hoa: plate → [entries]
  const trackingByPlate = new Map();
  for (const t of allTracking) {
    const key = normalizePlate(t.plate);
    if (!trackingByPlate.has(key)) trackingByPlate.set(key, []);
    trackingByPlate.get(key).push(t);
  }

  // Index excel theo bien so: plate → [orders]
  const orderByPlate = new Map();
  for (const order of excelOrders) {
    if (!orderByPlate.has(order.plate)) orderByPlate.set(order.plate, []);
    orderByPlate.get(order.plate).push(order);
  }

  const cats = {
    doneAndPaid:       [], // Da ra + Da thanh toan / quyet toan
    doneNotPaid:       [], // Da ra + Chua thanh toan
    inWorkshopPaid:    [], // Con trong xuong + Da quyet toan (bat thuong)
    inWorkshopWorking: [], // Con trong xuong + Dang sua (binh thuong)
    noTracking:        [], // Co lenh sua nhung khong thay xe vao
    noWorkOrder:       [], // Xe trong xuong nhung khong co lenh sua
  };

  // Phan loai tung lenh sua chua
  for (const [plate, orders] of orderByPlate) {
    const entries = trackingByPlate.get(plate) || [];
    const entryOut = entries.find(t => t.status === 'Da ra xuong');
    const entryIn  = entries.find(t => t.status === 'Dang trong xuong');

    for (const order of orders) {
      const isPaid = order.paymentStatus === 'DA_THANH_TOAN' || order.paymentStatus === 'DA_QUYET_TOAN';

      if (entryOut) {
        if (isPaid) cats.doneAndPaid.push({ order, tracking: entryOut });
        else        cats.doneNotPaid.push({ order, tracking: entryOut });
      } else if (entryIn) {
        if (isPaid) cats.inWorkshopPaid.push({ order, tracking: entryIn });
        else        cats.inWorkshopWorking.push({ order, tracking: entryIn });
      } else {
        cats.noTracking.push({ order, tracking: null });
      }
    }
  }

  // Xe trong xuong nhung khong co lenh sua trong Excel
  for (const t of allTracking) {
    if (t.status !== 'Dang trong xuong') continue;
    if (!orderByPlate.has(normalizePlate(t.plate))) {
      cats.noWorkOrder.push({ order: null, tracking: t });
    }
  }

  logger.info('Accounting report generated', {
    total: excelOrders.length,
    doneAndPaid: cats.doneAndPaid.length,
    doneNotPaid: cats.doneNotPaid.length,
    inWorkshopPaid: cats.inWorkshopPaid.length,
    inWorkshopWorking: cats.inWorkshopWorking.length,
    noTracking: cats.noTracking.length,
    noWorkOrder: cats.noWorkOrder.length,
  });

  return buildMessages(cats, excelOrders.length, tz);
}

function buildMessages(cats, totalOrders, tz) {
  const today = DateTime.now().setZone(tz).toFormat('dd/MM/yyyy');
  const parts = [];

  // ── Header / Tong quan ──
  parts.push(
    `BAO CAO QUYET TOAN - ${today}\n` +
    `Tong lenh sua: ${totalOrders}\n` +
    `[OK] Xong + Thanh toan: ${cats.doneAndPaid.length}\n` +
    `[!!] Xong + Chua TT: ${cats.doneNotPaid.length}\n` +
    `[CB] Xuong + Da quyet toan: ${cats.inWorkshopPaid.length}\n` +
    `[SC] Xuong + Dang sua: ${cats.inWorkshopWorking.length}\n` +
    `[?]  Lenh sua + Khong thay xe: ${cats.noTracking.length}\n` +
    `[XE] Xe trong xuong + Khong co lenh: ${cats.noWorkOrder.length}`
  );

  // ── Da ra + Da thanh toan ──
  if (cats.doneAndPaid.length > 0) {
    let block = `[OK] DA RA + DA THANH TOAN (${cats.doneAndPaid.length}):\n`;
    for (const { order, tracking } of cats.doneAndPaid) {
      block +=
        `\n${order.plateRaw} - ${order.model}\n` +
        `  KH: ${order.customer}\n` +
        `  Vao: ${tracking.timeIn} | Ra: ${tracking.timeOut}\n` +
        `  Lenh: ${order.workOrder}\n` +
        `  Tong: ${formatMoney(order.total)} | ${order.status}\n`;
    }
    parts.push(block);
  }

  // ── Da ra + Chua thanh toan ──
  if (cats.doneNotPaid.length > 0) {
    let block = `[!!] DA RA + CHUA THANH TOAN (${cats.doneNotPaid.length}):\n`;
    for (const { order, tracking } of cats.doneNotPaid) {
      block +=
        `\n${order.plateRaw} - ${order.model}\n` +
        `  KH: ${order.customer}\n` +
        `  Vao: ${tracking.timeIn} | Ra: ${tracking.timeOut}\n` +
        `  Lenh: ${order.workOrder}\n` +
        `  Tong: ${formatMoney(order.total)} | ${order.status || 'Chua ro'}\n`;
    }
    parts.push(block);
  }

  // ── Con trong xuong + Da quyet toan (bat thuong) ──
  if (cats.inWorkshopPaid.length > 0) {
    let block = `[CB] CON XUONG + DA QUYET TOAN - can kiem tra (${cats.inWorkshopPaid.length}):\n`;
    for (const { order, tracking } of cats.inWorkshopPaid) {
      block +=
        `\n${order.plateRaw} - ${order.model}\n` +
        `  KH: ${order.customer}\n` +
        `  Vao: ${tracking.timeIn} | Chua ra (${hoursLabel(tracking.timeIn, tz)})\n` +
        `  Lenh: ${order.workOrder}\n` +
        `  Tong: ${formatMoney(order.total)} | ${order.status}\n`;
    }
    parts.push(block);
  }

  // ── Con trong xuong + Dang sua (binh thuong) ──
  if (cats.inWorkshopWorking.length > 0) {
    let block = `[SC] CON XUONG + DANG SUA (${cats.inWorkshopWorking.length}):\n`;
    for (const { order, tracking } of cats.inWorkshopWorking) {
      block +=
        `\n${order.plateRaw} - ${order.model}\n` +
        `  KH: ${order.customer}\n` +
        `  Vao: ${tracking.timeIn} (${hoursLabel(tracking.timeIn, tz)})\n` +
        `  YC: ${order.request || order.serviceType}\n` +
        `  Lenh: ${order.workOrder}\n` +
        `  Tong: ${formatMoney(order.total)} | ${order.status || 'Chua quyet toan'}\n`;
    }
    parts.push(block);
  }

  // ── Co lenh sua nhung khong thay xe vao ──
  if (cats.noTracking.length > 0) {
    let block = `[?] CO LENH SUA + KHONG THAY XE VAO (${cats.noTracking.length}):\n`;
    for (const { order } of cats.noTracking) {
      block +=
        `\n${order.plateRaw} - ${order.model}\n` +
        `  KH: ${order.customer}\n` +
        `  Lenh: ${order.workOrder}\n` +
        `  Tong: ${formatMoney(order.total)}\n`;
    }
    parts.push(block);
  }

  // ── Xe trong xuong nhung khong co lenh sua ──
  if (cats.noWorkOrder.length > 0) {
    let block = `[XE] XE TRONG XUONG + KHONG CO LENH SUA (${cats.noWorkOrder.length}):\n`;
    for (const { tracking } of cats.noWorkOrder) {
      block += `\n${tracking.plate} - Vao: ${tracking.timeIn} (${hoursLabel(tracking.timeIn, tz)})\n`;
    }
    parts.push(block);
  }

  // Gop cac phan lai, tach thanh nhieu tin nhan neu vuot 4000 ky tu
  return splitIntoMessages(parts);
}

function splitIntoMessages(parts) {
  const messages = [];
  let current = '';

  for (const part of parts) {
    if (current.length + part.length + 2 > MAX_MSG_LEN) {
      if (current) messages.push(current.trim());
      current = part;
    } else {
      current += (current ? '\n\n' : '') + part;
    }
  }

  if (current) messages.push(current.trim());
  return messages;
}

module.exports = { generateAccountingReport };
