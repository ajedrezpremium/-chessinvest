const { getSupabaseAdmin } = require('./supabase');
const logger = require('./logger');
const { sendNotificationEmail } = require('./emailService');

async function createNotification(userId, type, title, body, data = null) {
  if (!userId) return null;
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return null;
    const { data: row, error } = await admin
      .from('notifications')
      .insert({
        user_id: userId,
        type,
        title,
        body: body || '',
        data: data ? JSON.stringify(data) : null,
      })
      .select('id')
      .single();
    if (error) throw error;
    logger.info(`Notification created for user ${userId}: ${title}`);

    sendNotificationEmail(userId, type, title, body, data).catch(() => {});

    return row.id;
  } catch (err) {
    logger.warn(`Failed to create notification: ${err.message}`);
    return null;
  }
}

async function getNotifications(userId, limit = 20) {
  if (!userId) return [];
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return [];
    const { data, error } = await admin
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  } catch {
    return [];
  }
}

async function markRead(userId, notificationId) {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return;
    await admin.from('notifications').update({ read: 1 }).eq('id', notificationId).eq('user_id', userId);
  } catch {}
}

async function markAllRead(userId) {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return;
    await admin.from('notifications').update({ read: 1 }).eq('user_id', userId).eq('read', 0);
  } catch {}
}

async function getUnreadCount(userId) {
  if (!userId) return 0;
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return 0;
    const { count, error } = await admin
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('read', 0);
    if (error) throw error;
    return count || 0;
  } catch {
    return 0;
  }
}

module.exports = { createNotification, getNotifications, markRead, markAllRead, getUnreadCount };
