const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { getNotifications, markRead, markAllRead, getUnreadCount } = require('../services/notificationService');

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  const notifications = await getNotifications(req.user.id, parseInt(req.query.limit) || 20);
  const unread = await getUnreadCount(req.user.id);
  res.json({ notifications, unread });
});

router.post('/:id/read', requireAuth, async (req, res) => {
  await markRead(req.user.id, parseInt(req.params.id));
  res.json({ ok: true });
});

router.post('/read-all', requireAuth, async (req, res) => {
  await markAllRead(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
