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
const { checkPriceAlerts } = require('./services/alertChecker');
const { startWebSocket } = require('./services/webSocketService');
const { getSubscription } = require('./services/supabaseDb');
const { testConnection } = require('./services/supabase');

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
// Stripe necesita el body RAW para verificar la firma: excluir el webhook del json parser.
// (Si express.json() consume el body antes, constructEvent falla siempre con 400.)
app.use((req, res, next) => {
  if (req.originalUrl === '/api/subscription/webhook') return next();
  express.json({ limit: '1mb' })(req, res, next);
});
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

async function planKeyGenerator(req) {
  if (req.user?.id) {
    try {
      const sub = await getSubscription(req.user.id);
      req.userPlan = sub?.plan || 'free';
    } catch {
      req.userPlan = 'free';
    }
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

// index.html es un fragmento sin <head>: envolverlo para título + favicon + viewport.
// (Sin esto la pestaña muestra la bola gris y falta el viewport en móvil.)
// Va ANTES de express.static o el static serviría el fragmento crudo.
app.get('/', (_req, res) => {
  const frag = fs.readFileSync(path.resolve(__dirname, 'public', 'index.html'), 'utf8');
  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>♔ CHESS INVEST — Mercados, IA y Cartera</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><meta name="theme-color" content="#0a0e1a"></head><body>${frag}</body></html>`);
});

app.use(express.static(path.resolve(__dirname, 'public')));

// Fallback para navegadores que piden /favicon.ico automáticamente
app.get('/favicon.ico', (_req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'favicon.svg'));
});

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

app.get('/newsletter', (_req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'newsletter.html'));
});

app.get('/screener', (_req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'screener.html'));
});

app.get('/recursos', (_req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'recursos.html'));
});

app.get('/reset-password', (_req, res) => {
  res.send(`
<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Recuperar Contraseña — CHESS INVEST</title>
<style>body{margin:0;font-family:'DM Sans',Arial,sans-serif;background:#0a0e1a;color:#e8f4f8;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#111827;border:1px solid rgba(0,212,255,0.15);border-radius:16px;padding:32px;width:380px;max-width:90vw}
h2{color:#00d4ff;font-family:'Space Mono',monospace;font-size:16px;margin:0 0 16px;text-align:center}
p{font-size:13px;color:#7a9bb5;margin-bottom:16px;text-align:center;line-height:1.6}
input{width:100%;padding:10px 14px;background:#1a2235;border:1px solid rgba(0,212,255,0.15);border-radius:8px;color:#e8f4f8;font-size:13px;box-sizing:border-box;outline:none;margin-bottom:12px}
input:focus{border-color:#00d4ff}
.btn{width:100%;padding:10px;background:#00d4ff;color:#000;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;display:block;text-align:center;text-decoration:none;box-sizing:border-box}
.btn:hover{background:#00b8d9}
.btn:disabled{opacity:0.4;cursor:not-allowed}
.msg{padding:12px;border-radius:8px;font-size:12px;text-align:center;display:none;margin-bottom:12px}
.msg.ok{background:rgba(0,230,118,0.15);color:#00e676;border:1px solid rgba(0,230,118,0.3);display:block}
.msg.err{background:rgba(255,68,68,0.15);color:#ff4444;border:1px solid rgba(255,68,68,0.3);display:block}
.link{color:#00d4ff;font-size:13px;text-decoration:none}
</style></head><body>
<div class="card">
<h2>♔ Recuperar Contraseña</h2>
<div class="msg" id="msg"></div>
<div id="form" style="display:none">
<p>Ingresa tu nueva contraseña</p>
<input type="password" id="pw" placeholder="Nueva contraseña (mín. 6 caracteres)" autocomplete="new-password">
<button class="btn" id="btn" onclick="reset()">Restablecer</button>
</div>
<div id="resend" style="display:none">
<p>El enlace es inválido o ha expirado. Escribe tu email y te enviamos uno nuevo.</p>
<input type="email" id="remail" placeholder="tu@email.com" autocomplete="email">
<button class="btn" id="rbtn" onclick="resend()">Enviar nuevo enlace</button>
<p style="margin-top:12px"><a class="link" href="/">← Volver a CHESS INVEST</a></p>
</div>
<div id="done" style="display:none;text-align:center;padding:20px">
<div style="font-size:40px;margin-bottom:12px">✅</div>
<p style="color:#00e676">Contraseña restablecida. Ya puedes entrar con tu nueva contraseña.</p>
<a href="/" class="btn">Ir a CHESS INVEST</a>
</div>
</div>
<script>
function parseHash(){
  const h=(location.hash||'').replace(/^#/,'');
  const out={};
  h.split('&').forEach(function(p){var kv=p.split('=');if(kv[0])out[kv[0]]=decodeURIComponent(kv[1]||'');});
  return out;
}
var session=null;
(function init(){
  var q=parseHash();
  if(q.error||q.error_description){
    showResend('Enlace inválido: '+(q.error_description||q.error));
    return;
  }
  if(q.access_token&&(q.type==='recovery'||!q.type)){
    session={access_token:q.access_token,refresh_token:q.refresh_token||null};
    history.replaceState(null,'',location.pathname);
    document.getElementById('form').style.display='block';
  }else{
    showResend(null);
  }
})();
function showMsg(t,cls){var m=document.getElementById('msg');m.textContent=t;m.className='msg '+cls;}
function showResend(t){
  if(t)showMsg(t,'err');
  document.getElementById('form').style.display='none';
  document.getElementById('resend').style.display='block';
}
async function reset(){
  var pw=document.getElementById('pw').value;
  if(!session){showMsg('Sesión de recuperación no válida. Pide un nuevo enlace.','err');showResend(null);return;}
  if(!pw||pw.length<6){showMsg('Mínimo 6 caracteres','err');return;}
  var btn=document.getElementById('btn');
  btn.disabled=true;btn.textContent='Restableciendo...';
  try{
    var r=await fetch('/api/auth/reset-password',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},body:JSON.stringify({password:pw})});
    var d=await r.json().catch(function(){return {};});
    if(!r.ok)throw new Error(d.error||'No se pudo restablecer');
    document.getElementById('form').style.display='none';
    document.getElementById('done').style.display='block';
    showMsg('','');document.getElementById('msg').style.display='none';
  }catch(e){
    showMsg(e.message,'err');
  }
  btn.disabled=false;btn.textContent='Restablecer';
}
async function resend(){
  var email=document.getElementById('remail').value.trim();
  if(!email){showMsg('Escribe tu email','err');return;}
  var btn=document.getElementById('rbtn');
  btn.disabled=true;btn.textContent='Enviando...';
  try{
    var r=await fetch('/api/auth/forgot-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email})});
    await r.json().catch(function(){return {};});
    showMsg('Si el email existe, recibirás un enlace válido 1 hora.','ok');
  }catch(e){
    showMsg('Error de conexión. Inténtalo de nuevo.','err');
  }
  btn.disabled=false;btn.textContent='Enviar nuevo enlace';
}
</script>
</body></html>`);
});

app.get('/auth/callback', (_req, res) => {
  const SUPABASE_URL = config.supabase.url || '';
  const SUPABASE_ANON = config.supabase.anonKey || '';
  res.send(`
<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Verificando sesión — CHESS INVEST</title>
<style>body{margin:0;font-family:'DM Sans',Arial,sans-serif;background:#0a0e1a;color:#e8f4f8;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#111827;border:1px solid rgba(0,212,255,0.15);border-radius:16px;padding:32px;width:380px;max-width:90vw;text-align:center}
h2{color:#00d4ff;font-family:'Space Mono',monospace;font-size:15px;margin:0 0 12px}
p{font-size:13px;color:#7a9bb5;line-height:1.6}
.spin{width:26px;height:26px;border:2px solid rgba(0,212,255,0.2);border-top-color:#00d4ff;border-radius:50%;animation:sp .8s linear infinite;margin:12px auto}
@keyframes sp{to{transform:rotate(360deg)}}
.err{color:#ff4444;font-size:13px}
a.btn{display:block;margin-top:14px;padding:10px;background:#00d4ff;color:#000;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none}
</style></head><body>
<div class="card">
<h2>♔ CHESS INVEST</h2>
<div id="box"><div class="spin"></div><p>Verificando tu sesión...</p></div>
</div>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script>
var SUPABASE_URL=${JSON.stringify(SUPABASE_URL)};
var SUPABASE_ANON=${JSON.stringify(SUPABASE_ANON)};
function fail(msg){
  document.getElementById('box').innerHTML='<p class="err">'+msg+'</p><a class="btn" href="/">Ir a CHESS INVEST</a>';
}
function safeNext(){
  try{
    var n=new URLSearchParams(location.search).get('next');
    if(n&&n.charAt(0)==='/'&&n.charAt(1)!=='/'&&n.charAt(1)!=='\\\\')return n;
  }catch(e){}
  return '/';
}
function storeAndGo(access,refresh){
  try{
    localStorage.setItem('chessinvest_token',access);
    if(refresh)localStorage.setItem('chessinvest_refresh',refresh);
  }catch(e){}
  location.replace(safeNext());
}
function parseHash(){
  var h=(location.hash||'').replace(/^#/,'');
  var out={};
  h.split('&').forEach(function(p){var kv=p.split('=');if(kv[0])out[kv[0]]=decodeURIComponent(kv[1]||'');});
  return out;
}
(async function(){
  var qs=new URLSearchParams(location.search);
  var hash=parseHash();
  if(hash.error||qs.get('error')){
    fail('Enlace inválido o caducado: '+(hash.error_description||qs.get('error_description')||'solicita uno nuevo.'));
    return;
  }
  // Recovery -> la página de reset gestiona el token
  if(hash.access_token&&hash.type==='recovery'){
    location.replace('/reset-password#'+(location.hash||'').replace(/^#/,''));
    return;
  }
  // Sesión directa en el hash (invite, signup, magiclink, oauth implícito)
  if(hash.access_token){
    storeAndGo(hash.access_token,hash.refresh_token||null);
    return;
  }
  // Flujo PKCE (?code=...) — requiere supabase-js
  var code=qs.get('code');
  if(code){
    if(!window.supabase||!SUPABASE_URL||!SUPABASE_ANON){fail('No se pudo completar el inicio de sesión. Entra manualmente.');return;}
    try{
      var client=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON);
      var r=await client.auth.exchangeCodeForSession(code);
      if(r.error)throw r.error;
      var s=r.data&&r.data.session;
      if(!s||!s.access_token)throw new Error('sin sesión');
      storeAndGo(s.access_token,s.refresh_token||null);
    }catch(e){fail('No se pudo completar el inicio de sesión: '+e.message);}
    return;
  }
  fail('No hay sesión que verificar. Entra manualmente.');
})();
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
app.use('/api/screener', require('./routes/screener'));
app.use('/api/resources', require('./routes/resources'));
app.use('/api', trackUsage);

// Test endpoint
app.get('/api/test', (_req, res) => {
  res.json({ ok: true, routes: ['/api/markets', '/api/auth', '/api/portfolio', '/api/analyzer', '/api/subscription', '/api/profile', '/api/analytics'] });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/status', async (_req, res) => {
  const dbTest = await testConnection();
  res.json({
    app: 'CHESSINVEST',
    version: require('../package.json').version,
    uptime: process.uptime(),
    node: process.version,
    env: config.nodeEnv,
    memory: process.memoryUsage(),
    hasAI: Boolean(config.openRouter.apiKey || config.anthropic.apiKey),
    hasDB: dbTest.ok,
    db: dbTest.ok ? 'Supabase (PostgreSQL)' : 'Disconnected',
    freeModel: require('./services/modelRouter').peekBestFreeModel() || null,
    commit: String(process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7),
  });
});

// One-time admin seed endpoint (kept for manual trigger if needed)
app.get('/api/seed-admin', async (_req, res) => {
  res.json({ status: 'admin users managed in Supabase Auth + profiles table', email: 'ajedrezpremium@gmail.com' });
});

app.use(notFoundHandler);
app.use(errorHandler);

const sslKey = process.env.SSL_KEY_PATH;
const sslCert = process.env.SSL_CERT_PATH;

async function startServer() {
  try {
    // Test Supabase connection
    const dbTest = await testConnection();
    if (dbTest.ok) {
      logger.info('Supabase (PostgreSQL) connected');
    } else {
      logger.error(`Supabase connection failed: ${dbTest.error}`);
    }

    // Scheduler jobs (these run in-process on Render; for Vercel they'd need separate worker)
    startJob('market-data-update', getAllIndices, 15 * 60 * 1000);
    startJob('price-alert-checker', checkPriceAlerts, 5 * 60 * 1000);
    startJob('telegram-poll', require('./services/telegramService').pollTelegramUpdates, 2 * 60 * 1000);
    startJob('fundamentals-scan', require('./services/fundamentalsService').scanFundamentals, 24 * 60 * 60 * 1000);

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
  } catch (err) {
    logger.error(`Fatal startup error: ${err.message}`);
    process.exit(1);
  }
}

startServer().catch((err) => {
  logger.error(`Fatal startup error: ${err.message}`);
  process.exit(1);
});