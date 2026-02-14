'use strict';

require('dotenv/config');

const { loadConfig } = require('../config');
const { initSheets } = require('../sheets');
const { initTelegram } = require('../telegram');
const { checkTimeAlerts } = require('../matcher');
const logger = require('../logger');

async function main() {
  const config = loadConfig();
  await initSheets(config.sheets);
  initTelegram(config.telegram.botToken);

  logger.info('Running alert check...');
  const updated = await checkTimeAlerts(config);
  logger.info(`Alert check complete: ${updated} vehicles updated`);
  process.exit(0);
}

main().catch(err => {
  logger.error('Alert check failed', { error: err.message });
  process.exit(1);
});
