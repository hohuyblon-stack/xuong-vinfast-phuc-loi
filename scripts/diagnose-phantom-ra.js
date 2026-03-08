'use strict';

/**
 * Diagnose phantom RA records in Supabase caused by the burst-photo race condition.
 *
 * A "phantom RA" is a vehicle record where:
 *   - status = 'Đã ra xưởng'
 *   - duration_minutes < 2   (out in under 2 minutes — physically impossible for workshop)
 *
 * The script prints a report and optionally flags them by setting status to 'CẦN KIỂM TRA'
 * and priority to 'Khẩn' so they stand out in the dashboard.
 *
 * Usage:
 *   node scripts/diagnose-phantom-ra.js           # report only (safe)
 *   node scripts/diagnose-phantom-ra.js --fix     # flag records in DB
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

require('dotenv/config');

const { createClient } = require('@supabase/supabase-js');
const { DateTime } = require('luxon');
const { loadConfig } = require('../src/config');

const TZ = 'Asia/Ho_Chi_Minh';
const FIX_MODE = process.argv.includes('--fix');

function fmtTs(iso) {
  if (!iso) return '—';
  return DateTime.fromISO(iso, { zone: TZ }).toFormat('dd/MM/yyyy HH:mm:ss');
}

function fmtDur(minutes) {
  if (minutes == null) return '—';
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  return `${minutes} phút`;
}

async function main() {
  const config = loadConfig();
  const supabase = createClient(config.supabase.url, config.supabase.serviceKey, {
    auth: { persistSession: false },
  });

  console.log('Scanning Supabase for phantom RA records (duration < 2 minutes)…\n');

  const { data, error } = await supabase
    .from('vehicles')
    .select('vehicle_id, plate, time_in, time_out, duration_minutes, status, priority, note')
    .eq('status', 'Đã ra xưởng')
    .lt('duration_minutes', 2)
    .order('time_in', { ascending: false });

  if (error) {
    console.error('Query failed:', error.message);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.log('✅ No phantom RA records found. Data looks clean.');
    return;
  }

  console.log(`⚠️  Found ${data.length} potential phantom RA record(s):\n`);
  console.log('─'.repeat(90));
  console.log(
    'vehicle_id'.padEnd(30) +
    'plate'.padEnd(12) +
    'time_in'.padEnd(22) +
    'time_out'.padEnd(22) +
    'dur'
  );
  console.log('─'.repeat(90));

  for (const v of data) {
    console.log(
      v.vehicle_id.padEnd(30) +
      v.plate.padEnd(12) +
      fmtTs(v.time_in).padEnd(22) +
      fmtTs(v.time_out).padEnd(22) +
      fmtDur(v.duration_minutes)
    );
  }

  console.log('─'.repeat(90));

  if (!FIX_MODE) {
    console.log('\nRun with --fix to flag these records as CẦN KIỂM TRA in Supabase.');
    console.log('This DOES NOT delete them — it just marks them for human review.');
    return;
  }

  // ── Fix mode: flag each record ─────────────────────────────────────────────

  console.log('\n[--fix] Flagging records as CẦN KIỂM TRA…');

  let flagged = 0, failed = 0;
  for (const v of data) {
    const { error: updateErr } = await supabase
      .from('vehicles')
      .update({
        status:     'CẦN KIỂM TRA',
        priority:   'Khẩn',
        note:       (v.note ? v.note + ' | ' : '') +
                    `[PHANTOM_RA: duration=${v.duration_minutes}m, flagged by diagnose script]`,
        updated_at: new Date().toISOString(),
      })
      .eq('vehicle_id', v.vehicle_id);

    if (updateErr) {
      console.error(`  ✗ ${v.vehicle_id} (${v.plate}): ${updateErr.message}`);
      failed++;
    } else {
      console.log(`  ✓ ${v.vehicle_id} (${v.plate}) → CẦN KIỂM TRA`);
      flagged++;
    }
  }

  console.log(`\nDone. ${flagged} flagged, ${failed} errors.`);
  console.log('Review these records in Supabase and correct them manually as needed.');
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
