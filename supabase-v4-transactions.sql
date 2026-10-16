-- ============================================
-- CHESSINVEST V2.3 - CARTERA PRO (operaciones + TWR)
-- Ejecutar vía: node run-sql-migration.js supabase-v4-transactions.sql
-- ============================================

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell', 'dividend')),
  shares NUMERIC NOT NULL DEFAULT 0,
  price NUMERIC NOT NULL DEFAULT 0,
  fee NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_tx_user_ticker ON transactions(user_id, ticker);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(executed_at);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins see all tx" ON transactions;
CREATE POLICY "Admins see all tx" ON transactions FOR ALL USING (is_admin());

DROP POLICY IF EXISTS "Users manage own tx" ON transactions;
CREATE POLICY "Users manage own tx" ON transactions FOR ALL USING (auth.uid() = user_id);

-- Backfill: posiciones actuales como compras de apertura (solo donde no haya operaciones)
INSERT INTO transactions (user_id, ticker, side, shares, price, fee, notes, executed_at)
SELECT p.user_id, p.ticker, 'buy', p.shares, p.avg_price, 0, 'Apertura migrada V2.3', p.added_at
FROM portfolio p
WHERE NOT EXISTS (
  SELECT 1 FROM transactions t WHERE t.user_id = p.user_id AND t.ticker = p.ticker
);
