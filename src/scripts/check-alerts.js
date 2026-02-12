'use strict';

/**
 * Script chạy độc lập (cron) để kiểm tra cảnh báo thời gian lưu.
 * Chạy: node src/scripts/check-alerts.js
 * Cron: */30 * * * * cd /path/to/project && node src/scripts/check-alerts.js
 */

require('dotenv/config');

const { loadConfig } = require('../config');
const { initSheets } = require('../sheets');
const { checkTimeAlerts } = require('../matcher');
const logger = require('../logger');

async function main() {
  const config = loadConfig();
  await initSheets(config.sheets);

  logger.info('Running alert check...');
  const updated = await checkTimeAlerts(config);
  logger.info(`Alert check complete: ${updated} vehicles updated`);
  process.exit(0);
}

main().catch(err => {
  logger.error('Alert check failed', { error: err.message });
  process.exit(1);
});
