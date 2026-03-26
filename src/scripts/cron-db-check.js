'use strict';

// This script is intended to be run by a cron job.
// It checks the Supabase DB health and reports key metrics.

require('dotenv/config');
const fs = require('fs/promises');
const path = require('path');
const { loadConfig } = require('../config');
const { initDb, testConnection, countInWorkshop, getPendingReviews } = require('../db');
const logger = require('../logger');

const LOG_FILE = path.join(__dirname, '../../alerts.log');

async function main() {
  let inWorkshop = -1;
  let pendingReviews = -1;
  let connectionOk = false;

  try {
    const config = loadConfig();
    initDb(config);

    // 1. Test Connection
    await testConnection();
    connectionOk = true;

    // 2. Count vehicles in workshop
    inWorkshop = await countInWorkshop();

    // 3. Count pending reviews
    const reviewData = await getPendingReviews();
    pendingReviews = reviewData.count;

    // --- Success ---
    const summary = `Kiểm tra Supabase OK. Xe trong xưởng: ${inWorkshop}. Cần review: ${pendingReviews}.`;
    console.log(summary);

    const logEntry = `[${new Date().toISOString()}] [OK] Supabase check successful. InWorkshop=${inWorkshop}, PendingReviews=${pendingReviews}\n`;
    await fs.appendFile(LOG_FILE, logEntry);

  } catch (error) {
    // --- Failure ---
    logger.error('Supabase cron check failed', { error: error.message, stack: error.stack });
    
    let status = 'CRITICAL';
    let reason = error.message;

    if (!connectionOk) {
        reason = 'Connection test failed.';
    }

    const summary = `CRITICAL: Kiểm tra Supabase thất bại. Lý do: ${reason}`;
    console.log(summary);
    
    const logEntry = `[${new Date().toISOString()}] [${status}] Supabase check failed. Reason: ${reason}\n`;
    await fs.appendFile(LOG_FILE, logEntry);
  }
}

main().catch(err => {
  // This catch is a fallback in case the main function's own catch fails.
  console.error('CRITICAL: Unhandled error in cron-db-check script.', err);
  process.exit(1);
});
