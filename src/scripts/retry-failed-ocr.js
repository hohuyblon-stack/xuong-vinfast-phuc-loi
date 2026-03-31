'use strict';

/**
 * Retry all failed OCR events from the Poe API 403 outage (2026-03-31).
 *
 * What it does:
 * 1. Finds all reviews with status 'Chưa xử lý' from today
 * 2. Re-downloads each image from Telegram
 * 3. Runs OCR via Poe API
 * 4. If plate detected → processes the vehicle event (VAO/RA)
 * 5. Updates the review + event records
 *
 * Usage: node src/scripts/retry-failed-ocr.js
 */

require('dotenv/config');

const { loadConfig } = require('../config');
const { initOcr, recognizePlate } = require('../ocr');
const { initDb, processVehicleDecision, updateEventResult, insertReview } = require('../db');
const { initSheets } = require('../sheets');
const { initTelegram, sendMessage } = require('../telegram');
const sheetsSync = require('../sheets-sync');
const utils = require('../utils');
const logger = require('../logger');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const config = loadConfig();

  // Init services
  initDb(config);
  initOcr(config.ocr);
  initTelegram(config.telegram.botToken);

  try {
    await initSheets(config.sheets);
  } catch (e) {
    logger.warn('Sheets init failed, continuing without sheets sync', { error: e.message });
  }

  const supabase = createClient(config.supabase.url, config.supabase.serviceKey, {
    auth: { persistSession: false },
  });

  // Find all unresolved reviews from today
  const todayStart = new Date('2026-03-31T00:00:00Z').toISOString();
  const { data: reviews, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('review_status', 'Chưa xử lý')
    .gte('timestamp', todayStart)
    .order('timestamp', { ascending: true });

  if (error) {
    logger.error('Failed to fetch reviews', { error: error.message });
    process.exit(1);
  }

  console.log(`\nFound ${reviews.length} failed OCR entries to retry.\n`);

  let success = 0;
  let stillFailed = 0;
  let skipped = 0;

  for (const review of reviews) {
    const imageUrl = review.image_url;
    const eventId = review.event_id;
    const errorId = review.error_id;

    if (!imageUrl) {
      console.log(`  SKIP ${errorId} — no image URL`);
      skipped++;
      continue;
    }

    console.log(`  Retrying ${errorId} → ${imageUrl.split('/').pop()}`);

    try {
      const ocrResult = await recognizePlate(imageUrl);

      if (!ocrResult.plateText) {
        console.log(`    ✗ Still no plate detected`);
        stillFailed++;
        continue;
      }

      const plate = ocrResult.plateText;
      const confidence = ocrResult.confidence;
      const vehicleModel = ocrResult.vehicleModel || '';
      const confLabel = utils.confidenceLabel(confidence, config.ocr);

      console.log(`    ✓ Plate: ${plate} (${(confidence * 100).toFixed(0)}%) Model: ${vehicleModel || 'N/A'}`);

      // Check if plate is valid format
      if (!utils.isValidVietnamPlate(plate)) {
        console.log(`    ✗ Invalid plate format, marking for manual review`);
        await supabase.from('reviews')
          .update({ plate_ai: plate, reason: 'Retry: Bien so sai format', review_note: `Auto-retry ${new Date().toISOString()}` })
          .eq('error_id', errorId);
        stillFailed++;
        continue;
      }

      // High confidence → process vehicle event
      if (confidence >= config.ocr.confidenceMedium) {
        const tz = config.timezone;
        const vehicleId = utils.generateVehicleId(tz);
        const nowIso = new Date().toISOString();

        try {
          const decision = await processVehicleDecision(
            plate, vehicleId, nowIso, imageUrl,
            config.alerts.minWorkshopMinutes * 60,
            vehicleModel,
          );

          const action = decision.action;
          console.log(`    ✓ Processed: ${action} — ${plate}`);

          // Update event record
          await updateEventResult(eventId, `Retry OK: ${action}`);

          // Mark review as resolved
          await supabase.from('reviews')
            .update({
              review_status: 'Đã xử lý',
              plate_ai: plate,
              review_note: `Auto-retry success: ${action} at ${new Date().toISOString()}`,
            })
            .eq('error_id', errorId);

          // Update event record type
          await supabase.from('events')
            .update({ plate_ai: plate, record_type: action, confidence_label: confLabel })
            .eq('event_id', eventId);

          // Sync to sheets
          sheetsSync.syncLogResult(eventId, `Retry OK: ${action}`);

          success++;
        } catch (rpcErr) {
          console.log(`    ✗ RPC failed: ${rpcErr.message}`);
          stillFailed++;
        }
      } else {
        // Low confidence - update review with detected plate for manual check
        await supabase.from('reviews')
          .update({ plate_ai: plate, reason: 'Retry: OCR confidence thap', review_note: `Auto-retry ${new Date().toISOString()}` })
          .eq('error_id', errorId);
        console.log(`    ~ Low confidence, updated for manual review`);
        stillFailed++;
      }
    } catch (err) {
      console.log(`    ✗ Error: ${err.message}`);
      stillFailed++;
    }

    // Small delay between requests to avoid Poe rate limiting
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results:`);
  console.log(`  ✓ Success:      ${success}`);
  console.log(`  ✗ Still failed: ${stillFailed}`);
  console.log(`  ⊘ Skipped:      ${skipped}`);
  console.log(`  Total:          ${reviews.length}`);
  console.log(`${'='.repeat(50)}\n`);

  // Notify manager
  if (success > 0 && config.manager.chatIds.length > 0) {
    const msg = `🔄 Đã khôi phục ${success}/${reviews.length} ảnh bị lỗi OCR hôm nay.\n` +
      `Còn ${stillFailed} ảnh cần kiểm tra thủ công.`;
    for (const chatId of config.manager.chatIds) {
      try {
        await sendMessage(chatId, msg);
      } catch (e) {
        logger.warn('Failed to notify manager', { chatId, error: e.message });
      }
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
