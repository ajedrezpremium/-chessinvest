const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');
const { run, get, saveDb } = require('./database');
const logger = require('./logger');

const SALT_ROUNDS = 12;
const JWT_SECRET = process.env.JWT_SECRET || 'chessinvest_dev_secret_change_in_production';
const ACCESS_EXPIRES = '15m';
const REFRESH_EXPIRES_DAYS = 7;

function hashPassword(password) {
  return bcrypt.hashSync(password, SALT_ROUNDS);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function signAccessToken(user) {
  return jwt.sign({ id: user.id, email: user.email, username: user.username }, JWT_SECRET, {
    expiresIn: ACCESS_EXPIRES,
  });
}

function signRefreshToken() {
  return crypto.randomBytes(40).toString('hex');
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

async function createTokens(user) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_EXPIRES_DAYS * 86400000).toISOString();

  try {
    run("DELETE FROM refresh_tokens WHERE user_id = ?", [user.id]);
    run("INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)",
      [user.id, refreshToken, expiresAt]);
    saveDb();
  } catch (err) {
    logger.warn(`Failed to store refresh token: ${err.message}`);
  }

  return { accessToken, refreshToken, expiresAt };
}

async function refreshAccessToken(refreshToken) {
  const stored = get("SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > datetime('now')", [refreshToken]);
  if (!stored) return null;

  const user = get('SELECT id, email, username FROM users WHERE id = ?', [stored.user_id]);
  if (!user) return null;

  const newAccess = signAccessToken(user);
  return { accessToken: newAccess, user: { id: user.id, email: user.email, username: user.username } };
}

async function createPasswordReset(email) {
  const user = get('SELECT id FROM users WHERE email = ?', [email]);
  if (!user) return null;

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 3600000).toISOString();
  run("INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)", [user.id, token, expiresAt]);
  saveDb();
  return token;
}

async function resetPassword(token, newPassword) {
  const reset = get("SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > datetime('now')", [token]);
  if (!reset) return false;

  const hash = hashPassword(newPassword);
  run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, reset.user_id]);
  run("UPDATE password_resets SET used = 1 WHERE id = ?", [reset.id]);
  run("DELETE FROM refresh_tokens WHERE user_id = ?", [reset.user_id]);
  saveDb();
  return true;
}

module.exports = {
  hashPassword, verifyPassword, signAccessToken, signToken: signAccessToken,
  verifyToken, createTokens, refreshAccessToken, createPasswordReset, resetPassword,
};
