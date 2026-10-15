const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const logger = require('./logger');

let supabaseAdmin = null;
let supabaseClient = null;

function getSupabaseAdmin() {
  if (!supabaseAdmin && config.supabase.serviceRoleKey && config.supabase.url) {
    supabaseAdmin = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    logger.info('Supabase admin client initialized');
  }
  return supabaseAdmin;
}

function getSupabaseClient() {
  if (!supabaseClient && config.supabase.anonKey && config.supabase.url) {
    supabaseClient = createClient(config.supabase.url, config.supabase.anonKey);
    logger.info('Supabase anon client initialized');
  }
  return supabaseClient;
}

async function testConnection() {
  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase not configured' };

  try {
    const { data, error } = await admin.from('users').select('count', { count: 'exact', head: true });
    if (error) throw error;
    return { ok: true, count: data };
  } catch (err) {
    logger.error(`Supabase connection test failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function runSql(sql) {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase admin not configured');

  const { data, error } = await admin.rpc('exec_sql', { sql });
  if (error) throw error;
  return data;
}

module.exports = {
  getSupabaseAdmin,
  getSupabaseClient,
  testConnection,
  runSql,
};