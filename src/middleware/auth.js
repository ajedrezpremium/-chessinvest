const { createRemoteJWKSet, jwtVerify } = require('jose');
const config = require('../config');
const logger = require('../services/logger');

// JWKS perezoso: si SUPABASE_PROJECT_URL no está configurada (deploy sin env vars),
// el servidor arranca igual y las rutas con auth responden 401 en vez de crashear.
let JWKS = null;

function getJWKS() {
  if (JWKS) return JWKS;
  if (!config.supabase.url) return null;
  try {
    JWKS = createRemoteJWKSet(new URL(`${config.supabase.url}/auth/v1/.well-known/jwks.json`));
    return JWKS;
  } catch (err) {
    logger.error(`Invalid SUPABASE_PROJECT_URL: ${err.message}`);
    return null;
  }
}

async function verifySupabaseToken(token) {
  try {
    const jwks = getJWKS();
    if (!jwks) return null;
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${config.supabase.url}/auth/v1`,
      audience: 'authenticated',
    });
    return payload;
  } catch (err) {
    logger.debug(`JWT verification failed: ${err.message}`);
    return null;
  }
}

function toUser(payload) {
  return {
    id: payload.sub,
    email: payload.email,
    role: payload.user_metadata?.role || 'user',
    username: payload.user_metadata?.username,
  };
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
      req.user = toUser(payload);
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
        if (payload) req.user = toUser(payload);
        next();
      })
      .catch(() => next());
  } else {
    next();
  }
}

module.exports = { requireAuth, optionalAuth };
