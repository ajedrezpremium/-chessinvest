-- ============================================
-- CHESSINVEST V2.1 - RAG + NEWSLETTER TOP20 + TELEGRAM
-- Ejecutar en Supabase Dashboard > SQL Editor (después de supabase-migration.sql)
-- ============================================

-- 1. pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Base de conocimiento (RAG)
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  lang TEXT NOT NULL DEFAULT 'es',
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chunks_embedding
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_chunks_source ON knowledge_chunks(source);

CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(1536),
  match_count INT DEFAULT 5,
  filter_source TEXT DEFAULT NULL
)
RETURNS TABLE (id UUID, content TEXT, source TEXT, similarity FLOAT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT kc.id, kc.content, kc.source,
         1 - (kc.embedding <=> query_embedding) AS similarity
  FROM knowledge_chunks kc
  WHERE kc.embedding IS NOT NULL
    AND (filter_source IS NULL OR kc.source = filter_source)
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 3. Items estructurados del newsletter (Top 20)
CREATE TABLE IF NOT EXISTS newsletter_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  newsletter_id UUID REFERENCES newsletters(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  why_matters TEXT,
  tickers TEXT,
  impact INTEGER NOT NULL DEFAULT 50 CHECK (impact BETWEEN 0 AND 100),
  sector TEXT,
  direction TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_items_newsletter ON newsletter_items(newsletter_id);
CREATE INDEX IF NOT EXISTS idx_items_impact ON newsletter_items(impact DESC);

-- 4. Preferencias de newsletter + Telegram por usuario
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS newsletter_topics TEXT NOT NULL DEFAULT 'all';
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS newsletter_time TEXT NOT NULL DEFAULT '08:00';
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS newsletter_lang TEXT NOT NULL DEFAULT 'es';
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS newsletter_min_impact INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS telegram_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS telegram_link_code TEXT;

-- 5. Modelo usado en tracking de consumo
ALTER TABLE usage_tracking ADD COLUMN IF NOT EXISTS model TEXT;

-- 6. Registro de chats de Telegram (/start)
CREATE TABLE IF NOT EXISTS telegram_chats (
  chat_id TEXT PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  username TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. RLS (el backend usa service_role, que bypassa RLS; políticas solo para coherencia admin)
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE newsletter_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_chats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins see all chunks" ON knowledge_chunks;
CREATE POLICY "Admins see all chunks" ON knowledge_chunks FOR ALL USING (is_admin());

DROP POLICY IF EXISTS "Admins see all items" ON newsletter_items;
CREATE POLICY "Admins see all items" ON newsletter_items FOR ALL USING (is_admin());

DROP POLICY IF EXISTS "Admins see all tg chats" ON telegram_chats;
CREATE POLICY "Admins see all tg chats" ON telegram_chats FOR ALL USING (is_admin());
