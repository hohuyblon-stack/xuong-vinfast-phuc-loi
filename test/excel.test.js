'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const axios = require('axios');
const { downloadAndParseExcel, normalizePlate } = require('../src/excel');

const originalAxiosGet = axios.get;

// ──────────────────────────────────────────────
// Test: normalizePlate
// ──────────────────────────────────────────────

describe('normalizePlate', () => {
  it('should normalize spaces and dashes', () => {
    assert.equal(normalizePlate('30 G-98362'), '30G98362');
    assert.equal(normalizePlate('30G-98362'), '30G98362');
    assert.equal(normalizePlate('30G.98362'), '30G98362');
  });

  it('should convert to uppercase', () => {
    assert.equal(normalizePlate('30a-98362'), '30A98362');
    assert.equal(normalizePlate('51f1-99999'), '51F199999');
  });

  it('should handle empty/null input', () => {
    assert.equal(normalizePlate(''), '');
    assert.equal(normalizePlate(null), '');
    assert.equal(normalizePlate(undefined), '');
  });

  it('should trim whitespace', () => {
    assert.equal(normalizePlate('  30A-12345  '), '30A12345');
  });
});

// ──────────────────────────────────────────────
// Test: parseExcelBuffer
// ──────────────────────────────────────────────

describe('parseExcelBuffer (via downloadAndParseExcel)', () => {
  beforeEach(() => {
    axios.get = originalAxiosGet;
  });

  it('should parse valid Excel with work orders', async () => {
    // Create a test Excel file in memory
    const ws = XLSX.utils.json_to_sheet([
      {
        'Biển số': '30A-12345',
        'Trạng thái': 'Hoàn thành thanh toán',
        'Lệnh sửa chữa': 'WO-001',
        'Tên khách hàng': 'Anh Hùng',
        'Người mang xe': 'Tân',
        'Yêu cầu khách hàng': 'Thay dầu',
        'Dòng xe': 'Toyota Vios',
        'nhân công': 500000,
        'phụ tùng': 1000000,
        'Tổng tiền ': 1500000,
        'Loại hình': 'Bảo dưỡng',
        'Ngày giao dịch': new Date('2024-03-20'),
        'Cố vấn dịch vụ': 'Minh',
      },
    ]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Orders');
    const buffer = XLSX.write(wb, { type: 'buffer' });

    axios.get = async () => {
      return { data: buffer };
    };

    const orders = await downloadAndParseExcel('http://example.com/orders.xlsx');

    assert.equal(orders.length, 1);
    assert.equal(orders[0].plate, '30A12345');
    assert.equal(orders[0].paymentStatus, 'DA_THANH_TOAN');
    assert.equal(orders[0].workOrder, 'WO-001');
    assert.equal(orders[0].customer, 'Anh Hùng');
    assert.equal(orders[0].labor, 500000);
    assert.equal(orders[0].parts, 1000000);
    assert.equal(orders[0].total, 1500000);
  });

  it('should handle settled status', async () => {
    const ws = XLSX.utils.json_to_sheet([
      {
        'Biển số': '51F1-99999',
        'Trạng thái': 'Quyết toán',
        'Lệnh sửa chữa': 'WO-002',
      },
    ]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Orders');
    const buffer = XLSX.write(wb, { type: 'buffer' });

    axios.get = async () => {
      return { data: buffer };
    };

    const orders = await downloadAndParseExcel('http://example.com/orders.xlsx');

    assert.equal(orders.length, 1);
    assert.equal(orders[0].paymentStatus, 'DA_QUYET_TOAN');
  });

  it('should handle work in progress status', async () => {
    const ws = XLSX.utils.json_to_sheet([
      {
        'Biển số': '30A-11111',
        'Trạng thái': 'Đang trong lệnh sửa chữa',
      },
    ]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Orders');
    const buffer = XLSX.write(wb, { type: 'buffer' });

    axios.get = async () => {
      return { data: buffer };
    };

    const orders = await downloadAndParseExcel('http://example.com/orders.xlsx');

    assert.equal(orders.length, 1);
    assert.equal(orders[0].paymentStatus, 'DANG_SUA');
  });

  it('should skip rows without license plate', async () => {
    const ws = XLSX.utils.json_to_sheet([
      {
        'Biển số': '30A-12345',
        'Trạng thái': 'Hoàn thành thanh toán',
      },
      {
        'Biển số': null, // No plate
        'Trạng thái': 'Quyết toán',
      },
      {
        'Biển số': '51F1-99999',
        'Trạng thái': 'Hoàn thành',
      },
    ]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Orders');
    const buffer = XLSX.write(wb, { type: 'buffer' });

    axios.get = async () => {
      return { data: buffer };
    };

    const orders = await downloadAndParseExcel('http://example.com/orders.xlsx');

    assert.equal(orders.length, 2); // Should skip the row without plate
    assert.ok(orders.every(o => o.plate !== ''));
  });

  it('should handle missing optional columns gracefully', async () => {
    const ws = XLSX.utils.json_to_sheet([
      {
        'Biển số': '30A-22222',
        // Missing other columns
      },
    ]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Orders');
    const buffer = XLSX.write(wb, { type: 'buffer' });

    axios.get = async () => {
      return { data: buffer };
    };

    const orders = await downloadAndParseExcel('http://example.com/orders.xlsx');

    assert.equal(orders.length, 1);
    assert.equal(orders[0].plate, '30A22222');
    assert.equal(orders[0].workOrder, '');
    assert.equal(orders[0].labor, 0);
    assert.equal(orders[0].total, 0);
  });

  it('should parse numeric columns correctly', async () => {
    const ws = XLSX.utils.json_to_sheet([
      {
        'Biển số': '98A1-55555',
        'nhân công': '2000000', // String number
        'phụ tùng': '3000000',
        'Tổng tiền ': '5000000',
      },
    ]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Orders');
    const buffer = XLSX.write(wb, { type: 'buffer' });

    axios.get = async () => {
      return { data: buffer };
    };

    const orders = await downloadAndParseExcel('http://example.com/orders.xlsx');

    assert.equal(orders[0].labor, 2000000);
    assert.equal(orders[0].parts, 3000000);
    assert.equal(orders[0].total, 5000000);
  });

  it('should handle empty Excel file', async () => {
    const ws = XLSX.utils.json_to_sheet([]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Empty');
    const buffer = XLSX.write(wb, { type: 'buffer' });

    axios.get = async () => {
      return { data: buffer };
    };

    const orders = await downloadAndParseExcel('http://example.com/empty.xlsx');

    assert.equal(orders.length, 0);
  });

  it('should preserve raw plate value', async () => {
    const ws = XLSX.utils.json_to_sheet([
      {
        'Biển số': '30 A - 12345',
      },
    ]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Orders');
    const buffer = XLSX.write(wb, { type: 'buffer' });

    axios.get = async () => {
      return { data: buffer };
    };

    const orders = await downloadAndParseExcel('http://example.com/orders.xlsx');

    assert.equal(orders[0].plate, '30A12345'); // Normalized
    assert.equal(orders[0].plateRaw, '30 A - 12345'); // Original
  });
});
