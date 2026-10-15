// DEPRECATED (V2.0): JWT custom + bcrypt reemplazado por Supabase Auth.
// Este archivo se conserva como stub para no romper imports antiguos.
// Usar: src/services/supabaseAuth.js

function deprecated() {
  throw new Error('services/auth.js (JWT custom) está deprecado. Usa services/supabaseAuth.js (Supabase Auth).');
}

function hashPassword() { deprecated(); }
function verifyPassword() { deprecated(); }
function signAccessToken() { deprecated(); }
function signToken() { deprecated(); }
function verifyToken() { deprecated(); }
async function createTokens() { deprecated(); }
async function refreshAccessToken() { deprecated(); }
async function createPasswordReset() { deprecated(); }
function resetPassword() { deprecated(); }

module.exports = {
  hashPassword, verifyPassword, signAccessToken, signToken,
  verifyToken, createTokens, refreshAccessToken, createPasswordReset, resetPassword,
};
