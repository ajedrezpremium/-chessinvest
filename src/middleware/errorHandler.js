const logger = require('../services/logger');

function errorHandler(err, req, res, _next) {
  logger.error(`${req.method} ${req.url} — ${err.message}`, { stack: err.stack });

  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not found' });
}

module.exports = { errorHandler, notFoundHandler };
