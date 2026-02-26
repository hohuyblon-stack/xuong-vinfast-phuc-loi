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

  logger.info('Dang kiem tra canh bao...');
  const updated = await checkTimeAlerts(config);
  logger.info(`Kiem tra canh bao hoan thanh: cap nhat ${updated} xe`);
  process.exit(0);
}

main().catch(err => {
  logger.error('Kiem tra canh bao that bai', { error: err.message });
  process.exit(1);
});
