const { getSupabaseAdmin } = require('./supabase');
const logger = require('./logger');
const { getAllIndices } = require('./marketDataService');
const { fetchEconomicCalendar, formatCalendarContext } = require('./economicCalendar');
const { callAI } = require('./aiProvider');
const { sendEmail } = require('./emailService');
const { ingestChunks } = require('./rag');
const { sendToChat, isConfigured: telegramConfigured } = require('./telegramService');
const config = require('../config');

function formatIndexChange(idx) {
  const emoji = idx.dir === 'up' ? '📈' : '📉';
  return `${emoji} ${idx.name}: ${idx.val} (${idx.chg})`;
}

function formatTopMovers(indices) {
  const sorted = [...indices].sort((a, b) => {
    const aPct = parseFloat(a.chg) || 0;
    const bPct = parseFloat(b.chg) || 0;
    return Math.abs(bPct) - Math.abs(aPct);
  });
  return sorted.slice(0, 5).map(formatIndexChange).join('\n');
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Filtro por temas ('all' o lista separada por comas) e impacto mínimo.
// Los temas se buscan en sector + título + resumen (insensible a mayúsculas).
function filterItems(items, topicsStr, minImpact = 0) {
  const min = Number(minImpact) || 0;
  let list = (items || []).filter((it) => (Number(it.impact) || 0) >= min);
  const topics = String(topicsStr || 'all')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (!topics.length || topics.includes('all') || topics.includes('todo') || topics.includes('todas')) {
    return list;
  }
  return list.filter((it) => {
    const hay = `${it.sector || ''} ${it.title || ''} ${it.summary || ''}`.toLowerCase();
    return topics.some((t) => hay.includes(t));
  });
}

function sanitizeItem(raw, rank) {
  const tickers = Array.isArray(raw.tickers)
    ? raw.tickers.join(',')
    : String(raw.tickers || '');
  return {
    rank,
    title: String(raw.title || 'Sin título').slice(0, 200),
    summary: String(raw.summary || '').slice(0, 600),
    why_matters: String(raw.why_matters || raw.whyMatters || '').slice(0, 600),
    tickers: tickers
      .toUpperCase()
      .split(/[^A-Z]+/)
      .filter((t) => t.length >= 1 && t.length <= 6)
      .slice(0, 8)
      .join(','),
    impact: Math.max(0, Math.min(100, Number(raw.impact) || 50)),
    sector: String(raw.sector || 'General').slice(0, 60),
    direction: ['positivo', 'negativo', 'neutral'].includes(String(raw.direction || '').toLowerCase())
      ? String(raw.direction).toLowerCase()
      : 'neutral',
  };
}

async function generateTop20() {
  const indices = await getAllIndices();
  const calendar = await fetchEconomicCalendar();
  const calendarCtx = formatCalendarContext(calendar);
  const marketSummary = formatTopMovers(indices);
  const marketTable = indices.map(i =>
    `${i.name}: ${i.val} (${i.chg}) — ${i.dir === 'up' ? 'alcista' : 'bajista'}`
  ).join('\n');
  const today = new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const prompt = `Eres el analista jefe de CHESS INVEST. Hoy es ${today}.

Genera la edición "Top 20 IA": las 20 noticias financieras MÁS impactantes del día (impacto 0-100 según relevancia, sorpresa y efecto probable en carteras).

DATOS DEL MERCADO:
${marketSummary}

CALENDARIO ECONÓMICO:
${calendarCtx}

TABLA COMPLETA:
${marketTable}

Responde SOLO JSON válido (sin markdown, sin backticks) con este formato:
{"title":"...","panorama":"2-3 párrafos ejecutivos","items":[{"title":"...","summary":"1-2 líneas","why_matters":"por qué importa al inversor","tickers":["AAPL"],"impact":85,"sector":"Tecnología","direction":"positivo"}]}

Reglas: 20 items ordenados por impacto descendente; sectores variados (tecnología, energía, macro, salud, financiero...); tickers en mayúsculas (vacío [] si no aplica); español neutro, sin política, sin asteriscos. Incluye SIEMPRE el disclaimer final en panorama: "Solo informativo, no es asesoramiento financiero."`;

  // Extrae el mayor objeto {...} balanceado (ignora preámbulos tipo "User Safety: safe")
  function balancedObjects(text) {
    const spans = [];
    let depth = 0;
    let start = -1;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          spans.push(text.slice(start, i + 1));
          start = -1;
        }
        if (depth < 0) depth = 0;
      }
    }
    return spans.sort((a, b) => b.length - a.length);
  }

  async function tryParse(text) {
    const cleaned = String(text || '').replace(/```json|```/g, '').trim();
    const candidates = [cleaned, ...balancedObjects(cleaned)];
    for (const cand of candidates) {
      try {
        const p = JSON.parse(cand);
        if (p && Array.isArray(p.items) && p.items.length) return p;
      } catch { /* siguiente */ }
      // Reparación: comas colgantes
      try {
        const fixed = cand.replace(/,\s*([}\]])/g, '$1');
        const p = JSON.parse(fixed);
        if (p && Array.isArray(p.items) && p.items.length) return p;
      } catch { /* siguiente */ }
    }
    return null;
  }

  // El modelo free es pequeño: pedir 20 items de golpe falla. 2 tandas de 10.
  async function requestBatch(focus, n) {
    const batchPrompt = `${prompt}\n\nEN ESTA TANDA genera EXACTAMENTE ${n} items con enfoque en: ${focus}.\nRESPONDE ÚNICAMENTE CON EL JSON, SIN NINGÚN TEXTO ANTES NI DESPUÉS.`;
    const response = await callAI({
      messages: [{ role: 'user', content: batchPrompt }],
      max_tokens: 3000,
      temperature: 0.5,
    });
    const text = response?.data?.content?.[0]?.text || '';
    const parsed = await tryParse(text);
    if (!parsed) {
      logger.warn(`Top20 tanda "${focus}" sin JSON (preview): ${text.slice(0, 200)}`);
      return [];
    }
    return parsed.items || [];
  }

  const [batchA, batchB] = await Promise.all([
    requestBatch('mercados, índices, macroeconomía, tipos, divisas y materias primas', 10),
    requestBatch('empresas, resultados, tecnología, energía, salud y financiero', 10),
  ]);

  const seen = new Set();
  const merged = [];
  for (const raw of [...batchA, ...batchB]) {
    const key = String(raw.title || '').toLowerCase().slice(0, 60);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(raw);
  }
  const parsed = { items: merged };
  if (!parsed.items.length) {
    throw new Error('Top20 JSON inválido de la IA');
  }
  // Título y panorama: derivar sin llamada extra
  parsed.title = `Top 20 IA — ${new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}`;
  const top3 = merged.slice(0, 3).map((m) => m.title).join('; ');
  parsed.panorama = `Edición con ${merged.length} noticias destacadas: ${top3}. Solo informativo, no es asesoramiento financiero.`;

  const items = parsed.items
    .slice(0, 25)
    .map((raw, i) => sanitizeItem(raw, i + 1))
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 20)
    .map((it, i) => ({ ...it, rank: i + 1 }));

  return {
    title: String(parsed.title || `Top 20 IA — ${today}`).slice(0, 200),
    panorama: String(parsed.panorama || '').slice(0, 3000),
    items,
  };
}

function renderItemsText(title, panorama, items) {
  const lines = [`=== TITULO ===\n${title}`, `\n=== PANORAMA ===\n${panorama}`, '\n=== TOP 20 NOTICIAS ==='];
  items.forEach((it) => {
    const emoji = it.impact >= 80 ? '🔴' : it.impact >= 60 ? '🟡' : '🟢';
    lines.push(`${it.rank}. ${emoji} ${it.title} (impacto ${it.impact}) — ${it.summary} Por qué importa: ${it.why_matters} [${it.tickers || '—'}]`);
  });
  return lines.join('\n');
}

async function generateDailyNewsletter() {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) throw new Error('Supabase not configured');

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await admin
      .from('newsletters')
      .select('id')
      .gte('generated_at', cutoff)
      .order('generated_at', { ascending: false })
      .limit(1)
      .single();

    if (existing) {
      logger.info('Newsletter already generated today, skipping');
      return { id: existing.id, reused: true };
    }

    const { title, panorama, items } = await generateTop20();
    const content = renderItemsText(title, panorama, items);
    const top_tickers = [...new Set(items.flatMap((it) => (it.tickers || '').split(',').filter(Boolean)))].slice(0, 10).join(',');

    const { data, error } = await admin
      .from('newsletters')
      .insert({ title, content, summary: panorama, top_tickers: top_tickers || null })
      .select('id')
      .single();
    if (error) throw error;

    const rows = items.map((it) => ({ ...it, newsletter_id: data.id }));
    const { error: itemsError } = await admin.from('newsletter_items').insert(rows);
    if (itemsError) throw itemsError;

    // Alimentar el RAG con la edición del día (no bloqueante)
    ingestChunks(items.map((it) => ({
      content: `${it.title}. ${it.summary} Por qué importa: ${it.why_matters} (Tickers: ${it.tickers || '—'}, sector: ${it.sector}, impacto: ${it.impact})`,
      source: `newsletter:${new Date().toISOString().slice(0, 10)}`,
      lang: 'es',
    }))).then(
      (r) => logger.info(`Newsletter RAG ingest: ${r.inserted} chunks`),
      (e) => logger.warn(`Newsletter RAG ingest failed: ${e.message}`)
    );

    logger.info(`Newsletter Top20 generated: "${title}" (id=${data.id}, ${items.length} items)`);
    return { id: data.id, title, reused: false, items: items.length };
  } catch (err) {
    logger.error(`Failed to generate newsletter: ${err.message}`);
    return null;
  }
}

function buildEmailHtml(newsletter, items, username) {
  const date = new Date(newsletter.generated_at).toLocaleDateString('es-ES');
  const rows = items.map((it) => {
    const color = it.impact >= 80 ? '#ff4444' : it.impact >= 60 ? '#ffb300' : '#00e676';
    return `<div style="padding:12px 0;border-bottom:1px solid rgba(0,212,255,0.1)">
      <div style="font-size:14px;font-weight:bold;color:#e8f4f8">${it.rank}. ${escapeHtml(it.title)}</div>
      <div style="margin-top:4px"><span style="display:inline-block;font-size:11px;font-weight:bold;color:${color};border:1px solid ${color};border-radius:10px;padding:1px 8px">impacto ${it.impact}</span>
      ${it.tickers ? `<span style="font-size:11px;color:#00d4ff;font-family:monospace;margin-left:8px">${escapeHtml(it.tickers)}</span>` : ''}</div>
      <div style="font-size:13px;color:#7a9bb5;margin-top:6px;line-height:1.6">${escapeHtml(it.summary)}</div>
      ${it.why_matters ? `<div style="font-size:12px;color:#7a9bb5;margin-top:4px"><em>Por qué importa:</em> ${escapeHtml(it.why_matters)}</div>` : ''}
    </div>`;
  }).join('');

  return {
    subject: `📈 Top 20 IA — ${date}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0e1a;color:#e8f4f8;border-radius:16px;overflow:hidden;border:1px solid rgba(0,212,255,0.15)">
      <div style="background:linear-gradient(135deg,#00d4ff,#0099cc);padding:20px;text-align:center">
        <h1 style="margin:0;font-size:20px;color:#000">♔ CHESS INVEST — Top 20 IA</h1>
        <p style="margin:4px 0 0;font-size:12px;color:rgba(0,0,0,0.7)">${escapeHtml(date)}${username ? ` · Hola ${escapeHtml(username)}` : ''}</p>
      </div>
      <div style="padding:24px">
        <p style="font-size:13px;line-height:1.7;color:#7a9bb5">${escapeHtml(newsletter.summary || '')}</p>
        ${rows || '<p style="font-size:13px;color:#7a9bb5">Hoy no hay noticias para tus filtros. Ajusta temas o impacto mínimo en tu perfil.</p>'}
        <a href="${config.appUrl}/newsletter" style="display:block;text-align:center;padding:12px;margin-top:16px;background:#00d4ff;color:#000;border-radius:8px;text-decoration:none;font-weight:bold;font-size:14px">Leer en la web</a>
        <p style="font-size:11px;color:#7a9bb5;margin-top:16px">Solo informativo, no es asesoramiento financiero.</p>
      </div>
    </div>`,
  };
}

async function getNewsletterItems(newsletterId) {
  const admin = getSupabaseAdmin();
  if (!admin) return [];
  const { data, error } = await admin
    .from('newsletter_items')
    .select('*')
    .eq('newsletter_id', newsletterId)
    .order('rank', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getTodayNewsletter() {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const { data: nl } = await admin
    .from('newsletters')
    .select('*')
    .order('generated_at', { ascending: false })
    .limit(1)
    .single();
  if (!nl) return null;
  const items = await getNewsletterItems(nl.id).catch(() => []);
  return { ...nl, items };
}

async function sendNewsletterToSubscribers(newsletterId) {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) throw new Error('Supabase not configured');

    let newsletter = null;
    if (newsletterId) {
      const { data } = await admin.from('newsletters').select('*').eq('id', newsletterId).single();
      newsletter = data;
    } else {
      const { data } = await admin.from('newsletters').select('*').order('generated_at', { ascending: false }).limit(1).single();
      newsletter = data;
    }

    if (!newsletter) {
      logger.warn('No newsletter found to send');
      return { sent: 0 };
    }

    const items = await getNewsletterItems(newsletter.id).catch(() => []);

    const { data: settings } = await admin
      .from('user_settings')
      .select('user_id, newsletter_topics, newsletter_min_impact, telegram_chat_id, telegram_enabled')
      .eq('newsletter_subscribed', 1);

    const userIds = (settings || []).map((s) => s.user_id);
    let subscribers = [];
    if (userIds.length) {
      const { data: users } = await admin
        .from('users')
        .select('id, email, username')
        .in('id', userIds);
      subscribers = (users || [])
        .filter((u) => u.email)
        .map((u) => ({ ...u, prefs: (settings || []).find((s) => s.user_id === u.id) || {} }));
    }

    if (!subscribers.length) {
      logger.info('No newsletter subscribers');
    }

    let sent = 0;
    let telegramDMs = 0;
    for (const user of subscribers) {
      const prefs = user.prefs || {};
      const mine = filterItems(items, prefs.newsletter_topics, prefs.newsletter_min_impact);
      const { subject, html } = buildEmailHtml(newsletter, mine, user.username);
      // sendEmail con html directo: usamos plantilla 'daily' sobrescribiendo vía tipo custom
      const ok = await sendEmail(user.email, 'daily', {
        date: new Date(newsletter.generated_at).toLocaleDateString('es-ES'),
        summary: html,
        username: user.username,
        _html: html,
        _subject: subject,
      });
      if (ok) sent++;

      if (telegramConfigured() && prefs.telegram_enabled && prefs.telegram_chat_id && mine.length) {
        try {
          const { formatTop20Telegram } = require('./telegramService');
          await sendToChat(prefs.telegram_chat_id, formatTop20Telegram(newsletter, mine));
          telegramDMs++;
        } catch (err) {
          logger.warn(`Telegram DM failed for ${user.email}: ${err.message}`);
        }
      }
    }

    // Canal público de Telegram (edición completa)
    let telegramChannel = false;
    if (telegramConfigured() && config.telegram.channelId && items.length) {
      try {
        const { formatTop20Telegram, sendToChat: sendChat } = require('./telegramService');
        await sendChat(config.telegram.channelId, formatTop20Telegram(newsletter, items));
        telegramChannel = true;
      } catch (err) {
        logger.warn(`Telegram channel broadcast failed: ${err.message}`);
      }
    }

    await admin.from('newsletters').update({ sent_count: sent }).eq('id', newsletter.id);
    logger.info(`Newsletter sent to ${sent}/${subscribers.length} email + ${telegramDMs} TG DM (canal: ${telegramChannel})`);
    return { sent, total: subscribers.length, telegramDMs, telegramChannel };
  } catch (err) {
    logger.error(`Failed to send newsletter: ${err.message}`);
    return { sent: 0, error: err.message };
  }
}

async function getLatestNewsletter() {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return null;
    const { data } = await admin.from('newsletters').select('*').order('generated_at', { ascending: false }).limit(1).single();
    return data || null;
  } catch {
    return null;
  }
}

async function getNewsletterSubscribers() {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return [];
    const { data: settings } = await admin
      .from('user_settings')
      .select('user_id')
      .eq('newsletter_subscribed', 1);
    const userIds = (settings || []).map((s) => s.user_id);
    if (!userIds.length) return [];
    const { data: users } = await admin
      .from('users')
      .select('id, email, username')
      .in('id', userIds);
    return (users || []).filter((u) => u.email);
  } catch {
    return [];
  }
}

module.exports = {
  generateDailyNewsletter,
  sendNewsletterToSubscribers,
  getLatestNewsletter,
  getNewsletterSubscribers,
  getNewsletterItems,
  getTodayNewsletter,
  filterItems,
  buildEmailHtml,
};
