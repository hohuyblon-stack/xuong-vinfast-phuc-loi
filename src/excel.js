'use strict';

const XLSX = require('xlsx');
const axios = require('axios');
const logger = require('./logger');

// Trang thai duoc coi la DA THANH TOAN
const PAID_STATUSES = new Set(['Hoàn thành thanh toán', 'Hoàn thành']);
// Trang thai duoc coi la DA QUYET TOAN (xong tien, cho ban giao)
const SETTLED_STATUSES = new Set(['Quyết toán', 'Quyết toán đang được xử lý', 'Quyết toán trước']);

/**
 * Chuan hoa bien so: bo khoang trang, dau gach, viet hoa.
 * VD: "30 G-98362" → "30G98362"
 */
function normalizePlate(plate) {
  if (!plate) return '';
  return String(plate).replace(/[\s\-\.]/g, '').toUpperCase();
}

/**
 * Xac dinh trang thai thanh toan tu truong Trang thai cua Excel.
 * @returns {'DA_THANH_TOAN'|'DA_QUYET_TOAN'|'DANG_SUA'|'KHAC'|'KHONG_RO'}
 */
function getPaymentStatus(status) {
  if (!status) return 'KHONG_RO';
  if (PAID_STATUSES.has(status)) return 'DA_THANH_TOAN';
  if (SETTLED_STATUSES.has(status)) return 'DA_QUYET_TOAN';
  if (status === 'Lệnh sửa chữa' || status === 'Đang trong lệnh sửa chữa') return 'DANG_SUA';
  return 'KHAC';
}

/**
 * Tai file Excel tu URL (Telegram) va parse thanh mang cac lenh sua chua.
 * @param {string} fileUrl - URL tai file tu Telegram
 * @returns {Promise<Array>} - Mang cac work order
 */
async function downloadAndParseExcel(fileUrl) {
  const response = await axios.get(fileUrl, {
    responseType: 'arraybuffer',
    timeout: 30000,
  });

  return parseExcelBuffer(Buffer.from(response.data));
}

/**
 * Parse Excel tu Buffer (dung cho ca upload truc tiep va download).
 * @param {Buffer} buffer
 * @returns {Array} - Mang cac work order da chuan hoa
 */
function parseExcelBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });

  // Lay sheet dau tien (bo qua hiddenSheet)
  const sheetName = workbook.SheetNames.find(n => !n.toLowerCase().includes('hidden')) || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  if (rows.length < 2) {
    logger.warn('Excel file has no data rows');
    return [];
  }

  const headers = rows[0].map(h => (h ? String(h) : ''));

  // Tim chi so cot theo ten cot
  const col = (keyword) => headers.findIndex(h => h.includes(keyword));

  const idx = {
    plate:       col('Biển số'),
    status:      col('Trạng thái'),
    workOrder:   col('Lệnh sửa chữa'),
    customer:    col('Tên khách hàng'),
    bringer:     col('Người mang xe'),
    request:     col('Yêu cầu khách hàng'),
    model:       col('Dòng xe'),
    labor:       col('nhân công'),
    parts:       col('phụ tùng'),
    total:       col('Tổng tiền '),   // trailing space matches "Tổng tiền " (not nhân công / phụ tùng)
    serviceType: col('Loại hình'),
    date:        col('Ngày giao dịch'),
    advisor:     col('Cố vấn dịch vụ'),
  };

  // Fallback: "Tổng tiền " may not match exactly — find the standalone total col
  if (idx.total === -1) {
    idx.total = headers.findIndex(h => h.trim() === 'Tổng tiền');
  }

  const orders = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rawPlate = idx.plate >= 0 ? row[idx.plate] : null;
    if (!rawPlate) continue;

    const status = idx.status >= 0 ? row[idx.status] : null;

    orders.push({
      plate:       normalizePlate(String(rawPlate)),
      plateRaw:    String(rawPlate).trim(),
      status:      status ? String(status).trim() : null,
      paymentStatus: getPaymentStatus(status ? String(status).trim() : null),
      workOrder:   idx.workOrder >= 0 ? (row[idx.workOrder] || '') : '',
      customer:    idx.customer >= 0 ? (row[idx.customer] || '') : '',
      bringer:     idx.bringer  >= 0 ? (row[idx.bringer]  || '') : '',
      request:     idx.request  >= 0 ? (row[idx.request]  || '') : '',
      model:       idx.model    >= 0 ? (row[idx.model]    || '') : '',
      advisor:     idx.advisor  >= 0 ? (row[idx.advisor]  || '') : '',
      serviceType: idx.serviceType >= 0 ? (row[idx.serviceType] || '') : '',
      labor:       idx.labor >= 0 ? (Number(row[idx.labor]) || 0) : 0,
      parts:       idx.parts >= 0 ? (Number(row[idx.parts]) || 0) : 0,
      total:       idx.total >= 0 ? (Number(row[idx.total]) || 0) : 0,
      date:        idx.date >= 0 ? row[idx.date] : null,
    });
  }

  logger.info('Excel parsed', { sheetName, totalOrders: orders.length });
  return orders;
}

module.exports = { downloadAndParseExcel, normalizePlate };
