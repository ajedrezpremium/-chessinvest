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
const { requestLogger, responseLogger } = require('./services/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const aiRoutes = require('./routes/ai');
const marketRoutes = require('./routes/market');
const authRoutes = require('./routes/auth');
const portfolioRoutes = require('./routes/portfolio');
const analyzerRoutes = require('./routes/analyzer');
const subscriptionRoutes = require('./routes/subscription');
const profileRoutes = require('./routes/profile');
const analyticsRoutes = require('./routes/analytics');
const adminRoutes = require('./routes/admin');
const stockbrokerRoutes = require('./routes/stockbroker');
const { startJob, stopAll } = require('./services/scheduler');
const { getAllIndices } = require('./services/marketDataService');
const { openDb, initSchema, closeDb, run, get, saveDb } = require('./services/database');
const { hashPassword } = require('./services/auth');
const { checkPriceAlerts } = require('./services/alertChecker');
const { startWebSocket } = require('./services/webSocketService');

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(requestLogger);
app.use(responseLogger);

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.isDev ? 120 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, try again later' },
});

const agentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.isDev ? 30 : 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes al agente. Espera un minuto.' },
});

app.use(limiter);

app.use(express.static(path.resolve(__dirname, 'public')));

app.get('/chessinvestai', (_req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'chessinvestai.html'));
});

app.get('/stockbroker', (_req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'stockbroker.html'));
});

app.get('/pricing', (_req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'pricing.html'));
});

app.get('/profile', (_req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'profile.html'));
});

app.get('/analyzer', (_req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'analyzer.html'));
});

app.get('/admin', (_req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'admin.html'));
});

app.use('/api', aiRoutes);
app.use('/api/markets', marketRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/analyzer', agentLimiter, analyzerRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/stockbroker', agentLimiter, stockbrokerRoutes);

// Test endpoint
app.get('/api/test', (_req, res) => {
  res.json({ ok: true, routes: ['/api/markets', '/api/auth', '/api/portfolio', '/api/analyzer', '/api/subscription', '/api/profile', '/api/analytics'] });
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

// One-time admin seed endpoint (kept for manual trigger if needed)
app.get('/api/seed-admin', async (_req, res) => {
  res.json({ status: 'admin is auto-seeded on startup', email: 'ajedrezpremium@gmail.com', password: 'Chess2026#' });
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

    // Auto-seed admin on every startup (idempotent)
    try {
      const adminEmail = 'ajedrezpremium@gmail.com';
      const existing = get('SELECT id, role FROM users WHERE email = ?', [adminEmail]);
      if (!existing) {
        const hash = hashPassword('Chess2026#');
        const result = run(
          "INSERT INTO users (email, username, password_hash, role, avatar) VALUES (?, ?, ?, 'admin', '👑')",
          [adminEmail, 'Admin', hash],
        );
        run('INSERT INTO subscriptions (user_id, plan, status) VALUES (?, ?, ?)', [result.lastID, 'premium', 'active']);
        run('INSERT INTO user_settings (user_id) VALUES (?)', [result.lastID]);
        saveDb();
        logger.info('Admin user auto-seeded: ajedrezpremium@gmail.com');
      } else if (existing.role !== 'admin') {
        run("UPDATE users SET role = 'admin', avatar = '👑' WHERE email = ?", [adminEmail]);
        run("UPDATE subscriptions SET plan = 'premium', status = 'active' WHERE user_id = ?", [existing.id]);
        saveDb();
        logger.info('Admin role restored for: ajedrezpremium@gmail.com');
      }
    } catch (err) {
      logger.error(`Admin seed failed: ${err.message}`);
    }

    // Auto-seed collaborator admin (idempotent)
    try {
      const collabEmail = 'carlosguerra@gmail.com';
      const collabUsername = 'xadreztomiño';
      const collabExisting = get('SELECT id, role FROM users WHERE email = ?', [collabEmail]);
      if (!collabExisting) {
        const hash = hashPassword('Chess2026#');
        const result = run(
          "INSERT INTO users (email, username, password_hash, role, avatar) VALUES (?, ?, ?, 'admin', '♔')",
          [collabEmail, collabUsername, hash],
        );
        run('INSERT INTO subscriptions (user_id, plan, status) VALUES (?, ?, ?)', [result.lastID, 'premium', 'active']);
        run('INSERT INTO user_settings (user_id) VALUES (?)', [result.lastID]);
        saveDb();
        logger.info('Collaborator admin auto-seeded: carlosguerra@gmail.com');
      } else if (collabExisting.role !== 'admin') {
        run("UPDATE users SET role = 'admin', avatar = '♔' WHERE email = ?", [collabEmail]);
        run("UPDATE subscriptions SET plan = 'premium', status = 'active' WHERE user_id = ?", [collabExisting.id]);
        saveDb();
        logger.info('Collaborator admin role restored: carlosguerra@gmail.com');
      }
    } catch (err) {
      logger.error(`Collaborator admin seed failed: ${err.message}`);
    }
  } catch (err) {
    logger.error(`Database init failed: ${err.message}. Continuing without persistence.`);
  }

  startJob('market-data-update', getAllIndices, 15 * 60 * 1000);
  startJob('price-alert-checker', checkPriceAlerts, 5 * 60 * 1000);

  let server;

  if (sslKey && sslCert && fs.existsSync(sslKey) && fs.existsSync(sslCert)) {
    const credentials = { key: fs.readFileSync(sslKey), cert: fs.readFileSync(sslCert) };
    server = https.createServer(credentials, app);
    server.listen(config.port, config.host, () => {
      logger.info(`CHESSINVEST running at https://${config.host}:${config.port}`);
    });
    startWebSocket(server);
  } else {
    server = http.createServer(app);
    server.listen(config.port, config.host, () => {
      logger.info(`CHESSINVEST running at http://${config.host}:${config.port}`);
    });
    startWebSocket(server);
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
