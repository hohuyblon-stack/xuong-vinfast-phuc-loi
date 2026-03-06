'use strict';

/**
 * accounting.js - Bao cao ty le chuyen doi xe vao → len lenh sua chua
 *
 * File Excel tu Cyber chua cac lenh duoc tao NGAY HOM NAY.
 * He thong tracking chua lich su xe vao/ra tu truoc den nay.
 *
 * 4 truong hop can quan ly:
 *   [NGAY]  Vao hom nay + len lenh hom nay     → chuyen doi ngay trong ngay
 *   [TRE]   Vao ngay truoc + hom nay moi len lenh → ton kho → da duoc xu ly
 *   [CHO]   Vao hom nay + chua len lenh         → dang cho tiep nhan
 *   [TON]   Vao ngay truoc + van chua len lenh  → ton kho lau, chua xu ly
 *
 * Trong moi truong hop, cung phan loai trang thai thanh toan:
 *   da ra + da TT / da ra + chua TT / con xuong + dang sua / con xuong + da QT
 */

const { DateTime } = require('luxon');
const sheets = require('./sheets');
const { normalizePlate } = require('./excel');
const utils = require('./utils');
const logger = require('./logger');

const MAX_MSG_LEN = 4000;

function formatMoney(amount) {
  if (!amount || isNaN(amount)) return '0đ';
  return Number(amount).toLocaleString('vi-VN') + 'đ';
}

function hoursLabel(timeIn, tz) {
  if (!timeIn) return '';
  return utils.formatHours(utils.hoursSince(timeIn, tz));
}

function pct(num, denom) {
  if (!denom) return '0%';
  return Math.round((num / denom) * 100) + '%';
}

/**
 * Kiem tra mot chuoi thoi gian co phai ngay hom nay khong.
 * timeStr dinh dang "dd/MM/yyyy ..." hoac Date object.
 */
function isToday(timeStr, today) {
  if (!timeStr) return false;
  if (timeStr instanceof Date) {
    const d = DateTime.fromJSDate(timeStr);
    return d.toFormat('dd/MM/yyyy') === today;
  }
  return String(timeStr).startsWith(today);
}

/**
 * Lay trang thai thanh toan de phan nhom chi tiet.
 */
function paymentGroup(order, tracking) {
  const isPaid = order.paymentStatus === 'DA_THANH_TOAN' || order.paymentStatus === 'DA_QUYET_TOAN';
  const isOut  = tracking.status === 'Đã ra xưởng';
  const isIn   = tracking.status === 'Đang trong xưởng';

  if (isOut && isPaid)  return 'doneAndPaid';
  if (isOut && !isPaid) return 'doneNotPaid';
  if (isIn  && isPaid)  return 'inWorkshopPaid';
  return 'inWorkshopWorking'; // mac dinh: con xuong + dang sua
}

/**
 * Tao bao cao tong hop.
 *
 * @param {Array}  excelOrders - Lenh sua chua tu file Excel Cyber (ngay hom nay)
 * @param {object} config      - App config
 * @returns {Promise<string[]>}
 */
async function generateAccountingReport(excelOrders, config) {
  const tz = config.timezone;
  const today = DateTime.now().setZone(tz).toFormat('dd/MM/yyyy');

  // Lay toan bo lich su tracking (khong gioi han ngay)
  const allTracking = await sheets.getAllMainRows();

  // Index tracking theo bien so: plate → entry moi nhat (uu tien dang trong xuong)
  const trackingByPlate = new Map();
  for (const t of allTracking) {
    const key = normalizePlate(t.plate);
    const existing = trackingByPlate.get(key);
    // Uu tien: dang trong xuong > ra gan nhat
    if (!existing || t.status === 'Đang trong xưởng') {
      trackingByPlate.set(key, t);
    }
  }

  // Index excel theo bien so
  const orderByPlate = new Map();
  for (const order of excelOrders) {
    if (!orderByPlate.has(order.plate)) orderByPlate.set(order.plate, order);
  }

  // ── Phan loai ──

  // Xe co lenh hom nay: phan theo ngay vao + trang thai TT
  const sameDay    = { doneAndPaid: [], doneNotPaid: [], inWorkshopWorking: [], inWorkshopPaid: [] };
  const backlog    = { doneAndPaid: [], doneNotPaid: [], inWorkshopWorking: [], inWorkshopPaid: [] };
  const noTracking = []; // Co lenh nhung khong thay xe trong he thong

  for (const [plate, order] of orderByPlate) {
    const tracking = trackingByPlate.get(plate);
    if (!tracking) {
      noTracking.push({ order });
      continue;
    }

    const group = paymentGroup(order, tracking);
    const enteredToday = isToday(tracking.timeIn, today);

    if (enteredToday) sameDay[group].push({ order, tracking });
    else              backlog[group].push({ order, tracking });
  }

  // Xe trong tracking hom nay chua co lenh
  const waitingToday    = []; // vao hom nay, chua len lenh
  const waitingBacklog  = []; // vao ngay truoc, van chua len lenh

  for (const t of allTracking) {
    // Chi quan tam xe dang trong xuong (chua ra)
    if (t.status !== 'Đang trong xưởng') continue;
    const plate = normalizePlate(t.plate);
    if (orderByPlate.has(plate)) continue; // da co lenh roi

    if (isToday(t.timeIn, today)) waitingToday.push({ tracking: t });
    else                          waitingBacklog.push({ tracking: t });
  }

  const totalWithOrder = orderByPlate.size - noTracking.length;
  const totalSameDay   = Object.values(sameDay).reduce((s, a) => s + a.length, 0);
  const totalBacklog   = Object.values(backlog).reduce((s, a) => s + a.length, 0);
  const totalWaiting   = waitingToday.length + waitingBacklog.length;

  logger.info('Accounting report generated', {
    today,
    totalWithOrder,
    totalSameDay,
    totalBacklog,
    waitingToday: waitingToday.length,
    waitingBacklog: waitingBacklog.length,
    noTracking: noTracking.length,
  });

  return buildMessages(
    { sameDay, backlog, waitingToday, waitingBacklog, noTracking },
    { totalWithOrder, totalSameDay, totalBacklog, totalWaiting },
    excelOrders.length,
    today,
    tz,
  );
}

// ──────────────────────────────────────────────
// Xay dung tin nhan
// ──────────────────────────────────────────────

function orderLine(order, tracking, tz) {
  const timeStr = tracking.timeOut
    ? `Vào: ${tracking.timeIn} | Ra: ${tracking.timeOut}`
    : `Vào: ${tracking.timeIn} (${hoursLabel(tracking.timeIn, tz)})`;

  return (
    `\n${order.plateRaw} — ${order.model}\n` +
    `  Khách: ${order.customer}\n` +
    `  ${timeStr}\n` +
    `  Lệnh: ${order.workOrder}\n` +
    `  Tổng: ${formatMoney(order.total)} | ${order.status || 'Chưa quyết toán'}\n`
  );
}

function renderGroup(title, group, tz) {
  const total = Object.values(group).reduce((s, a) => s + a.length, 0);
  if (total === 0) return null;

  let block = `${title} (${total}):\n`;

  if (group.doneAndPaid.length > 0) {
    block += `\n✅ Đã ra, đã thanh toán (${group.doneAndPaid.length})`;
    for (const { order, tracking } of group.doneAndPaid) block += orderLine(order, tracking, tz);
  }
  if (group.doneNotPaid.length > 0) {
    block += `\n⚠️ Đã ra, chưa thanh toán (${group.doneNotPaid.length})`;
    for (const { order, tracking } of group.doneNotPaid) block += orderLine(order, tracking, tz);
  }
  if (group.inWorkshopWorking.length > 0) {
    block += `\n🔧 Còn trong xưởng, đang sửa (${group.inWorkshopWorking.length})`;
    for (const { order, tracking } of group.inWorkshopWorking) block += orderLine(order, tracking, tz);
  }
  if (group.inWorkshopPaid.length > 0) {
    block += `\n❗ Còn trong xưởng nhưng đã quyết toán — cần kiểm tra (${group.inWorkshopPaid.length})`;
    for (const { order, tracking } of group.inWorkshopPaid) block += orderLine(order, tracking, tz);
  }

  return block;
}

function buildMessages(cats, totals, totalExcelOrders, today, tz) {
  const parts = [];

  // ── Header / Tong quan ──
  const convRate = pct(totals.totalWithOrder, totals.totalWithOrder + cats.waitingToday.length + cats.waitingBacklog.length);
  parts.push(
    `📋 Báo cáo tiếp nhận — ${today}\n` +
    `Tổng lệnh trong file Cyber: ${totalExcelOrders}\n` +
    `\n` +
    `🟢 Vào & lên lệnh trong ngày:      ${totals.totalSameDay}\n` +
    `🔵 Tồn kho cũ, hôm nay mới lên lệnh: ${totals.totalBacklog}\n` +
    `🟡 Vào hôm nay, chưa lên lệnh:     ${cats.waitingToday.length}\n` +
    `🔴 Tồn kho lâu, vẫn chưa lên lệnh: ${cats.waitingBacklog.length}`
  );

  // 🟢 Vào hôm nay + lên lệnh hôm nay
  const sameDayBlock = renderGroup('🟢 Vào & lên lệnh trong ngày', cats.sameDay, tz);
  if (sameDayBlock) parts.push(sameDayBlock);

  // 🔵 Vào ngày trước + hôm nay mới lên lệnh
  const backlogBlock = renderGroup('🔵 Tồn kho cũ — hôm nay mới lên lệnh', cats.backlog, tz);
  if (backlogBlock) parts.push(backlogBlock);

  // 🟡 Vào hôm nay, chưa lên lệnh
  if (cats.waitingToday.length > 0) {
    let block = `🟡 Vào hôm nay, chưa lên lệnh (${cats.waitingToday.length}):\n`;
    block += `(Đang chờ tiếp nhận hoặc khách chưa đồng ý sửa)\n`;
    for (const { tracking } of cats.waitingToday) {
      block += `\n${tracking.plate} — Vào: ${tracking.timeIn} (${hoursLabel(tracking.timeIn, tz)})\n`;
    }
    parts.push(block);
  }

  // 🔴 Vào ngày trước, vẫn chưa lên lệnh
  if (cats.waitingBacklog.length > 0) {
    let block = `🔴 Tồn kho lâu — vẫn chưa lên lệnh (${cats.waitingBacklog.length}):\n`;
    block += `(Cần kiểm tra lại)\n`;
    for (const { tracking } of cats.waitingBacklog) {
      block += `\n${tracking.plate} — Vào: ${tracking.timeIn} (${hoursLabel(tracking.timeIn, tz)})\n`;
    }
    parts.push(block);
  }

  // ❓ Có lệnh nhưng không thấy xe vào
  if (cats.noTracking.length > 0) {
    let block = `❓ Có lệnh nhưng không thấy xe vào (${cats.noTracking.length}):\n`;
    block += `(Biển số có thể khác / chưa chụp ảnh lúc vào)\n`;
    for (const { order } of cats.noTracking) {
      block +=
        `\n${order.plateRaw} — ${order.model}\n` +
        `  Khách: ${order.customer}\n` +
        `  Lệnh: ${order.workOrder} | Tổng: ${formatMoney(order.total)}\n`;
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
