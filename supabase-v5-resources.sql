-- ============================================
-- CHESSINVEST V2.4 - DIRECTORIO (herramientas + organismos)
-- Ejecutar vía: node run-sql-migration.js supabase-v5-resources.sql
-- ============================================

CREATE TABLE IF NOT EXISTS resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('herramienta', 'regulador', 'organismo', 'formacion')),
  url TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_free INTEGER NOT NULL DEFAULT 1,
  lang TEXT NOT NULL DEFAULT 'es',
  featured INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT resources_url_unique UNIQUE (url)
);

CREATE INDEX IF NOT EXISTS idx_resources_cat ON resources(category);
CREATE INDEX IF NOT EXISTS idx_resources_feat ON resources(featured DESC);

ALTER TABLE resources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins see all resources" ON resources;
CREATE POLICY "Admins see all resources" ON resources FOR ALL USING (is_admin());

DROP POLICY IF EXISTS "Public read resources" ON resources;
CREATE POLICY "Public read resources" ON resources FOR SELECT USING (true);

-- Búsqueda full-text en español (insensible a tildes) para el fallback sin vectores
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION f_unaccent(text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT public.unaccent($1) $$;

CREATE INDEX IF NOT EXISTS idx_chunks_fts
  ON knowledge_chunks USING gin (to_tsvector('spanish', f_unaccent(content)));

CREATE OR REPLACE FUNCTION search_chunks(query_text TEXT, match_count INT DEFAULT 5)
RETURNS TABLE (id UUID, content TEXT, source TEXT, similarity FLOAT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  q tsquery;
BEGIN
  -- OR entre lexemas: basta una palabra relevante (AND devolvía 0 filas casi siempre)
  q := replace(plainto_tsquery('spanish', f_unaccent(query_text))::text, '&', '|')::tsquery;
  RETURN QUERY
  SELECT kc.id, kc.content, kc.source,
         ts_rank_cd(to_tsvector('spanish', f_unaccent(kc.content)), q)::FLOAT AS similarity
  FROM knowledge_chunks kc
  WHERE to_tsvector('spanish', f_unaccent(kc.content)) @@ q
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- Seed inicial (idempotente por url)
INSERT INTO resources (name, category, url, description, is_free, lang, featured) VALUES
('Yahoo Finance', 'herramienta', 'https://finance.yahoo.com', 'Cotizaciones gratuitas, históricos, fundamentales y calendario de resultados. Fuente de datos de ChessInvest.', 1, 'en', 1),
('TradingView', 'herramienta', 'https://tradingview.com', 'Gráficos profesionales, Pine Script e ideas de la comunidad. Plan gratuito generoso.', 1, 'es', 1),
('Finviz', 'herramienta', 'https://finviz.com', 'Screener visual gratuito: heatmaps, filtros por PER, dividendo, capitalización y patrones.', 1, 'en', 1),
('Finnhub', 'herramienta', 'https://finnhub.io', 'API gratuita de datos bursátiles, noticias y fundamentales para desarrolladores.', 1, 'en', 0),
('Alpha Vantage', 'herramienta', 'https://alphavantage.co', 'APIs gratuitas de acciones, forex, cripto e indicadores técnicos.', 1, 'en', 0),
('Morningstar', 'herramienta', 'https://morningstar.com', 'Análisis independiente de fondos, ETFs y acciones con ratings cuantitativos.', 1, 'en', 0),
('Investing.com', 'herramienta', 'https://es.investing.com', 'Cotizaciones, calendario económico en español y noticias de mercados.', 1, 'es', 1),
('Bolsas y Mercados Españoles', 'herramienta', 'https://www.bolsasymercados.es', 'Web oficial de BME: cotizaciones IBEX, hechos relevantes y normativa española.', 1, 'es', 0),
('CNMV', 'regulador', 'https://www.cnmv.es', 'Comisión Nacional del Mercado de Valores: supervisor español. Consulta empresas de inversión autorizadas y alertas sobre chiringuitos financieros.', 1, 'es', 1),
('ESMA', 'regulador', 'https://www.esma.europa.eu', 'Autoridad Europea de Valores y Mercados: regula y supervisa los mercados en la UE, MiFID II y protección al inversor.', 1, 'en', 1),
('SEC (EDGAR)', 'regulador', 'https://www.sec.gov/edgar', 'Regulador USA. EDGAR: acceso libre a informes 10-K/10-Q de todas las cotizadas americanas.', 1, 'en', 0),
('FINRA BrokerCheck', 'regulador', 'https://brokercheck.finra.org', 'Verifica brokers y asesores registrados en USA antes de abrir cuenta.', 1, 'en', 0),
('FCA (Reino Unido)', 'regulador', 'https://www.fca.org.uk', 'Regulador británico: registro de firmas autorizadas y alertas de estafas.', 1, 'en', 0),
('BaFin (Alemania)', 'regulador', 'https://www.bafin.de', 'Supervisor financiero alemán: bancos, aseguradoras y valores.', 1, 'en', 0),
('IOSCO', 'organismo', 'https://www.iosco.org', 'Organización Internacional de Comisiones de Valores: estándares globales y alertas de reguladores miembros.', 1, 'en', 1),
('BIS - Banco de Pagos Internacionales', 'organismo', 'https://www.bis.org', 'El banco de los bancos centrales: estadísticas, tipos y estabilidad financiera global.', 1, 'en', 0),
('FMI - Fondo Monetario Internacional', 'organismo', 'https://www.imf.org', 'Vigilancia macroeconómica mundial, WEO y estabilidad financiera (GFSR).', 1, 'en', 0),
('Banco Mundial', 'organismo', 'https://www.worldbank.org', 'Datos de desarrollo, deuda soberana y riesgo país.', 1, 'en', 0),
('OCDE', 'organismo', 'https://www.oecd.org', 'Perspectivas económicas, fiscalidad y gobierno corporativo.', 1, 'en', 0),
('FSB - Consejo de Estabilidad Financiera', 'organismo', 'https://www.fsb.org', 'Coordina la regulación financiera global post-crisis (G20).', 1, 'en', 0),
('Investopedia', 'formacion', 'https://www.investopedia.com', 'Diccionario y academia gratuita de finanzas en inglés: el estándar para aprender términos.', 1, 'en', 1),
('Khan Academy Finanzas', 'formacion', 'https://es.khanacademy.org/economics-finance-domain', 'Cursos gratuitos de economía y finanzas personales, también en español.', 1, 'es', 0)
ON CONFLICT DO NOTHING;
