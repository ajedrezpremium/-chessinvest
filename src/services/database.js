const Database = require('better-sqlite3');
const path = require('path');
const logger = require('./logger');

const DB_PATH = path.resolve(__dirname, '../../data/chessinvest.db');

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
    logger.info(`Database initialized at ${DB_PATH}`);
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ticker TEXT NOT NULL,
      added_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, ticker)
    );

    CREATE TABLE IF NOT EXISTS portfolio (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ticker TEXT NOT NULL,
      shares REAL NOT NULL CHECK(shares > 0),
      avg_price REAL NOT NULL CHECK(avg_price > 0),
      added_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, ticker)
    );

    CREATE TABLE IF NOT EXISTS recommendation_history (
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
    );

    CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id);
    CREATE INDEX IF NOT EXISTS idx_portfolio_user ON portfolio(user_id);
    CREATE INDEX IF NOT EXISTS idx_rec_history_user ON recommendation_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_rec_history_date ON recommendation_history(generated_at);
  `);
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
    logger.info('Database closed');
  }
}

module.exports = { getDb, closeDb };
