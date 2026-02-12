'use strict';

const { createLogger, format, transports } = require('winston');

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.json()
  ),
  defaultMeta: { service: 'xuong-vinfast' },
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(({ timestamp, level, message, ...rest }) => {
          const extra = Object.keys(rest).length > 1
            ? ' ' + JSON.stringify(rest, null, 0)
            : '';
          return `${timestamp} [${level}]: ${message}${extra}`;
        })
      ),
    }),
  ],
});

module.exports = logger;
