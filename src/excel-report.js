'use strict';

/**
 * Xuất báo cáo nhật ký hàng ngày dạng file Excel (.xlsx).
 *
 * Format: dòng thời gian — mỗi dòng = 1 sự kiện (xe vào / xe ra),
 * sắp xếp theo giờ mới nhất trên đầu. Cuối file có dòng tổng kết.
 *
 * Gửi vào nhóm Telegram lúc 18:00 thay thế báo cáo text cũ.
 */

const ExcelJS = require('exceljs');
const { DateTime } = require('luxon');
const logger = require('./logger');

// ──────────────────────────────────────────────
// Màu sắc — đồng bộ với sheets-format.js
// ──────────────────────────────────────────────

const COLORS = {
  headerBg:   'FF1A73E8', // xanh dương đậm
  headerText: 'FFFFFFFF', // trắng
  vaoTag:     'FF0D904F', // xanh lá
  raTag:      'FF1A73E8', // xanh dương
  urgentBg:   'FFFCE4EC', // đỏ nhạt
  warningBg:  'FFFFF8E1', // vàng nhạt
  normalBg:   'FFE8F5E9', // xanh nhạt
  summaryBg:  'FFF3F4F6', // xám nhạt
  border:     'FFDADCE0', // viền nhạt
};

/**
 * Tạo file Excel báo cáo nhật ký từ dữ liệu hoạt động hôm nay.
 *
 * @param {Array} todayVehicles - Kết quả từ db.getTodayActivity(tz)
 * @param {Array} inWorkshopVehicles - Kết quả từ db.getAllInWorkshop(tz)
 * @param {string} tz - Múi giờ (VD: 'Asia/Ho_Chi_Minh')
 * @returns {Promise<Buffer>} - File Excel dạng Buffer
 */
async function buildDailyExcelReport(todayVehicles, inWorkshopVehicles, tz) {
  const now = DateTime.now().setZone(tz);
  const todayStr = now.toFormat('dd/MM/yyyy');

  // ── Xây dựng dòng thời gian ──
  const timeline = [];

  for (const v of todayVehicles) {
    const tIn = v.timeInISO ? DateTime.fromISO(v.timeInISO, { zone: tz }) : null;
    const tOut = v.timeOutISO ? DateTime.fromISO(v.timeOutISO, { zone: tz }) : null;
    const todayStart = now.startOf('day');
    const todayEnd = now.plus({ days: 1 }).startOf('day');

    // Sự kiện VÀO (nếu vào trong ngày hôm nay)
    if (tIn && tIn >= todayStart && tIn < todayEnd) {
      timeline.push({
        time: tIn,
        timeStr: tIn.toFormat('HH:mm'),
        plate: v.plate,
        vehicleModel: v.vehicleModel || '',
        event: 'Xe vào',
        note: '',
        sortKey: tIn.toMillis(),
      });
    }

    // Sự kiện RA (nếu ra trong ngày hôm nay)
    if (tOut && tOut >= todayStart && tOut < todayEnd) {
      const durationStr = v.durationMinutes != null
        ? formatDuration(v.durationMinutes)
        : '';
      timeline.push({
        time: tOut,
        timeStr: tOut.toFormat('HH:mm'),
        plate: v.plate,
        vehicleModel: v.vehicleModel || '',
        event: 'Xe ra',
        note: durationStr ? `Thời gian sửa: ${durationStr}` : '',
        sortKey: tOut.toMillis(),
      });
    }
  }

  // Sắp xếp: mới nhất trên đầu
  timeline.sort((a, b) => b.sortKey - a.sortKey);

  // ── Tính tổng kết ──
  const totalIn = timeline.filter(e => e.event === 'Xe vào').length;
  const totalOut = timeline.filter(e => e.event === 'Xe ra').length;
  const inWorkshop = inWorkshopVehicles.length;

  // ── Tạo workbook ──
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Xưởng VinFast Phúc Lợi';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(`Nhật ký ${now.toFormat('dd-MM')}`, {
    properties: { defaultColWidth: 15 },
  });

  // ── Tiêu đề ──
  sheet.mergeCells('A1:F1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = `NHẬT KÝ XƯỞNG — ${todayStr}`;
  titleCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: COLORS.headerText } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 36;

  // ── Tóm tắt nhanh ──
  sheet.mergeCells('A2:F2');
  const summaryCell = sheet.getCell('A2');
  summaryCell.value = `Vào: ${totalIn}  |  Ra: ${totalOut}  |  Đang trong xưởng: ${inWorkshop}  |  Cập nhật: ${now.toFormat('HH:mm')}`;
  summaryCell.font = { name: 'Arial', size: 10, italic: true };
  summaryCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.summaryBg } };
  summaryCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(2).height = 24;

  // ── Header bảng ──
  const headers = ['STT', 'Giờ', 'Biển số', 'Loại xe', 'Sự kiện', 'Ghi chú'];
  const headerRow = sheet.addRow(headers);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: COLORS.headerText } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = thinBorder();
  });

  // ── Dữ liệu ──
  for (let i = 0; i < timeline.length; i++) {
    const e = timeline[i];
    const row = sheet.addRow([
      i + 1,
      e.timeStr,
      e.plate,
      e.vehicleModel,
      e.event,
      e.note,
    ]);

    row.eachCell((cell, colNumber) => {
      cell.font = { name: 'Arial', size: 10 };
      cell.alignment = { vertical: 'middle' };
      cell.border = thinBorder();

      // Căn giữa STT và Giờ
      if (colNumber <= 2) cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // Màu nền xen kẽ
    const bgColor = i % 2 === 0 ? 'FFFFFFFF' : 'FFF8F9FA';
    row.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
    });

    // Tag màu cho cột Sự kiện
    const eventCell = row.getCell(5);
    if (e.event === 'Xe vào') {
      eventCell.font = { name: 'Arial', size: 10, bold: true, color: { argb: COLORS.vaoTag } };
    } else {
      eventCell.font = { name: 'Arial', size: 10, bold: true, color: { argb: COLORS.raTag } };
    }
  }

  // ── Dòng tổng kết cuối ──
  const summaryRow = sheet.addRow(['', '', '', '', 'TỔNG KẾT', '']);
  sheet.mergeCells(`A${summaryRow.number}:D${summaryRow.number}`);
  const sumCell = sheet.getCell(`A${summaryRow.number}`);
  sumCell.value = `Tổng: ${totalIn} xe vào  •  ${totalOut} xe ra  •  ${inWorkshop} đang trong xưởng`;
  sumCell.font = { name: 'Arial', size: 11, bold: true };
  sumCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.summaryBg } };
  sumCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sumCell.border = thinBorder();
  summaryRow.height = 30;
  // Áp dụng style cho toàn bộ dòng tổng kết
  summaryRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.summaryBg } };
    cell.border = thinBorder();
  });

  // ── Độ rộng cột ──
  sheet.getColumn(1).width = 6;   // STT
  sheet.getColumn(2).width = 10;  // Giờ
  sheet.getColumn(3).width = 14;  // Biển số
  sheet.getColumn(4).width = 16;  // Loại xe
  sheet.getColumn(5).width = 12;  // Sự kiện
  sheet.getColumn(6).width = 28;  // Ghi chú

  // ── Xuất Buffer ──
  const buffer = await workbook.xlsx.writeBuffer();
  logger.info('File Excel báo cáo đã tạo', {
    ngày: todayStr,
    sựKiện: timeline.length,
    vào: totalIn,
    ra: totalOut,
  });

  return Buffer.from(buffer);
}

// ──────────────────────────────────────────────
// Tiện ích
// ──────────────────────────────────────────────

function formatDuration(minutes) {
  if (minutes == null) return '';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}p` : `${m}p`;
}

function thinBorder() {
  const side = { style: 'thin', color: { argb: COLORS.border } };
  return { top: side, bottom: side, left: side, right: side };
}

module.exports = { buildDailyExcelReport };
