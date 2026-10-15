require('dotenv').config({ path: '.env' });
const http = require('http');
const { spawn } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

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
  await new Promise((r) => setTimeout(r, 3500));
  const results = [];
  const check = (name, cond, extra = '') => {
    results.push(!!cond);
    console.log(`${cond ? '✅' : '❌'} ${name} ${extra}`);
  };
  const EMAIL = 'newuser456@gmail.com';

  try {
    let r = await req('GET', '/reset-password');
    check('GET /reset-password 200 (nueva página)', r.status === 200 && r.body.includes('access_token') && !r.body.includes("params.get('token')"));

    r = await req('GET', '/auth/callback');
    check('GET /auth/callback 200', r.status === 200 && r.body.includes('exchangeCodeForSession'));

    r = await req('POST', '/api/auth/forgot-password', { email: EMAIL });
    check('POST /api/auth/forgot-password ok', r.status === 200 && JSON.parse(r.body).ok === true);

    // Simular clic en el email: generar link de recovery y verificar OTP como haría el navegador
    const admin = createClient(process.env.SUPABASE_PROJECT_URL, process.env.SUPABASE_SERVICE_ROLE, { auth: { persistSession: false } });
    const anon = createClient(process.env.SUPABASE_PROJECT_URL, process.env.SUPABASE_ANON_PUBLIC, { auth: { persistSession: false } });

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({ type: 'recovery', email: EMAIL });
    check('generateLink recovery', !linkErr && !!linkData?.properties?.hashed_token, linkErr?.message || '');
    const tokenHash = linkData.properties.hashed_token;

    const { data: otpData, error: otpErr } = await anon.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
    check('verifyOtp recovery (simula apertura del email)', !otpErr && !!otpData?.session?.access_token, otpErr?.message || '');
    const recoveryToken = otpData.session.access_token;

    r = await req('POST', '/api/auth/reset-password', { password: 'NewPass123' }, recoveryToken);
    check('POST /api/auth/reset-password con Bearer recovery', r.status === 200 && JSON.parse(r.body).ok === true, `(${r.status}) ${r.body.slice(0, 80)}`);

    r = await req('POST', '/api/auth/login', { email: EMAIL, password: 'NewPass123' });
    const login = r.status === 200 ? JSON.parse(r.body) : null;
    check('login con la NUEVA contraseña', r.status === 200 && !!login?.token);

    // Restaurar contraseña original para no dejar el usuario de pruebas roto
    if (login?.token) {
      r = await req('POST', '/api/auth/reset-password', { password: 'Test1234' }, login.token);
      check('restore password original', r.status === 200);
      r = await req('POST', '/api/auth/login', { email: EMAIL, password: 'Test1234' });
      check('login con contraseña restaurada', r.status === 200);
    }

    // Token inválido debe fallar
    r = await req('POST', '/api/auth/reset-password', { password: 'Whatever1' }, 'invalid-token');
    check('reset con token inválido → 400', r.status === 400);
  } catch (e) {
    console.log('❌ ERROR:', e.message);
  }

  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${results.length} tests OK`);
  server.kill();
  process.exit(ok === results.length ? 0 : 1);
})();

setTimeout(() => { console.log('TIMEOUT'); server.kill(); process.exit(1); }, 60000);
