-- ============================================
-- CHESSINVEST V2.0 - SUPABASE MIGRATION
-- Ejecutar en Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- ============================================

-- 1. Extensiones
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Tablas principales
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  birth_date DATE,
  country TEXT DEFAULT 'ES',
  investor_profile TEXT DEFAULT 'moderate',
  experience TEXT DEFAULT 'beginner',
  avatar TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  added_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, ticker)
);

CREATE TABLE portfolio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  shares NUMERIC NOT NULL CHECK (shares > 0),
  avg_price NUMERIC NOT NULL CHECK (avg_price > 0),
  added_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, ticker)
);

CREATE TABLE recommendation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ticker TEXT NOT NULL,
  score INTEGER NOT NULL,
  reason TEXT,
  catalyst TEXT,
  risk TEXT,
  sector TEXT,
  price_at_recommendation TEXT,
  generated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE price_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  target_price NUMERIC NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('above', 'below')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  target_amount NUMERIC NOT NULL,
  current_amount NUMERIC NOT NULL DEFAULT 0,
  deadline DATE,
  type TEXT NOT NULL DEFAULT 'savings',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE investment_ideas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  thesis TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE user_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'dark',
  notifications_email INTEGER NOT NULL DEFAULT 1,
  newsletter_subscribed INTEGER NOT NULL DEFAULT 1,
  notifications_sms INTEGER NOT NULL DEFAULT 0,
  language TEXT NOT NULL DEFAULT 'es',
  timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
  voice_enabled INTEGER NOT NULL DEFAULT 0,
  voice_input_enabled INTEGER NOT NULL DEFAULT 0,
  voice_rate NUMERIC NOT NULL DEFAULT 1.0,
  voice_pitch NUMERIC NOT NULL DEFAULT 1.0,
  voice_lang TEXT NOT NULL DEFAULT 'es-ES',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'support',
  subject TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'medium',
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE email_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL,
  content TEXT,
  type TEXT NOT NULL DEFAULT 'newsletter',
  target_plan TEXT NOT NULL DEFAULT 'all',
  status TEXT NOT NULL DEFAULT 'draft',
  sent_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE conversation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  agent TEXT NOT NULL DEFAULT 'stockbroker',
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'signal',
  title TEXT NOT NULL,
  body TEXT,
  data TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE usage_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  cost NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE market_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE signal_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  agent TEXT NOT NULL DEFAULT 'stockbroker',
  asset TEXT NOT NULL,
  direction TEXT NOT NULL,
  entry_price TEXT,
  stop_loss TEXT,
  take_profit TEXT,
  score INTEGER,
  confidence INTEGER,
  risk_reward TEXT,
  rationale TEXT,
  result TEXT,
  exit_price TEXT,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE newsletters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  top_tickers TEXT,
  generated_at TIMESTAMPTZ DEFAULT now(),
  sent_count INTEGER DEFAULT 0
);

-- 3. RLS (Row Level Security) - Habilitar en todas las tablas user-scoped
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_history ENABLE ROW LEVEL SECURITY;

-- 4. Políticas RLS: usuarios ven/solo modifican SUS datos
CREATE POLICY "Users manage own watchlist" ON watchlist
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own portfolio" ON portfolio
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users see own recommendations" ON recommendation_history
  FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users manage own subscription" ON subscriptions
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own alerts" ON price_alerts
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own goals" ON goals
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own ideas" ON investment_ideas
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own settings" ON user_settings
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users see own incidents" ON incidents
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users create incidents" ON incidents
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users see own conversations" ON conversation_history
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users see own notifications" ON notifications
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own refresh_tokens" ON refresh_tokens
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users see own usage" ON usage_tracking
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users manage own password_resets" ON password_resets
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users see own signals" ON signal_history
  FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

-- 5. Políticas para admins (ver todo)
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

CREATE POLICY "Admins see all users" ON users FOR ALL USING (is_admin());
CREATE POLICY "Admins see all watchlist" ON watchlist FOR ALL USING (is_admin());
CREATE POLICY "Admins see all portfolio" ON portfolio FOR ALL USING (is_admin());
CREATE POLICY "Admins see all recommendations" ON recommendation_history FOR ALL USING (is_admin());
CREATE POLICY "Admins see all subscriptions" ON subscriptions FOR ALL USING (is_admin());
CREATE POLICY "Admins see all alerts" ON price_alerts FOR ALL USING (is_admin());
CREATE POLICY "Admins see all goals" ON goals FOR ALL USING (is_admin());
CREATE POLICY "Admins see all ideas" ON investment_ideas FOR ALL USING (is_admin());
CREATE POLICY "Admins see all settings" ON user_settings FOR ALL USING (is_admin());
CREATE POLICY "Admins see all incidents" ON incidents FOR ALL USING (is_admin());
CREATE POLICY "Admins see all conversations" ON conversation_history FOR ALL USING (is_admin());
CREATE POLICY "Admins see all notifications" ON notifications FOR ALL USING (is_admin());
CREATE POLICY "Admins see all refresh_tokens" ON refresh_tokens FOR ALL USING (is_admin());
CREATE POLICY "Admins see all usage" ON usage_tracking FOR ALL USING (is_admin());
CREATE POLICY "Admins see all password_resets" ON password_resets FOR ALL USING (is_admin());
CREATE POLICY "Admins see all signals" ON signal_history FOR ALL USING (is_admin());
CREATE POLICY "Admins see all newsletters" ON newsletters FOR ALL USING (is_admin());
CREATE POLICY "Admins see all email_campaigns" ON email_campaigns FOR ALL USING (is_admin());
CREATE POLICY "Admins see all market_cache" ON market_cache FOR ALL USING (is_admin());

-- 6. Índices de rendimiento
CREATE INDEX idx_watchlist_user ON watchlist(user_id);
CREATE INDEX idx_portfolio_user ON portfolio(user_id);
CREATE INDEX idx_rec_history_user ON recommendation_history(user_id);
CREATE INDEX idx_rec_history_date ON recommendation_history(generated_at);
CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX idx_price_alerts_user ON price_alerts(user_id);
CREATE INDEX idx_goals_user ON goals(user_id);
CREATE INDEX idx_ideas_user ON investment_ideas(user_id);
CREATE INDEX idx_signals_user ON signal_history(user_id);
CREATE INDEX idx_signals_agent ON signal_history(agent);
CREATE INDEX idx_signals_date ON signal_history(created_at);
CREATE INDEX idx_conversation_user_agent ON conversation_history(user_id, agent);
CREATE INDEX idx_conversation_date ON conversation_history(created_at);
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(user_id, read);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX idx_usage_user ON usage_tracking(user_id);
CREATE INDEX idx_usage_date ON usage_tracking(created_at);
CREATE INDEX idx_password_resets_token ON password_resets(token);
CREATE INDEX idx_newsletters_date ON newsletters(generated_at);

-- 7. Seed de usuarios admin (idempotente)
INSERT INTO users (email, username, password_hash, role, avatar)
VALUES
  ('ajedrezpremium@gmail.com', 'Admin', crypt('Chess2026#', gen_salt('bf')), 'admin', '👑'),
  ('chessagencyai@gmail.com', 'chessagencyai', crypt('Chess2026#', gen_salt('bf')), 'user', '🤖'),
  ('carlosguerra@gmail.com', 'xadreztomiño', crypt('Chess2026#', gen_salt('bf')), 'admin', '♔')
ON CONFLICT (email) DO UPDATE SET
  role = EXCLUDED.role,
  avatar = EXCLUDED.avatar;

INSERT INTO subscriptions (user_id, plan, status)
SELECT id, CASE WHEN role = 'admin' THEN 'premium' ELSE 'free' END, 'active'
FROM users WHERE email IN ('ajedrezpremium@gmail.com', 'chessagencyai@gmail.com', 'carlosguerra@gmail.com')
ON CONFLICT (user_id) DO UPDATE SET
  plan = CASE WHEN (SELECT role FROM users WHERE id = subscriptions.user_id) = 'admin' THEN 'premium' ELSE 'free' END,
  status = 'active';

INSERT INTO user_settings (user_id)
SELECT id FROM users WHERE email IN ('ajedrezpremium@gmail.com', 'chessagencyai@gmail.com', 'carlosguerra@gmail.com')
ON CONFLICT (user_id) DO NOTHING;

-- 8. Función helper para ejecutar SQL dinámico (opcional, para migraciones futuras)
CREATE OR REPLACE FUNCTION exec_sql(sql TEXT) RETURNS VOID AS $$
BEGIN
  EXECUTE sql;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION exec_sql(TEXT) TO service_role;