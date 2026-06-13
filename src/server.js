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
const { trackUsage, dailyUsageLimiter } = require('./middleware/usageTracking');
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
const notificationRoutes = require('./routes/notifications');
const newsletterRoutes = require('./routes/newsletter');
const { generateDailyNewsletter, sendNewsletterToSubscribers } = require('./services/newsletterService');
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
  validate: false,
  message: { error: 'Too many requests, try again later' },
});

function planKeyGenerator(req) {
  if (req.user?.id) {
    const sub = get('SELECT plan FROM subscriptions WHERE user_id = ?', [req.user.id]);
    req.userPlan = sub?.plan || 'free';
  }
  return req.user?.id || req.ip;
}

const agentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: (req) => {
    if (config.isDev) return 30;
    return req.userPlan === 'premium' ? 30 : 5;
  },
  keyGenerator: planKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  message: { error: 'Demasiadas solicitudes al agente. Espera un minuto.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera 15 minutos.' },
  skipSuccessfulRequests: true,
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

app.get('/reset-password', (_req, res) => {
  res.send(`
<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Recuperar Contraseña — CHESS INVEST</title>
<style>body{margin:0;font-family:'DM Sans',Arial,sans-serif;background:#0a0e1a;color:#e8f4f8;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#111827;border:1px solid rgba(0,212,255,0.15);border-radius:16px;padding:32px;width:360px;max-width:90vw}
h2{color:#00d4ff;font-family:'Space Mono',monospace;font-size:16px;margin:0 0 16px;text-align:center}
p{font-size:13px;color:#7a9bb5;margin-bottom:16px;text-align:center}
input{width:100%;padding:10px 14px;background:#1a2235;border:1px solid rgba(0,212,255,0.15);border-radius:8px;color:#e8f4f8;font-size:13px;box-sizing:border-box;outline:none;margin-bottom:12px}
input:focus{border-color:#00d4ff}
.btn{width:100%;padding:10px;background:#00d4ff;color:#000;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif}
.btn:hover{background:#00b8d9}
.btn:disabled{opacity:0.4;cursor:not-allowed}
.msg{padding:12px;border-radius:8px;font-size:12px;text-align:center;display:none}
.msg.ok{background:rgba(0,230,118,0.15);color:#00e676;border:1px solid rgba(0,230,118,0.3);display:block}
.msg.err{background:rgba(255,68,68,0.15);color:#ff4444;border:1px solid rgba(255,68,68,0.3);display:block}
</style></head><body>
<div class="card">
<h2>♔ Recuperar Contraseña</h2>
<div class="msg" id="msg"></div>
<div id="form">
<p>Ingresa tu nueva contraseña</p>
<input type="password" id="pw" placeholder="Nueva contraseña (mín. 6 caracteres)" autocomplete="new-password">
<button class="btn" id="btn" onclick="reset()">Restablecer</button>
</div>
<div id="done" style="display:none;text-align:center;padding:20px">
<div style="font-size:40px;margin-bottom:12px">✅</div>
<p style="color:#00e676">Contraseña restablecida</p>
<a href="/" style="color:#00d4ff;font-size:13px">Ir a CHESS INVEST</a>
</div>
</div>
<script>
const params=new URLSearchParams(location.search);
const token=params.get('token');
if(!token){document.getElementById('form').innerHTML='<p style="color:#ff4444">Enlace inválido o expirado</p>';}
async function reset(){
  const pw=document.getElementById('pw').value;
  if(pw.length<6){document.getElementById('msg').textContent='Mínimo 6 caracteres';document.getElementById('msg').className='msg err';return;}
  const btn=document.getElementById('btn');
  btn.disabled=true;btn.textContent='Restableciendo...';
  try{
    const r=await fetch('/api/auth/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password:pw})});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error);
    document.getElementById('form').style.display='none';
    document.getElementById('done').style.display='block';
  }catch(e){
    document.getElementById('msg').textContent=e.message;
    document.getElementById('msg').className='msg err';
  }
  btn.disabled=false;btn.textContent='Restablecer';
}
</script>
</body></html>`);
});

app.get('/analyzer', (_req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'analyzer.html'));
});

app.get('/admin', (_req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'admin.html'));
});

app.use('/api', aiRoutes);
app.use('/api/markets', marketRoutes);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/analyzer', dailyUsageLimiter, agentLimiter, analyzerRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/stockbroker', dailyUsageLimiter, agentLimiter, stockbrokerRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/newsletter', newsletterRoutes);
app.use('/api', require('./middleware/usageTracking').trackUsage);

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

  const msUntil8am = () => {
    const now = new Date();
    const target = new Date(now);
    target.setHours(8, 0, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target.getTime() - now.getTime();
  };

  setTimeout(() => {
    startJob('daily-newsletter', async () => {
      const result = await generateDailyNewsletter();
      if (result && !result.reused) {
        await sendNewsletterToSubscribers(result.id);
      }
    }, 24 * 60 * 60 * 1000);
  }, msUntil8am());
  logger.info(`Scheduler: "daily-newsletter" will start at 08:00 (in ${Math.round(msUntil8am() / 60000)}min)`);

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
