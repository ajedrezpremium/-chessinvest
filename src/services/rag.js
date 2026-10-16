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
    let data = null;
    const vec = await embedText(query);
    if (vec) {
      try {
        const res = await admin.rpc('match_chunks', {
          query_embedding: vec,
          match_count: matchCount,
          filter_source: source,
        });
        if (res.error) throw res.error;
        data = res.data;
        ragReady = true;
        if (!data?.length) {
          // Híbrido: sin coincidencias vectoriales, probar léxico
          logger.debug('RAG vector empty, keyword fallback');
          data = await keywordSearch(admin, query, matchCount, source);
        }
      } catch (rpcErr) {
        if (/match_chunks|knowledge_chunks|schema cache|does not exist/i.test(rpcErr.message || '')) throw rpcErr;
        logger.warn(`RAG vector search failed, keyword fallback: ${rpcErr.message}`);
        data = await keywordSearch(admin, query, matchCount, source);
      }
    } else {
      data = await keywordSearch(admin, query, matchCount, source);
    }
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

// Búsqueda léxica (sin vectores): full-text español con unaccent (tildes + stemming).
// Si la función no existe (pre-migración), cae a ILIKE por palabras.
async function keywordSearch(admin, query, matchCount = 5, source = null) {
  try {
    const { data, error } = await admin.rpc('search_chunks', {
      query_text: String(query || '').slice(0, 500),
      match_count: matchCount,
    });
    if (error) throw error;
    let rows = data || [];
    if (source) rows = rows.filter((r) => r.source === source || String(r.source || '').startsWith(source + ':'));
    return rows;
  } catch (err) {
    logger.debug(`FTS fallback to ILIKE: ${err.message}`);
  }
  const STOP = new Set(['que', 'qué', 'como', 'cómo', 'para', 'porque', 'esta', 'este', 'esto', 'estoy', 'tiene', 'tienen', 'puedes', 'puedo', 'hace', 'hacer', 'sobre', 'entre', 'cuando', 'donde', 'dónde', 'cual', 'cuál', 'misma', 'mismo', 'mucho', 'hasta', 'desde', 'donde', 'the', 'and', 'with', 'what', 'does', 'cómo', 'dime', 'explica', 'cuéntame']);
  const words = String(query || '')
    .toLowerCase()
    .split(/[^a-záéíóúñü0-9]+/i)
    .filter((w) => w.length >= 2 && !STOP.has(w))
    .slice(0, 8);
  if (!words.length) return [];
  const ors = words.map((w) => `content.ilike.%${w}%`).join(',');
  let q = admin.from('knowledge_chunks').select('id, content, source').or(ors).limit(matchCount);
  if (source) q = q.eq('source', source);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map((r) => ({ ...r, similarity: null }));
}

// Ingiere documentos {content, source, lang} con embeddings (upsert por contenido exacto).
// Si no hay embeddings (sin crédito), guarda sin vector: la búsqueda por keywords sigue funcionando.
async function ingestChunks(docs) {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase not configured');
  const clean = (Array.isArray(docs) ? docs : []).filter((d) => d?.content);
  if (!clean.length) return { inserted: 0, skipped: 0 };

  const vectors = await embedTexts(clean.map((d) => d.content));
  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < clean.length; i++) {
    const vec = vectors[i] || null;
    const doc = clean[i];
    const { data: existing } = await admin
      .from('knowledge_chunks')
      .select('id, embedding')
      .eq('content', doc.content)
      .limit(1)
      .single();
    if (existing) {
      if (vec && !existing.embedding) {
        // Rellena el vector que faltaba (ingesta previa sin crédito)
        const { error } = await admin
          .from('knowledge_chunks')
          .update({ embedding: vec })
          .eq('id', existing.id);
        if (error) {
          logger.warn(`ingest backfill failed: ${error.message}`);
          skipped++;
        } else {
          inserted++;
        }
      } else {
        skipped++;
      }
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
