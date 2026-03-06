'use strict';

/**
 * accounting.js - Bao cao ty le chuyen doi xe vao → len lenh sua chua
 *
 * Logic chinh:
 *   - "Xe vao hom nay" = tracking sheet (anh chup bien so)
 *   - "Len lenh" = co trong file Excel xuat tu Cyber/DMS
 *   - Xe vao nhung khong co trong Excel = chua duoc tiep nhan (hoac da ve khong sua)
 *
 * 5 nhom bao cao:
 *   [DA RA + XONG]     Da ra xuong + co lenh + da thanh toan/quyet toan
 *   [DA RA + CHUA TT]  Da ra xuong + co lenh + chua thanh toan
 *   [XUONG + DANG SUA] Con trong xuong + co lenh (dang thuc hien)
 *   [XUONG + DA QT]    Con trong xuong + da quyet toan (bat thuong, can kiem tra)
 *   [CHUA TIEP NHAN]   Co xe vao (chup anh) nhung chua co lenh nao trong Cyber
 */

const { DateTime } = require('luxon');
const sheets = require('./sheets');
const { normalizePlate } = require('./excel');
const utils = require('./utils');
const logger = require('./logger');

const MAX_MSG_LEN = 4000;

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

function pct(num, denom) {
  if (!denom) return '0%';
  return Math.round((num / denom) * 100) + '%';
}

/**
 * Cross-reference Excel work orders voi tracking data.
 * Chi tinh cho xe VAO NGAY HOM NAY de do ty le chuyen doi chinh xac.
 *
 * @param {Array}  excelOrders - Ket qua tu excel.parseExcelBuffer
 * @param {object} config      - App config
 * @returns {Promise<string[]>} - Mang tin nhan gui qua Telegram
 */
async function generateAccountingReport(excelOrders, config) {
  const tz = config.timezone;

  // Chi lay xe VAO hom nay (khong tinh lich su cu)
  const todayEntries = await sheets.getTodayEntries(tz);

  // Index tracking hom nay theo bien so: plate → entry
  // Neu 1 bien so vao nhieu lan, uu tien cai dang trong xuong, sau do cai ra gan nhat
  const todayByPlate = new Map();
  for (const t of todayEntries) {
    const key = normalizePlate(t.plate);
    const existing = todayByPlate.get(key);
    if (!existing || t.status === 'Dang trong xuong') {
      todayByPlate.set(key, t);
    }
  }

  // Index excel theo bien so: plate → order (1 bien so = 1 lenh/ngay)
  const orderByPlate = new Map();
  for (const order of excelOrders) {
    if (!orderByPlate.has(order.plate)) {
      orderByPlate.set(order.plate, order);
    }
  }

  const cats = {
    doneAndPaid:       [], // Da ra + da thanh toan/quyet toan
    doneNotPaid:       [], // Da ra + chua thanh toan
    inWorkshopWorking: [], // Con trong xuong + dang sua (binh thuong)
    inWorkshopPaid:    [], // Con trong xuong + da quyet toan (bat thuong)
    notReceived:       [], // Xe vao hom nay nhung chua co lenh trong Cyber
  };

  // Phan loai xe da vao hom nay
  for (const [plate, tracking] of todayByPlate) {
    const order = orderByPlate.get(plate);

    if (!order) {
      // Xe vao nhung khong co lenh nao → chua duoc tiep nhan
      cats.notReceived.push({ tracking });
      continue;
    }

    const isPaid = order.paymentStatus === 'DA_THANH_TOAN' || order.paymentStatus === 'DA_QUYET_TOAN';
    const isOut  = tracking.status === 'Da ra xuong';
    const isIn   = tracking.status === 'Dang trong xuong';

    if (isOut) {
      if (isPaid) cats.doneAndPaid.push({ order, tracking });
      else        cats.doneNotPaid.push({ order, tracking });
    } else if (isIn) {
      if (isPaid) cats.inWorkshopPaid.push({ order, tracking });
      else        cats.inWorkshopWorking.push({ order, tracking });
    } else {
      // Trang thai khac (hiem gap)
      cats.inWorkshopWorking.push({ order, tracking });
    }
  }

  const totalIn       = todayByPlate.size;
  const totalWithOrder = totalIn - cats.notReceived.length;

  logger.info('Accounting report generated', {
    totalIn,
    totalWithOrder,
    doneAndPaid:       cats.doneAndPaid.length,
    doneNotPaid:       cats.doneNotPaid.length,
    inWorkshopWorking: cats.inWorkshopWorking.length,
    inWorkshopPaid:    cats.inWorkshopPaid.length,
    notReceived:       cats.notReceived.length,
  });

  return buildMessages(cats, totalIn, totalWithOrder, excelOrders.length, tz);
}

function buildMessages(cats, totalIn, totalWithOrder, totalExcelOrders, tz) {
  const today = DateTime.now().setZone(tz).toFormat('dd/MM/yyyy');
  const convRate = pct(totalWithOrder, totalIn);
  const parts = [];

  // ── Tong quan (metric chinh) ──
  parts.push(
    `BAO CAO TIEP NHAN - ${today}\n` +
    `\n` +
    `Xe vao hom nay:    ${totalIn}\n` +
    `Da duoc len lenh:  ${totalWithOrder} (${convRate})\n` +
    `Chua tiep nhan:    ${cats.notReceived.length}\n` +
    `\n` +
    `--- Chi tiet lenh ---\n` +
    `[OK]  Xong + Thanh toan:   ${cats.doneAndPaid.length}\n` +
    `[!!]  Xong + Chua TT:      ${cats.doneNotPaid.length}\n` +
    `[SC]  Xuong + Dang sua:    ${cats.inWorkshopWorking.length}\n` +
    `[CB]  Xuong + Da quyet toan: ${cats.inWorkshopPaid.length}`
  );

  // ── Chua tiep nhan (uu tien hien thi dau) ──
  if (cats.notReceived.length > 0) {
    let block = `[--] CHUA DUOC TIEP NHAN (${cats.notReceived.length}):\n`;
    block += `(Xe da vao xuong nhung chua co lenh sua trong Cyber)\n`;
    for (const { tracking } of cats.notReceived) {
      const timeStr = hoursLabel(tracking.timeIn, tz);
      const status  = tracking.status === 'Dang trong xuong' ? 'Con trong xuong' : 'Da ra';
      block += `\n${tracking.plate} - Vao: ${tracking.timeIn} (${timeStr}) - ${status}\n`;
    }
    parts.push(block);
  }

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

  // ── Con trong xuong + Dang sua ──
  if (cats.inWorkshopWorking.length > 0) {
    let block = `[SC] CON XUONG + DANG SUA (${cats.inWorkshopWorking.length}):\n`;
    for (const { order, tracking } of cats.inWorkshopWorking) {
      block +=
        `\n${order.plateRaw} - ${order.model}\n` +
        `  KH: ${order.customer}\n` +
        `  Vao: ${tracking.timeIn} (${hoursLabel(tracking.timeIn, tz)})\n` +
        `  YC: ${order.request || order.serviceType || '-'}\n` +
        `  Lenh: ${order.workOrder}\n` +
        `  Tong: ${formatMoney(order.total)} | ${order.status || 'Chua quyet toan'}\n`;
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
