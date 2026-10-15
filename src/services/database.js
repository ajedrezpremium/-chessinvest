// DEPRECATED (V2.0): sql.js / SQLite local reemplazado por Supabase PostgreSQL.
// Este archivo se conserva como stub para no romper imports antiguos.
// Usar: src/services/supabase.js + src/services/supabaseDb.js

function deprecated() {
  throw new Error('services/database.js (sql.js) está deprecado. Usa services/supabaseDb.js (Supabase PostgreSQL).');
}

async function openDb() { deprecated(); }
async function initSchema() { deprecated(); }
function run() { deprecated(); }
function get() { deprecated(); }
function all() { deprecated(); }
function saveDb() {}
function closeDb() {}

module.exports = { openDb, initSchema, run, get, all, saveDb, closeDb };
