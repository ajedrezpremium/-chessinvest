const { run, all, get, saveDb } = require('./database');
const logger = require('./logger');
const { getAllIndices } = require('./marketDataService');
const { fetchEconomicCalendar, formatCalendarContext } = require('./economicCalendar');
const { callAI } = require('./aiProvider');
const { sendEmail } = require('./emailService');

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

async function generateNewsletterContent() {
  const indices = await getAllIndices();
  const calendar = await fetchEconomicCalendar();
  const calendarCtx = formatCalendarContext(calendar);

  const marketSummary = formatTopMovers(indices);
  const marketTable = indices.map(i =>
    `${i.name}: ${i.val} (${i.chg}) — ${i.dir === 'up' ? 'alcista' : 'bajista'}`
  ).join('\n');

  const prompt = `Eres el analista jefe de CHESS INVEST, un servicio de inteligencia artificial para inversores.

Genera un newsletter diario de inversión de 5-10 minutos de lectura con esta estructura EXACTA (usa los marcadores literales):

=== TITULO ===
Título atractivo del día

=== PANORAMA ===
Resumen ejecutivo de 2-3 párrafos sobre el estado actual de los mercados globales

=== TOP 10 NOTICIAS ===
1. 🔴 Título noticia — Explicación breve (1-2 líneas) y por qué importa
2. 🟢 ...
(10 ítems numerados con emojis según impacto: 🔴 alto, 🟡 medio, 🟢 positivo)

=== PARA HOY ===
3-5催化 eventos clave a vigilar hoy (decisiones de tipos, datos macro, resultados empresariales)

=== ESTRATEGIA ===
Recomendación general de posicionamiento para el día (defensivo, agresivo, esperar)

=== FRASE DEL DÍA ===
Una frase célebre sobre inversión o finanzas para cerrar

DATOS DEL MERCADO:
${marketSummary}

CALENDARIO ECONÓMICO:
${calendarCtx}

TABLA COMPLETA:
${marketTable}

IMPORTANTE: Escribe en español neutro, tono profesional pero accesible. Sin opiniones políticas. Enfocado en datos objetivos. No uses asteriscos ni markdown, solo texto plano.`;

  const response = await callAI({
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 3000,
    temperature: 0.7,
  });

  if (!response?.data?.content?.[0]?.text) {
    throw new Error('AI response missing content');
  }

  const raw = response.data.content[0].text;

  const titleMatch = raw.match(/=== TITULO ===\s*\n([\s\S]*?)(?=\n=== )/);
  const summaryMatch = raw.match(/=== PANORAMA ===\s*\n([\s\S]*?)(?=\n=== TOP 10)/);
  const top10Match = raw.match(/=== TOP 10 NOTICIAS ===\s*\n([\s\S]*?)(?=\n=== PARA HOY)/);

  const title = titleMatch?.[1]?.trim() || `Resumen diario ${new Date().toLocaleDateString('es-ES')}`;
  const summary = summaryMatch?.[1]?.trim() || '';
  const top10 = top10Match?.[1]?.trim() || '';
  const tickers = (top10.match(/\b[A-Z]{2,5}\b/g) || []).filter(t =>
    !['ES', 'EL', 'UN', 'QUE', 'DEL', 'LOS', 'LAS', 'POR', 'CON', 'UNA', 'SON'].includes(t)
  ).slice(0, 10).join(',');

  return { title, content: raw, summary, top_tickers: tickers };
}

async function generateDailyNewsletter() {
  try {
    const existing = get("SELECT id FROM newsletters WHERE generated_at >= datetime('now', '-1 day') ORDER BY generated_at DESC LIMIT 1");
    if (existing) {
      logger.info('Newsletter already generated today, skipping');
      return { id: existing.id, reused: true };
    }

    const { title, content, summary, top_tickers } = await generateNewsletterContent();

    const result = run(
      'INSERT INTO newsletters (title, content, summary, top_tickers) VALUES (?, ?, ?, ?)',
      [title, content, summary, top_tickers || null]
    );
    saveDb();
    logger.info(`Newsletter generated: "${title}" (id=${result.lastID})`);
    return { id: result.lastID, title, reused: false };
  } catch (err) {
    logger.error(`Failed to generate newsletter: ${err.message}`);
    return null;
  }
}

async function sendNewsletterToSubscribers(newsletterId) {
  try {
    let newsletter;
    if (newsletterId) {
      newsletter = get('SELECT * FROM newsletters WHERE id = ?', [newsletterId]);
    } else {
      newsletter = get("SELECT * FROM newsletters ORDER BY generated_at DESC LIMIT 1");
    }

    if (!newsletter) {
      logger.warn('No newsletter found to send');
      return { sent: 0 };
    }

    const subscribers = all(
      `SELECT u.id, u.email, u.username FROM users u
       JOIN user_settings s ON u.id = s.user_id
       WHERE s.newsletter_subscribed = 1 AND u.email IS NOT NULL AND u.email != ''`
    );

    if (!subscribers || subscribers.length === 0) {
      logger.info('No newsletter subscribers');
      return { sent: 0 };
    }

    let sent = 0;
    for (const user of subscribers) {
      const ok = await sendEmail(user.email, 'daily', {
        date: new Date().toLocaleDateString('es-ES'),
        summary: newsletter.content,
        username: user.username,
      });
      if (ok) sent++;
    }

    run('UPDATE newsletters SET sent_count = ? WHERE id = ?', [sent, newsletter.id]);
    saveDb();
    logger.info(`Newsletter sent to ${sent}/${subscribers.length} subscribers`);
    return { sent, total: subscribers.length };
  } catch (err) {
    logger.error(`Failed to send newsletter: ${err.message}`);
    return { sent: 0, error: err.message };
  }
}

async function getLatestNewsletter() {
  return get("SELECT * FROM newsletters ORDER BY generated_at DESC LIMIT 1") || null;
}

function getNewsletterSubscribers() {
  return all(
    `SELECT u.id, u.email, u.username FROM users u
     JOIN user_settings s ON u.id = s.user_id
     WHERE s.newsletter_subscribed = 1 AND u.email IS NOT NULL AND u.email != ''`
  );
}

module.exports = { generateDailyNewsletter, sendNewsletterToSubscribers, getLatestNewsletter, getNewsletterSubscribers };
