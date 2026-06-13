const winston = require('winston');
const path = require('path');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack, requestId, duration, ...meta }) => {
      const parts = [timestamp, `[${level.toUpperCase()}]`];
      if (requestId) parts.push(`[${requestId}]`);
      if (duration) parts.push(`(${duration}ms)`);
      parts.push(message);
      if (Object.keys(meta).length > 0 && meta.service) parts.push(JSON.stringify(meta));
      return parts.join(' ') + (stack ? '\n' + stack : '');
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, stack, requestId, duration }) => {
          const parts = [timestamp, `[${level}]`];
          if (requestId) parts.push(`[${requestId}]`);
          if (duration) parts.push(`(${duration}ms)`);
          parts.push(message);
          return parts.join(' ') + (stack ? '\n' + stack : '');
        })
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

function requestLogger(req, _res, next) {
  req.requestId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  req._startTime = Date.now();
  logger.info(`${req.method} ${req.path}`, { requestId: req.requestId, service: 'http' });
  next();
}

function responseLogger(req, res, next) {
  const originalEnd = res.end;
  res.end = function(...args) {
    const duration = Date.now() - (req._startTime || Date.now());
    const level = res.statusCode >= 400 ? 'warn' : res.statusCode >= 500 ? 'error' : 'info';
    logger[level](`${req.method} ${req.path} → ${res.statusCode}`, { requestId: req.requestId, duration, service: 'http' });
    originalEnd.apply(res, args);
  };
  next();
}

module.exports = logger;
module.exports.requestLogger = requestLogger;
module.exports.responseLogger = responseLogger;
