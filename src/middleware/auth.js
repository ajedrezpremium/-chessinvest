const { createRemoteJWKSet, jwtVerify } = require('jose');
const config = require('../config');
const logger = require('../services/logger');

const JWKS_URI = `${config.supabase.url}/auth/v1/.well-known/jwks.json`;
const JWKS = createRemoteJWKSet(new URL(JWKS_URI));

async function verifySupabaseToken(token) {
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `${config.supabase.url}/auth/v1`,
      audience: 'authenticated',
    });
    return payload;
  } catch (err) {
    logger.debug(`JWT verification failed: ${err.message}`);
    return null;
  }
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = header.slice(7);

  verifySupabaseToken(token)
    .then((payload) => {
      if (!payload) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      req.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.user_metadata?.role || 'user',
        username: payload.user_metadata?.username,
      };
      next();
    })
    .catch((err) => {
      logger.error(`Auth middleware error: ${err.message}`);
      res.status(401).json({ error: 'Authentication failed' });
    });
}

function optionalAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const token = header.slice(7);
    verifySupabaseToken(token)
      .then((payload) => {
        if (payload) {
          req.user = {
            id: payload.sub,
            email: payload.email,
            role: payload.user_metadata?.role || 'user',
            username: payload.user_metadata?.username,
          };
        }
        next();
      })
      .catch(() => next());
  } else {
    next();
  }
}

module.exports = { requireAuth, optionalAuth };