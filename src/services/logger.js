const winston = require('winston');
const path = require('path');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack }) =>
      `${timestamp} [${level.toUpperCase()}] ${message}${stack ? '\n' + stack : ''}`
    )
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, stack }) =>
          `${timestamp} [${level}] ${message}${stack ? '\n' + stack : ''}`
        )
      ),
    }),
    new winston.transports.File({
      filename: path.resolve(__dirname, '../../server.log'),
      level: 'info',
    }),
    new winston.transports.File({
      filename: path.resolve(__dirname, '../../server.err'),
      level: 'error',
    }),
  ],
});

module.exports = logger;
