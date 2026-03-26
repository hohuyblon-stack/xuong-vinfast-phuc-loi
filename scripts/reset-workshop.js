#!/usr/bin/env node
'use strict';

/**
 * Reset Workshop Script
 * ---------------------
 * Xoa sach du lieu cu trong Supabase + Google Sheets,
 * insert danh sach xe hien tai trong xuong.
 *
 * Usage:  node scripts/reset-workshop.js
 */

require('dotenv/config');

const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SHEET_ID     = process.env.GOOGLE_SHEET_ID;
const CREDS        = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);

const TAB_MAIN      = process.env.SHEET_TAB_MAIN      || 'DANH SÁCH CHÍNH';
const TAB_COMPLETED = process.env.SHEET_TAB_COMPLETED  || 'ĐÃ HOÀN THÀNH';
const TAB_LOG       = process.env.SHEET_TAB_LOG        || 'NHẬT KÝ';
const TAB_REVIEW    = process.env.SHEET_TAB_REVIEW     || 'CẦN KIỂM TRA';

// Thoi gian vao cho tat ca xe: 18:00 26/3/2026 (Asia/Ho_Chi_Minh = UTC+7)
const TIME_IN = '2026-03-26T18:00:00+07:00';
const TIME_IN_DISPLAY = '26/03/2026 18:00:00';

// ──────────────────────────────────────────────
// Danh sach 61 xe trong xuong (da loai trung)
// ──────────────────────────────────────────────

const VEHICLES = [
  '30B-100.51',
  '30M-494.27',
  '29E-506.78',
  '30K-357.15',
  '30K-490.85',
  '30G-326.81',
  '30L-575.08',
  '30L-911.73',
  '30H-955.62',
  '19H-110.75',
  '29E-452.40',
  '30D-130.29',
  '30K-674.54',
  '30B-051.84',
  '30K-930.47',
  '30B-309.82',
  '90H-049.74',
  '30L-645.70',
  '29E-362.91',
  '30H-327.33',
  '30K-746.72',
  '30L-821.13',
  '99E-011.21',
  '30M-609.92',
  '30L-414.86',
  '30G-007.54',
  '29E-129.04',
  '29E-042.75',
  '30G-180.28',
  '30B-140.92',
  '30B-310.06',
  '30B-323.57',
  '30M-752.50',
  '30G-800.07',
  '29E-195.78',
  '29G-007.62',
  '89H-104.80',
  '99E-011.42',
  '29E-068.27',
  '89A-662.80',
  '30H-607.50',
  '88A-836.76',
  '30K-277.13',
  '99E-014.16',
  '30K-047.94',
  '30L-905.91',
  '30G-195.96',
  '30W-505.25',
  '29G-006.58',
  '30B-229.10',
  '30DH-809.23',
  '30W-550.72',
  '30W-126.54',
  '89A-635.51',
  '99B-222.51',
  '29K-291.86',
  '99H-072.76',
  '20A-746.83',
  '89A-537.95',
  '30K-150.71',
  '30G-717.67',
];

function generateVehicleId() {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(3).toString('hex');
  return `V-${ts}-${rand}`.toUpperCase();
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('  RESET WORKSHOP - XUONG VINFAST PHUC LOI');
  console.log('='.repeat(60));
  console.log(`  Xe trong xuong: ${VEHICLES.length}`);
  console.log(`  Gio vao:        ${TIME_IN_DISPLAY}`);
  console.log('='.repeat(60));
  console.log();

  // ── 1. Init Supabase ──
  console.log('[1/5] Ket noi Supabase...');
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
  });

  // Test connection
  const { error: testErr } = await supabase.from('vehicles').select('id', { count: 'exact', head: true });
  if (testErr) throw new Error(`Supabase connection failed: ${testErr.message}`);
  console.log('  -> OK');

  // ── 2. Xoa sach du lieu cu ──
  console.log('[2/5] Xoa du lieu cu trong Supabase...');

  // Delete all reviews
  const { count: reviewCount } = await supabase
    .from('reviews')
    .select('*', { count: 'exact', head: true });
  if (reviewCount > 0) {
    const { error: delReview } = await supabase
      .from('reviews')
      .delete()
      .gte('id', '00000000-0000-0000-0000-000000000000');
    if (delReview) throw new Error(`Delete reviews failed: ${delReview.message}`);
  }
  console.log(`  -> Xoa ${reviewCount || 0} reviews`);

  // Delete all events
  const { count: eventCount } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true });
  if (eventCount > 0) {
    const { error: delEvent } = await supabase
      .from('events')
      .delete()
      .gte('id', '00000000-0000-0000-0000-000000000000');
    if (delEvent) throw new Error(`Delete events failed: ${delEvent.message}`);
  }
  console.log(`  -> Xoa ${eventCount || 0} events`);

  // Delete all vehicles
  const { count: vehicleCount } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true });
  if (vehicleCount > 0) {
    const { error: delVehicle } = await supabase
      .from('vehicles')
      .delete()
      .gte('id', '00000000-0000-0000-0000-000000000000');
    if (delVehicle) throw new Error(`Delete vehicles failed: ${delVehicle.message}`);
  }
  console.log(`  -> Xoa ${vehicleCount || 0} vehicles`);

  // ── 3. Insert xe moi ──
  console.log(`[3/5] Insert ${VEHICLES.length} xe vao Supabase...`);

  const now = new Date().toISOString();
  const vehicleRows = VEHICLES.map(plate => ({
    vehicle_id:   generateVehicleId(),
    plate,
    time_in:      TIME_IN,
    time_out:     null,
    duration_minutes: null,
    image_in_url: '',
    image_out_url: null,
    status:       'Đang trong xưởng',
    priority:     'Bình thường',
    note:         'Nhập thủ công - reset xưởng 26/03/2026',
    updated_at:   now,
  }));

  // Insert in batches of 20
  for (let i = 0; i < vehicleRows.length; i += 20) {
    const batch = vehicleRows.slice(i, i + 20);
    const { error: insErr } = await supabase.from('vehicles').insert(batch);
    if (insErr) throw new Error(`Insert vehicles batch ${i} failed: ${insErr.message}`);
    console.log(`  -> Inserted ${Math.min(i + 20, vehicleRows.length)}/${vehicleRows.length}`);
  }

  // Verify
  const { count: finalCount } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'Đang trong xưởng');
  console.log(`  -> Verify: ${finalCount} xe dang trong xuong`);

  // ── 4. Reset Google Sheets ──
  console.log('[4/5] Reset Google Sheets...');

  const auth = new google.auth.GoogleAuth({
    credentials: CREDS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheetsApi = google.sheets({ version: 'v4', auth });

  // Get all existing sheets
  const spreadsheet = await sheetsApi.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const existingSheets = spreadsheet.data.sheets.map(s => ({
    title: s.properties.title,
    sheetId: s.properties.sheetId,
  }));

  // Tabs to reset (clear data but keep tab)
  const tabsToReset = [TAB_MAIN, TAB_COMPLETED, TAB_LOG, TAB_REVIEW];

  // Also delete any daily report tabs (format: "BC dd/MM/yyyy" or similar)
  const coreTabs = new Set(tabsToReset);
  const tabsToDelete = existingSheets.filter(s => !coreTabs.has(s.title));

  // Delete non-core tabs (daily report tabs, etc.)
  if (tabsToDelete.length > 0) {
    // Keep at least 1 sheet (Google Sheets requires it)
    const deleteRequests = tabsToDelete.map(s => ({
      deleteSheet: { sheetId: s.sheetId },
    }));

    if (deleteRequests.length < existingSheets.length) {
      try {
        await sheetsApi.spreadsheets.batchUpdate({
          spreadsheetId: SHEET_ID,
          requestBody: { requests: deleteRequests },
        });
        console.log(`  -> Xoa ${tabsToDelete.length} tab phu: ${tabsToDelete.map(t => t.title).join(', ')}`);
      } catch (err) {
        console.warn(`  -> Khong xoa duoc tab phu: ${err.message}`);
      }
    }
  }

  // Clear core tabs (keep header, delete all data rows)
  const HEADERS = {
    [TAB_MAIN]: [
      'Mã lượt xe', 'Biển số', 'Giờ vào', 'Giờ ra',
      'Lưu trong xưởng (phút)', 'Ảnh lúc vào', 'Ảnh lúc ra',
      'Trạng thái', 'Mức ưu tiên', 'Ghi chú', 'Cập nhật lúc',
    ],
    [TAB_COMPLETED]: [
      'Mã lượt xe', 'Biển số', 'Giờ vào', 'Giờ ra',
      'Lưu trong xưởng (phút)', 'Ảnh lúc vào', 'Ảnh lúc ra',
      'Trạng thái', 'Mức ưu tiên', 'Ghi chú', 'Cập nhật lúc',
    ],
    [TAB_LOG]: [
      'Mã sự kiện', 'Thời điểm', 'Loại ghi nhận', 'Biển số (AI đọc)',
      'Chất lượng nhận dạng', 'Ảnh', 'Người gửi', 'Tin nhắn gốc', 'Kết quả xử lý',
    ],
    [TAB_REVIEW]: [
      'Mã lỗi', 'Mã sự kiện', 'Thời điểm', 'Ảnh', 'Biển số (AI đọc)',
      'Biển số (đúng)', 'Lý do', 'Hướng xử lý', 'Trạng thái xử lý', 'Ghi chú',
      'Người xử lý', 'Thời điểm xử lý', 'Liên kết lượt xe',
    ],
  };

  for (const tabName of tabsToReset) {
    const header = HEADERS[tabName];
    const colEnd = String.fromCharCode(64 + header.length); // A=65

    // Clear entire tab
    try {
      await sheetsApi.spreadsheets.values.clear({
        spreadsheetId: SHEET_ID,
        range: `'${tabName}'!A:Z`,
      });
    } catch {
      // Tab might not exist, create it
      await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          requests: [{ addSheet: { properties: { title: tabName } } }],
        },
      });
    }

    // Write header
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `'${tabName}'!A1:${colEnd}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [header] },
    });

    console.log(`  -> Reset tab "${tabName}"`);
  }

  // ── 5. Ghi xe vao tab DANH SACH CHINH ──
  console.log(`[5/5] Ghi ${VEHICLES.length} xe vao Google Sheets...`);

  const sheetRows = vehicleRows.map(v => [
    v.vehicle_id,
    v.plate,
    TIME_IN_DISPLAY,
    '',  // time_out
    '',  // duration
    '',  // image_in
    '',  // image_out
    'Đang trong xưởng',
    'Bình thường',
    v.note,
    new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
  ]);

  await sheetsApi.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `'${TAB_MAIN}'!A:K`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: sheetRows },
  });

  console.log(`  -> OK: ${sheetRows.length} dong da ghi`);

  // ── Done ──
  console.log();
  console.log('='.repeat(60));
  console.log('  HOAN TAT! He thong da reset thanh cong.');
  console.log(`  ${VEHICLES.length} xe dang trong xuong.`);
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('\n[LOI] Script that bai:', err.message);
  process.exit(1);
});
