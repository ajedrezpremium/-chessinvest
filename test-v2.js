const http = require('http');
const { spawn } = require('child_process');

const server = spawn('node', ['src/server.js'], { cwd: __dirname, stdio: 'pipe' });
server.stdout.on('data', (d) => console.log('[SRV]', d.toString().trim().split('\n').pop()));
server.stderr.on('data', (d) => console.log('[SRV-ERR]', d.toString().trim().split('\n').pop()));

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost', port: 3000, path, method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);
    if (token) options.headers.Authorization = 'Bearer ' + token;
    const r = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

(async () => {
  require('dotenv').config({ path: __dirname + '/.env' });
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error('✋ ADMIN_EMAIL/ADMIN_PASSWORD no configurados en .env (no se detalla el admin en el repo)');
    server.kill();
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 3500));
  const results = [];
  const check = (name, cond, extra = '') => {
    results.push({ name, ok: !!cond });
    console.log(`${cond ? '✅' : '❌'} ${name} ${extra}`);
  };

  try {
    let r = await req('GET', '/api/status');
    const status = JSON.parse(r.body);
    check('GET /api/status (hasDB Supabase)', r.status === 200 && status.hasDB === true, `db=${status.db}`);

    r = await req('GET', '/api/markets/flat');
    const markets = JSON.parse(r.body);
    check('GET /api/markets/flat', r.status === 200 && Array.isArray(markets.markets) && markets.markets.length > 0, `n=${markets.markets?.length}`);

    r = await req('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const login = JSON.parse(r.body);
    check('POST /api/auth/login (admin)', r.status === 200 && !!login.token, `plan=${login.user?.plan}`);
    const token = login.token;

    r = await req('GET', '/api/auth/me', null, token);
    check('GET /api/auth/me (JWT Supabase válido)', r.status === 200 && JSON.parse(r.body).role === 'admin');

    r = await req('GET', '/api/portfolio/portfolio', null, token);
    check('GET /api/portfolio/portfolio', r.status === 200);

    r = await req('GET', '/api/profile/summary', null, token);
    const summary = JSON.parse(r.body);
    check('GET /api/profile/summary', r.status === 200 && !!summary.user);

    r = await req('GET', '/api/admin/stats', null, token);
    const stats = JSON.parse(r.body);
    check('GET /api/admin/stats (admin)', r.status === 200 && typeof stats.totalUsers === 'number', `users=${stats.totalUsers}`);

    r = await req('GET', '/api/notifications', null, token);
    check('GET /api/notifications', r.status === 200);

    r = await req('GET', '/api/subscription/status', null, token);
    check('GET /api/subscription/status', r.status === 200);

    r = await req('GET', '/api/portfolio/portfolio');
    check('GET /api/portfolio/portfolio sin token → 401', r.status === 401);

    r = await req('GET', '/api/admin/stats', null, 'invalid-token');
    check('GET /api/admin/stats token inválido → 401/403', r.status === 401 || r.status === 403);
  } catch (e) {
    console.log('❌ ERROR:', e.message);
  }

  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} tests OK`);
  server.kill();
  process.exit(failed.length ? 1 : 0);
})();

setTimeout(() => { console.log('TIMEOUT'); server.kill(); process.exit(1); }, 45000);
