const { getSupabaseAdmin } = require('./supabase');
const { embedText, embedTexts } = require('./embeddings');
const logger = require('./logger');

// null = sin probar; false = tabla/función ausente (pre-migración): no malgastar embeddings
let ragReady = null;

// Recupera chunks relevantes y los formatea como bloque de contexto para prompts.
async function retrieveContext(query, { matchCount = 5, source = null } = {}) {
  if (ragReady === false) return '';
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return '';
    const vec = await embedText(query);
    if (!vec) return '';

    const { data, error } = await admin.rpc('match_chunks', {
      query_embedding: vec,
      match_count: matchCount,
      filter_source: source,
    });
    if (error) throw error;
    ragReady = true;
    if (!data?.length) return '';

    const lines = data.map(
      (r, i) => `[${i + 1}] (${r.source}, sim ${(r.similarity ?? 0).toFixed(2)})\n${r.content}`
    );
    return `\nCONTEXTO RELEVANTE (base de conocimiento ChessInvest):\n${lines.join('\n\n')}\n`;
  } catch (err) {
    if (/match_chunks|knowledge_chunks|schema cache|does not exist/i.test(err.message || '')) {
      ragReady = false;
      logger.warn('RAG desactivado: falta migración supabase-v2-rag-newsletter.sql');
    } else {
      logger.warn(`RAG retrieve failed (continuing without context): ${err.message}`);
    }
    return '';
  }
}

// Ingiere documentos {content, source, lang} con embeddings (upsert por contenido exacto).
async function ingestChunks(docs) {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase not configured');
  const clean = (Array.isArray(docs) ? docs : []).filter((d) => d?.content);
  if (!clean.length) return { inserted: 0, skipped: 0 };

  const vectors = await embedTexts(clean.map((d) => d.content));
  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < clean.length; i++) {
    const vec = vectors[i];
    if (!vec) {
      skipped++;
      continue;
    }
    const doc = clean[i];
    const { data: existing } = await admin
      .from('knowledge_chunks')
      .select('id')
      .eq('content', doc.content)
      .limit(1)
      .single();
    if (existing) {
      skipped++;
      continue;
    }
    const { error } = await admin.from('knowledge_chunks').insert({
      content: doc.content,
      source: doc.source || 'manual',
      lang: doc.lang || 'es',
      embedding: vec,
    });
    if (error) {
      logger.warn(`ingest failed for chunk: ${error.message}`);
      skipped++;
    } else {
      inserted++;
    }
  }

  return { inserted, skipped };
}

module.exports = { retrieveContext, ingestChunks };
