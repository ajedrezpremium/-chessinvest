const { run, all, saveDb } = require('./database');
const logger = require('./logger');

async function createNotification(userId, type, title, body, data = null) {
  if (!userId) return null;
  try {
    const result = run(
      "INSERT INTO notifications (user_id, type, title, body, data) VALUES (?, ?, ?, ?, ?)",
      [userId, type, title, body || '', data ? JSON.stringify(data) : null]
    );
    saveDb();
    logger.info(`Notification created for user ${userId}: ${title}`);
    return result.lastID;
  } catch (err) {
    logger.warn(`Failed to create notification: ${err.message}`);
    return null;
  }
}

async function getNotifications(userId, limit = 20) {
  if (!userId) return [];
  try {
    return all(
      "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
      [userId, limit]
    );
  } catch {
    return [];
  }
}

async function markRead(userId, notificationId) {
  try {
    run("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?", [notificationId, userId]);
    saveDb();
  } catch {}
}

async function markAllRead(userId) {
  try {
    run("UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0", [userId]);
    saveDb();
  } catch {}
}

async function getUnreadCount(userId) {
  if (!userId) return 0;
  try {
    const row = all("SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND read = 0", [userId]);
    return row?.[0]?.cnt || 0;
  } catch {
    return 0;
  }
}

module.exports = { createNotification, getNotifications, markRead, markAllRead, getUnreadCount };
