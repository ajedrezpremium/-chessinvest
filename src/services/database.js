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
  return { lastID: db.getRowsModified(), changes: db.getRowsModified() };
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
  ];

  for (const sql of tables) {
    run(sql);
  }

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_portfolio_user ON portfolio(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_rec_history_user ON recommendation_history(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_rec_history_date ON recommendation_history(generated_at)',
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
