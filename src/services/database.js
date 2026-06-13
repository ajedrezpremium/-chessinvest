const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const DB_PATH = path.resolve(__dirname, '../../data/chessinvest.db');

let db;
let SQL;
let dbReady = false;

async function openDb() {
  try {
    SQL = await initSqlJs();
    
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(DB_PATH)) {
      const fileBuffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
    }

    dbReady = true;
    logger.info(`Database initialized: ${DB_PATH}`);
  } catch (err) {
    logger.error(`Database init failed: ${err.message}. Using in-memory fallback.`);
    SQL = await initSqlJs();
    db = new SQL.Database();
    dbReady = true;
  }
}

function run(sql, params = []) {
  if (!dbReady) throw new Error('Database not ready');
  db.run(sql, params);
  const changes = db.getRowsModified();
  let lastID = null;
  if (sql.trim().toUpperCase().startsWith('INSERT')) {
    const stmt = db.prepare('SELECT last_insert_rowid() as id');
    stmt.step();
    lastID = stmt.getAsObject().id;
    stmt.free();
  }
  return { lastID, changes };
}

function get(sql, params = []) {
  if (!dbReady) throw new Error('Database not ready');
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const result = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return result;
}

function all(sql, params = []) {
  if (!dbReady) throw new Error('Database not ready');
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function saveDb() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (err) {
    logger.error(`Failed to save database: ${err.message}`);
  }
}

async function initSchema() {
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      first_name TEXT,
      last_name TEXT,
      phone TEXT,
      birth_date TEXT,
      country TEXT DEFAULT 'ES',
      investor_profile TEXT DEFAULT 'moderate',
      experience TEXT DEFAULT 'beginner',
      avatar TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ticker TEXT NOT NULL,
      added_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, ticker)
    )`,
    `CREATE TABLE IF NOT EXISTS portfolio (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ticker TEXT NOT NULL,
      shares REAL NOT NULL CHECK(shares > 0),
      avg_price REAL NOT NULL CHECK(avg_price > 0),
      added_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, ticker)
    )`,
    `CREATE TABLE IF NOT EXISTS recommendation_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ticker TEXT NOT NULL,
      score INTEGER NOT NULL,
      reason TEXT,
      catalyst TEXT,
      risk TEXT,
      sector TEXT,
      price_at_recommendation TEXT,
      generated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan TEXT NOT NULL DEFAULT 'free',
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      current_period_start TEXT,
      current_period_end TEXT,
      cancel_at TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS price_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ticker TEXT NOT NULL,
      target_price REAL NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('above', 'below')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      target_amount REAL NOT NULL,
      current_amount REAL NOT NULL DEFAULT 0,
      deadline TEXT,
      type TEXT NOT NULL DEFAULT 'savings',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS investment_ideas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ticker TEXT NOT NULL,
      thesis TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      theme TEXT NOT NULL DEFAULT 'dark',
      notifications_email INTEGER NOT NULL DEFAULT 1,
      newsletter_subscribed INTEGER NOT NULL DEFAULT 1,
      notifications_sms INTEGER NOT NULL DEFAULT 0,
      language TEXT NOT NULL DEFAULT 'es',
      timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
      voice_enabled INTEGER NOT NULL DEFAULT 0,
      voice_input_enabled INTEGER NOT NULL DEFAULT 0,
      voice_rate REAL NOT NULL DEFAULT 1.0,
      voice_pitch REAL NOT NULL DEFAULT 1.0,
      voice_lang TEXT NOT NULL DEFAULT 'es-ES',
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      type TEXT NOT NULL DEFAULT 'support',
      subject TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT NOT NULL DEFAULT 'medium',
      admin_notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS email_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      content TEXT,
      type TEXT NOT NULL DEFAULT 'newsletter',
      target_plan TEXT NOT NULL DEFAULT 'all',
      status TEXT NOT NULL DEFAULT 'draft',
      sent_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS conversation_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      agent TEXT NOT NULL DEFAULT 'stockbroker',
      message TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'signal',
      title TEXT NOT NULL,
      body TEXT,
      data TEXT,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS usage_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS market_cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS signal_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      agent TEXT NOT NULL DEFAULT 'stockbroker',
      asset TEXT NOT NULL,
      direction TEXT NOT NULL,
      entry_price TEXT,
      stop_loss TEXT,
      take_profit TEXT,
      score INTEGER,
      confidence INTEGER,
      risk_reward TEXT,
      rationale TEXT,
      result TEXT,
      exit_price TEXT,
      closed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS newsletters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      summary TEXT,
      top_tickers TEXT,
      generated_at TEXT DEFAULT (datetime('now')),
      sent_count INTEGER DEFAULT 0
    )`,
  ];

  for (const sql of tables) {
    run(sql);
  }

  const alterStatements = [
    'ALTER TABLE users ADD COLUMN first_name TEXT',
    'ALTER TABLE users ADD COLUMN last_name TEXT',
    'ALTER TABLE users ADD COLUMN phone TEXT',
    'ALTER TABLE users ADD COLUMN birth_date TEXT',
    'ALTER TABLE users ADD COLUMN country TEXT DEFAULT \'ES\'',
    'ALTER TABLE users ADD COLUMN investor_profile TEXT DEFAULT \'moderate\'',
    'ALTER TABLE users ADD COLUMN experience TEXT DEFAULT \'beginner\'',
    'ALTER TABLE users ADD COLUMN avatar TEXT',
    'ALTER TABLE users ADD COLUMN role TEXT DEFAULT \'user\'',
    'ALTER TABLE user_settings ADD COLUMN newsletter_subscribed INTEGER DEFAULT 1',
  ];

  for (const sql of alterStatements) {
    try {
      run(sql);
    } catch {
      // Column might already exist
    }
  }

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_portfolio_user ON portfolio(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_rec_history_user ON recommendation_history(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_rec_history_date ON recommendation_history(generated_at)',
    'CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_price_alerts_user ON price_alerts(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_goals_user ON goals(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_ideas_user ON investment_ideas(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_signals_user ON signal_history(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_signals_agent ON signal_history(agent)',
    'CREATE INDEX IF NOT EXISTS idx_signals_date ON signal_history(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_conversation_user_agent ON conversation_history(user_id, agent)',
    'CREATE INDEX IF NOT EXISTS idx_conversation_date ON conversation_history(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(user_id, read)',
    'CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token)',
    'CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_tracking(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_tracking(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token)',
    'CREATE INDEX IF NOT EXISTS idx_newsletters_date ON newsletters(generated_at)',
  ];

  for (const sql of indexes) {
    try {
      run(sql);
    } catch {
      // Index might already exist
    }
  }

  saveDb();
}

function closeDb() {
  if (db) {
    saveDb();
    db.close();
    db = null;
    dbReady = false;
    logger.info('Database closed');
  }
}

module.exports = { openDb, run, get, all, closeDb, initSchema, saveDb };
