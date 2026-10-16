// Ejecuta un .sql contra Supabase vía rpc exec_sql (requiere migración 1 aplicada).
// Uso: node run-sql-migration.js supabase-v2-rag-newsletter.sql
require('dotenv').config({ path: '.env' });
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function splitStatements(sql) {
  // Quita comentarios de línea, respeta bloques $$...$$
  const lines = sql.split('\n').filter((l) => !l.trim().startsWith('--'));
  const text = lines.join('\n');
  const out = [];
  let buf = '';
  let inDollar = false;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('$$', i)) {
      inDollar = !inDollar;
      buf += '$$';
      i++;
      continue;
    }
    if (text[i] === ';' && !inDollar) {
      if (buf.trim()) out.push(buf.trim() + ';');
      buf = '';
      continue;
    }
    buf += text[i];
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

(async () => {
  const file = process.argv[2];
  if (!file) {
    console.error('Uso: node run-sql-migration.js <archivo.sql>');
    process.exit(1);
  }
  const supabase = createClient(
    process.env.SUPABASE_PROJECT_URL,
    process.env.SUPABASE_SERVICE_ROLE
  );

  // 1. Verificar exec_sql
  const probe = await supabase.rpc('exec_sql', { sql: 'SELECT 1 AS ok;' });
  if (probe.error) {
    console.error('exec_sql no disponible:', probe.error.message);
    console.error('Ejecuta el SQL manualmente en Supabase Dashboard > SQL Editor.');
    process.exit(1);
  }

  // 2. Ejecutar statements
  const sql = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
  const stmts = splitStatements(sql);
  console.log(`${stmts.length} statements en ${file}`);
  let ok = 0;
  for (let i = 0; i < stmts.length; i++) {
    const preview = stmts[i].replace(/\s+/g, ' ').slice(0, 70);
    const { error } = await supabase.rpc('exec_sql', { sql: stmts[i] });
    if (error) {
      console.error(`[${i + 1}/${stmts.length}] FAIL: ${preview}... -> ${error.message}`);
    } else {
      ok++;
      console.log(`[${i + 1}/${stmts.length}] ok: ${preview}...`);
    }
  }
  console.log(`Migración: ${ok}/${stmts.length} OK`);
  process.exit(ok === stmts.length ? 0 : 1);
})();
