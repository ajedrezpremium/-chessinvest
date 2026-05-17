const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const DB_PATH = process.env.DATABASE_URL
  ? process.env.DATABASE_URL
  : path.resolve(__dirname, '../../data/chessinvest.db');

let db;
let dbReady = false;

function openDb() {
  return new Promise((resolve, reject) => {
    try {
      if (!DB_PATH.startsWith('sqlite://') && !DB_PATH.startsWith(':memory:')) {
        const dir = path.dirname(DB_PATH);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
          logger.info(`Created data directory: ${dir}`);
        }
      }

      db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
          logger.error(`SQLite open error: ${err.message}. Using in-memory fallback.`);
          db = new sqlite3.Database(':memory:');
        }
        db.run('PRAGMA journal_mode = WAL', () => {
          db.run('PRAGMA foreign_keys = ON', () => {
            dbReady = true;
            logger.info(`Database initialized: ${DB_PATH.startsWith(':memory:') ? 'in-memory' : DB_PATH}`);
            resolve();
          });
        });
      });
    } catch (err) {
      logger.error(`Database setup failed: ${err.message}. Using in-memory fallback.`);
      db = new sqlite3.Database(':memory:');
      dbReady = true;
      resolve();
    }
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    if (!dbReady) return reject(new Error('Database not ready'));
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    if (!dbReady) return reject(new Error('Database not ready'));
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    if (!dbReady) return reject(new Error('Database not ready'));
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
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
    await run(sql);
  }

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_portfolio_user ON portfolio(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_rec_history_user ON recommendation_history(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_rec_history_date ON recommendation_history(generated_at)',
  ];

  for (const sql of indexes) {
    try {
      await run(sql);
    } catch {
      // Index might already exist
    }
  }
}

function closeDb() {
  return new Promise((resolve) => {
    if (db) {
      db.close(() => {
        db = null;
        dbReady = false;
        logger.info('Database closed');
        resolve();
      });
    } else {
      resolve();
    }
  });
}

module.exports = { openDb, run, get, all, closeDb, initSchema };
