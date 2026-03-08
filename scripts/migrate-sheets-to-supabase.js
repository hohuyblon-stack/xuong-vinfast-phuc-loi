'use strict';

/**
 * One-time migration: Google Sheets → Supabase
 *
 * Reads all rows from the three Sheets tabs and inserts them into Supabase.
 * Safe to re-run — uses upsert (ON CONFLICT DO NOTHING) everywhere.
 *
 * Usage:
 *   node scripts/migrate-sheets-to-supabase.js
 *
 * Required env vars (same as the bot):
 *   GOOGLE_CREDENTIALS_JSON, GOOGLE_SHEET_ID,
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

require('dotenv/config');

const { createClient } = require('@supabase/supabase-js');
const { DateTime } = require('luxon');
const { loadConfig } = require('../src/config');
const { initSheets } = require('../src/sheets');

const TZ = 'Asia/Ho_Chi_Minh';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse dd/MM/yyyy HH:mm:ss → ISO UTC string.
 * Returns null if blank or unparseable.
 */
function parseVnTs(s) {
  if (!s || !s.trim()) return null;
  const dt = DateTime.fromFormat(s.trim(), 'dd/MM/yyyy HH:mm:ss', { zone: TZ });
  return dt.isValid ? dt.toUTC().toISO() : null;
}

function safeInt(v) {
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const config = loadConfig();
  const supabase = createClient(config.supabase.url, config.supabase.serviceKey, {
    auth: { persistSession: false },
  });

  console.log('Connecting to Google Sheets…');
  await initSheets(config.sheets);

  const { getSpreadsheet } = require('../src/sheets');

  // ── 1. DANH SÁCH CHÍNH → vehicles ──────────────────────────────────────────

  console.log('\n[1/3] Migrating DANH SÁCH CHÍNH → vehicles…');
  const mainRows = await getMainRows(config);
  console.log(`  Found ${mainRows.length} rows`);

  let vehicleInserted = 0, vehicleSkipped = 0, vehicleError = 0;
  for (const row of mainRows) {
    if (!row.vehicleId || !row.plate || !row.timeIn) {
      vehicleSkipped++;
      continue;
    }
    const timeInIso  = parseVnTs(row.timeIn);
    const timeOutIso = parseVnTs(row.timeOut);
    if (!timeInIso) { vehicleSkipped++; continue; }

    const record = {
      vehicle_id:       row.vehicleId,
      plate:            row.plate,
      time_in:          timeInIso,
      time_out:         timeOutIso || null,
      duration_minutes: timeOutIso ? safeInt(row.duration) : null,
      image_in_url:     row.imageInUrl  || '',
      image_out_url:    row.imageOutUrl || null,
      status:           row.status   || 'Đang trong xưởng',
      priority:         row.priority || 'Bình thường',
      note:             row.note     || '',
      updated_at:       new Date().toISOString(),
    };

    const { error } = await supabase
      .from('vehicles')
      .upsert(record, { onConflict: 'vehicle_id', ignoreDuplicates: true });

    if (error) {
      console.error(`  ✗ vehicle ${row.vehicleId}: ${error.message}`);
      vehicleError++;
    } else {
      vehicleInserted++;
    }
  }
  console.log(`  ✓ vehicles: ${vehicleInserted} inserted, ${vehicleSkipped} skipped, ${vehicleError} errors`);

  // ── 2. NHẬT KÝ → events ────────────────────────────────────────────────────

  console.log('\n[2/3] Migrating NHẬT KÝ → events…');
  const logRows = await getLogRows(config);
  console.log(`  Found ${logRows.length} rows`);

  let eventInserted = 0, eventSkipped = 0, eventError = 0;
  for (const row of logRows) {
    if (!row.eventId || !row.timestamp) { eventSkipped++; continue; }
    const tsIso = parseVnTs(row.timestamp);
    if (!tsIso) { eventSkipped++; continue; }

    const record = {
      event_id:         row.eventId,
      timestamp:        tsIso,
      record_type:      row.recordType      || 'Chưa xác định',
      plate_ai:         row.plateAI         || '',
      confidence_label: row.confidenceLabel || '',
      image_url:        row.imageUrl        || '',
      sender:           row.sender          || '',
      message_key:      row.messageKey      || '',
      result:           row.result          || '',
    };

    const { error } = await supabase
      .from('events')
      .upsert(record, { onConflict: 'event_id', ignoreDuplicates: true });

    if (error) {
      console.error(`  ✗ event ${row.eventId}: ${error.message}`);
      eventError++;
    } else {
      eventInserted++;
    }
  }
  console.log(`  ✓ events: ${eventInserted} inserted, ${eventSkipped} skipped, ${eventError} errors`);

  // ── 3. CẦN KIỂM TRA → reviews ─────────────────────────────────────────────

  console.log('\n[3/3] Migrating CẦN KIỂM TRA → reviews…');
  const reviewRows = await getReviewRows(config);
  console.log(`  Found ${reviewRows.length} rows`);

  let reviewInserted = 0, reviewSkipped = 0, reviewError = 0;
  for (const row of reviewRows) {
    if (!row.errorId || !row.timestamp) { reviewSkipped++; continue; }
    const tsIso = parseVnTs(row.timestamp);
    if (!tsIso) { reviewSkipped++; continue; }

    const record = {
      error_id:          row.errorId,
      event_id:          row.eventId          || '',
      timestamp:         tsIso,
      image_url:         row.imageUrl         || '',
      plate_ai:          row.plateAI          || '',
      corrected_plate:   row.correctedPlate   || '',
      reason:            row.reason           || '',
      suggestion:        row.suggestion       || '',
      review_status:     row.reviewStatus     || 'Chưa xử lý',
      review_note:       row.reviewNote       || '',
      reviewer:          row.reviewer         || '',
      linked_vehicle_id: row.linkedVehicleId  || '',
    };

    const { error } = await supabase
      .from('reviews')
      .upsert(record, { onConflict: 'error_id', ignoreDuplicates: true });

    if (error) {
      console.error(`  ✗ review ${row.errorId}: ${error.message}`);
      reviewError++;
    } else {
      reviewInserted++;
    }
  }
  console.log(`  ✓ reviews: ${reviewInserted} inserted, ${reviewSkipped} skipped, ${reviewError} errors`);

  console.log('\nMigration complete.');
}

// ── Sheet readers ─────────────────────────────────────────────────────────────
// These read raw rows directly from Google Sheets via the sheets module.
// Column order matches the current tab layouts.

async function getMainRows(config) {
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    credentials: config.sheets.credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const tabName = config.sheets.tabNames.main;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.spreadsheetId,
    range: `'${tabName}'!A2:N`,  // skip header row
  });

  return (res.data.values || []).map(r => ({
    vehicleId:    r[0]  || '',
    plate:        r[1]  || '',
    timeIn:       r[2]  || '',
    timeOut:      r[3]  || '',
    duration:     r[4]  || '',
    status:       r[5]  || '',
    priority:     r[6]  || '',
    note:         r[7]  || '',
    imageInUrl:   r[8]  || '',
    imageOutUrl:  r[9]  || '',
  }));
}

async function getLogRows(config) {
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    credentials: config.sheets.credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const tabName = config.sheets.tabNames.log;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.spreadsheetId,
    range: `'${tabName}'!A2:J`,
  });

  return (res.data.values || []).map(r => ({
    eventId:         r[0] || '',
    timestamp:       r[1] || '',
    recordType:      r[2] || '',
    plateAI:         r[3] || '',
    confidenceLabel: r[4] || '',
    imageUrl:        r[5] || '',
    sender:          r[6] || '',
    messageKey:      r[7] || '',
    result:          r[8] || '',
  }));
}

async function getReviewRows(config) {
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    credentials: config.sheets.credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const tabName = config.sheets.tabNames.review;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.spreadsheetId,
    range: `'${tabName}'!A2:M`,
  });

  return (res.data.values || []).map(r => ({
    errorId:         r[0]  || '',
    eventId:         r[1]  || '',
    timestamp:       r[2]  || '',
    imageUrl:        r[3]  || '',
    plateAI:         r[4]  || '',
    correctedPlate:  r[5]  || '',
    reason:          r[6]  || '',
    suggestion:      r[7]  || '',
    reviewStatus:    r[8]  || '',
    reviewNote:      r[9]  || '',
    reviewer:        r[10] || '',
    linkedVehicleId: r[11] || '',
  }));
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
