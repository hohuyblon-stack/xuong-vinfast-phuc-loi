'use strict';

/**
 * One-time script: sync 25 recovered OCR entries from DB → Google Sheets.
 * These were processed by retry-failed-ocr-standalone.js which skipped Sheets sync.
 *
 * Usage: node src/scripts/sync-recovered-to-sheets.js
 */

require('dotenv/config');

const { loadConfig } = require('../config');
const { initSheets } = require('../sheets');
const sheetsSync = require('../sheets-sync');
const logger = require('../logger');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const config = loadConfig();

  await initSheets(config.sheets);
  logger.info('Sheets initialized for recovery sync');

  const supabase = createClient(config.supabase.url, config.supabase.serviceKey, {
    auth: { persistSession: false },
  });

  // Find all reviews that were auto-retried today (have review_note starting with "Auto-retry")
  const { data: reviews, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('review_status', 'Đã xử lý')
    .like('review_note', 'Auto-retry%')
    .order('timestamp', { ascending: true });

  if (error) {
    logger.error('Failed to fetch recovered reviews', { error: error.message });
    process.exit(1);
  }

  console.log(`Found ${reviews.length} recovered entries to sync to Sheets.\n`);

  if (reviews.length === 0) {
    console.log('Nothing to sync.');
    process.exit(0);
  }

  let synced = 0;
  let skipped = 0;

  for (const r of reviews) {
    if (!r.event_id) {
      console.log(`  SKIP ${r.error_id} — no event_id`);
      skipped++;
      continue;
    }

    // Fetch corresponding event
    const { data: event } = await supabase
      .from('events')
      .select('*')
      .eq('event_id', r.event_id)
      .single();

    if (!event) {
      console.log(`  SKIP ${r.error_id} — event not found`);
      skipped++;
      continue;
    }

    const plate = r.plate_ai || event.plate_ai || '';
    const action = event.record_type || '';

    console.log(`  Syncing ${r.error_id} → ${plate} (${action})`);

    // Sync vehicle entry to Sheets based on action
    if (action === 'VAO') {
      sheetsSync.syncVehicleIn({
        vehicleId: event.vehicle_id || '',
        plate,
        timeIn: event.timestamp || '',
        timeOut: '',
        duration: '',
        imageIn: event.image_url || '',
        imageOut: '',
        status: 'Đang trong xưởng',
        priority: 'Bình thường',
        note: 'Recovered from OCR outage',
        updatedAt: r.review_note || '',
      });
    } else if (action === 'RA') {
      // Fetch the matching vehicle record for duration
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('*')
        .eq('plate', plate)
        .eq('status', 'Đã ra xưởng')
        .order('time_out', { ascending: false })
        .limit(1)
        .single();

      if (vehicle) {
        sheetsSync.syncVehicleOut(plate, vehicle.vehicle_id, {
          timeOut: vehicle.time_out || '',
          duration: vehicle.duration ? String(vehicle.duration) : '',
          imageOut: event.image_url || '',
          status: 'Đã ra xưởng',
          note: 'Recovered from OCR outage',
          updatedAt: r.review_note || '',
        });
      }
    }

    synced++;

    // Rate limit: Sheets API has 60 req/min limit
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Synced: ${synced}  Skipped: ${skipped}  Total: ${reviews.length}`);
  console.log(`${'='.repeat(40)}\n`);

  // Give fire-and-forget calls time to complete
  await new Promise(resolve => setTimeout(resolve, 5000));
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
