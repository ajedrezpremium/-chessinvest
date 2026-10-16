-- ============================================
-- CHESSINVEST V2.2 - SCREENER + STRESS (filtros y escenarios sin IA)
-- Ejecutar vía: node run-sql-migration.js supabase-v3-screener.sql
-- ============================================

CREATE TABLE IF NOT EXISTS ticker_fundamentals (
  ticker TEXT PRIMARY KEY,
  name TEXT,
  sector TEXT,
  price NUMERIC,
  chg_pct NUMERIC,
  market_cap NUMERIC,
  pe NUMERIC,
  forward_pe NUMERIC,
  eps_growth NUMERIC,
  div_yield NUMERIC,
  debt_equity NUMERIC,
  profit_margin NUMERIC,
  roe NUMERIC,
  beta NUMERIC,
  rsi14 NUMERIC,
  sma20 NUMERIC,
  sma50 NUMERIC,
  above_sma200 INTEGER,
  momentum_3m NUMERIC,
  analyst_buy_pct NUMERIC,
  target_upside NUMERIC,
  earnings_in_days INTEGER,
  day_range_pct NUMERIC,
  fifty_two_w_high NUMERIC,
  fifty_two_w_low NUMERIC,
  score INTEGER NOT NULL DEFAULT 0,
  criteria_met INTEGER NOT NULL DEFAULT 0,
  breakdown TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fund_score ON ticker_fundamentals(score DESC);
CREATE INDEX IF NOT EXISTS idx_fund_sector ON ticker_fundamentals(sector);
CREATE INDEX IF NOT EXISTS idx_fund_updated ON ticker_fundamentals(updated_at);

ALTER TABLE ticker_fundamentals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins see all fundamentals" ON ticker_fundamentals;
CREATE POLICY "Admins see all fundamentals" ON ticker_fundamentals FOR ALL USING (is_admin());
