const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');

const config = require('./config');
const logger = require('./services/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const aiRoutes = require('./routes/ai');
const marketRoutes = require('./routes/market');
const authRoutes = require('./routes/auth');
const portfolioRoutes = require('./routes/portfolio');
const analyzerRoutes = require('./routes/analyzer');
const { startJob, stopAll } = require('./services/scheduler');
const { getAllIndices } = require('./services/marketDataService');
const { openDb, initSchema, closeDb } = require('./services/database');

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.isDev ? 120 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, try again later' },
});
app.use(limiter);

app.use(express.static(path.resolve(__dirname, 'public')));

app.get('/chessinvestai', (_req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'chessinvestai.html'));
});

app.use('/api', aiRoutes);
app.use('/api/markets', marketRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/analyzer', analyzerRoutes);

// Test endpoint
app.get('/api/test', (_req, res) => {
  res.json({ ok: true, routes: ['/api/markets', '/api/auth', '/api/portfolio', '/api/analyzer'] });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/status', (_req, res) => {
  res.json({
    app: 'CHESSINVEST',
    version: require('../package.json').version,
    uptime: process.uptime(),
    node: process.version,
    env: config.nodeEnv,
    memory: process.memoryUsage(),
    hasAI: Boolean(config.openRouter.apiKey || config.anthropic.apiKey),
    hasDB: true,
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

const sslKey = process.env.SSL_KEY_PATH;
const sslCert = process.env.SSL_CERT_PATH;

async function startServer() {
  try {
    await openDb();
    await initSchema();
    logger.info('Database ready');
  } catch (err) {
    logger.error(`Database init failed: ${err.message}. Continuing without persistence.`);
  }

  startJob('market-data-update', getAllIndices, 15 * 60 * 1000);

  let server;

  if (sslKey && sslCert && fs.existsSync(sslKey) && fs.existsSync(sslCert)) {
    const credentials = { key: fs.readFileSync(sslKey), cert: fs.readFileSync(sslCert) };
    server = https.createServer(credentials, app);
    server.listen(config.port, config.host, () => {
      logger.info(`CHESSINVEST running at https://${config.host}:${config.port}`);
    });
  } else {
    server = http.createServer(app);
    server.listen(config.port, config.host, () => {
      logger.info(`CHESSINVEST running at http://${config.host}:${config.port}`);
    });
    if (sslKey || sslCert) {
      logger.warn('SSL configured but certificate files not found — falling back to HTTP');
    }
  }

  if (!config.openRouter.apiKey && !config.anthropic.apiKey) {
    logger.warn('No API key configured — AI features will use mock data');
  }

  function gracefulShutdown(signal) {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(() => {
      stopAll();
      closeDb();
      logger.info('Server shut down');
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000).unref();
  }

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception: ${err.message}`, { stack: err.stack });
    gracefulShutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled rejection: ${reason}`);
  });
}

startServer().catch((err) => {
  logger.error(`Fatal startup error: ${err.message}`);
  process.exit(1);
});
