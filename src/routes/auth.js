const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  signUp,
  signIn,
  signOut,
  resetPasswordForEmail,
  updatePassword,
  getUser,
  refreshSession,
  getUserProfile,
  getUserSubscription,
  getUserSettings,
  linkSupabaseUserToProfile,
} = require('../services/supabaseAuth');
const { sendEmail } = require('../services/emailService');
const logger = require('../services/logger');

const router = Router();

router.post('/register', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    if (!email || !username || !password) {
      return res.status(400).json({ error: 'Email, username and password required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const { user, session } = await signUp(email, password, { username });
    if (!user) {
      return res.status(400).json({ error: 'Registration failed' });
    }

    // Link Supabase Auth user to our profile table
    await linkSupabaseUserToProfile(user.id, email, username);

    const profile = await getUserProfile(user.id);
    const subscription = await getUserSubscription(user.id);
    const settings = await getUserSettings(user.id);

    res.status(201).json({
      token: session.access_token,
      refreshToken: session.refresh_token,
      user: {
        id: profile.id,
        email: profile.email,
        username: profile.username,
        role: profile.role,
        avatar: profile.avatar,
        plan: subscription.plan,
        subscriptionStatus: subscription.status,
        subscriptionEnd: subscription.current_period_end,
        theme: settings.theme,
        language: settings.language,
        timezone: settings.timezone,
      },
    });
  } catch (err) {
    logger.error(`Registration error: ${err.message}`);
    if (err.message.includes('already registered') || err.message.includes('duplicate')) {
      return res.status(409).json({ error: 'Email or username already exists' });
    }
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email/usuario y contraseña requeridos' });
    }

    const { user, session } = await signIn(email, password);
    if (!user || !session) {
      return res.status(401).json({ error: 'Email/usuario o contraseña incorrectos' });
    }

    const profile = await getUserProfile(user.id);
    const subscription = await getUserSubscription(user.id);
    const settings = await getUserSettings(user.id);

    res.json({
      token: session.access_token,
      refreshToken: session.refresh_token,
      user: {
        id: profile.id,
        email: profile.email,
        username: profile.username,
        role: profile.role,
        avatar: profile.avatar,
        plan: subscription.plan,
        subscriptionStatus: subscription.status,
        subscriptionEnd: subscription.current_period_end,
        theme: settings.theme,
        language: settings.language,
        timezone: settings.timezone,
      },
    });
  } catch (err) {
    logger.error(`Login error: ${err.message}`);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      await signOut(header.slice(7));
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error(`Logout error: ${err.message}`);
    res.status(500).json({ error: 'Logout failed' });
  }
});

router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

  try {
    const session = await refreshSession(refreshToken);
    if (!session) return res.status(401).json({ error: 'Invalid or expired refresh token' });

    const profile = await getUserProfile(session.user.id);
    const subscription = await getUserSubscription(session.user.id);
    const settings = await getUserSettings(session.user.id);

    res.json({
      token: session.access_token,
      refreshToken: session.refresh_token,
      user: {
        id: profile.id,
        email: profile.email,
        username: profile.username,
        role: profile.role,
        avatar: profile.avatar,
        plan: subscription.plan,
        subscriptionStatus: subscription.status,
        subscriptionEnd: subscription.current_period_end,
        theme: settings.theme,
        language: settings.language,
        timezone: settings.timezone,
      },
    });
  } catch (err) {
    logger.error(`Token refresh error: ${err.message}`);
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido' });

  try {
    await resetPasswordForEmail(email);
    logger.info(`Password reset email sent for ${email}`);
    res.json({ ok: true, message: 'Si el email existe, recibirás un enlace para restablecer tu contraseña' });
  } catch (err) {
    logger.error(`Forgot password error: ${err.message}`);
    res.json({ ok: true }); // Don't reveal if email exists
  }
});

router.post('/reset-password', async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Contraseña requerida' });
  if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

  // This endpoint requires the user to be authenticated via the reset link session
  // The access token should be in the Authorization header
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Sesión de recuperación inválida o expirada' });
  }

  try {
    await updatePassword(password);
    res.json({ ok: true, message: 'Contraseña restablecida correctamente' });
  } catch (err) {
    logger.error(`Reset password error: ${err.message}`);
    res.status(400).json({ error: 'Sesión de recuperación inválida o expirada' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const profile = await getUserProfile(req.user.id);
    if (!profile) return res.status(404).json({ error: 'User not found' });

    const subscription = await getUserSubscription(req.user.id);
    const settings = await getUserSettings(req.user.id);

    res.json({
      id: profile.id,
      email: profile.email,
      username: profile.username,
      role: profile.role,
      avatar: profile.avatar,
      created_at: profile.created_at,
      plan: subscription.plan,
      subscriptionStatus: subscription.status,
      subscriptionEnd: subscription.current_period_end,
      theme: settings.theme,
      language: settings.language,
      timezone: settings.timezone,
    });
  } catch (err) {
    logger.error(`Get me error: ${err.message}`);
    res.status(500).json({ error: 'Failed to get user profile' });
  }
});

module.exports = router;