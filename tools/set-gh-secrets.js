// Sube secretos de GitHub Actions cifrados (libsodium sealed box).
// Uso: node tools/set-gh-secrets.js
// Lee .env local y sube SUPABASE_PROJECT_URL, SUPABASE_ANON_PUBLIC, SUPABASE_SERVICE_ROLE.
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const sodium = require('libsodium-wrappers');

const REPO = 'ajedrezpremium/-chessinvest';
const ROWS = [
  ['SUPABASE_PROJECT_URL', 'SUPABASE_PROJECT_URL'],
  ['SUPABASE_ANON_PUBLIC', 'SUPABASE_ANON_PUBLIC'],
  ['SUPABASE_SERVICE_ROLE', 'SUPABASE_SERVICE_ROLE'],
  ['ADMIN_EMAIL', 'ADMIN_EMAIL'],
  ['ADMIN_PASSWORD', 'ADMIN_PASSWORD'],
];

(async () => {
  const token = String(process.env.GITHUB_TOKEN || '').trim();
  if (!token) { console.error('No GITHUB_TOKEN'); process.exit(1); }
  await sodium.ready;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
  };
  const pkRes = await fetch(`https://api.github.com/repos/${REPO}/actions/secrets/public-key`, { headers });
  const pk = await pkRes.json();
  console.log('repo public-key:', pkRes.status, pk.key_id);

  const localEnv = {};
  const fs = require('fs');
  for (const line of fs.readFileSync(require('path').resolve(__dirname, '..', '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) localEnv[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }

  for (const [secretName, envName] of ROWS) {
    const value = localEnv[envName] || process.env[envName];
    if (!value) { console.log(`${secretName}: SIN VALOR local, omitido`); continue; }
    const enc = Buffer.from(sodium.crypto_box_seal(Buffer.from(value), Buffer.from(pk.key, 'base64'))).toString('base64');
    const setRes = await fetch(`https://api.github.com/repos/${REPO}/actions/secrets/${secretName}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ encrypted_value: enc, key_id: pk.key_id }),
    });
    console.log(`${secretName}: HTTP ${setRes.status} ${setRes.status === 201 || setRes.status === 204 ? 'OK' : setRes.status === 403 || setRes.status === 404 ? 'PERMISO (token sin repo scope) FALLÓ' : ''}`);
  }
})();
