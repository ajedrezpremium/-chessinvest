const config = require('../config');
const { getSupabaseAdmin } = require('./supabase');
const logger = require('./logger');

const TG_MAX = 4096;

function isConfigured() {
  return Boolean(config.telegram.botToken);
}

async function tgApi(method, payload) {
  if (!isConfigured()) throw new Error('Telegram not configured (TELEGRAM_BOT_TOKEN)');
  const res = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || res.status}`);
  return data.result;
}

function splitMessage(text, max = TG_MAX) {
  const str = String(text || '');
  if (str.length <= max) return [str];
  const parts = [];
  let rest = str;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) parts.push(rest);
  return parts;
}

async function sendToChat(chatId, text) {
  const parts = splitMessage(text);
  for (const part of parts) {
    await tgApi('sendMessage', { chat_id: chatId, text: part });
  }
  return parts.length;
}

function escapeMd(text) {
  return String(text || '').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function formatTop20Telegram(newsletter, items) {
  const date = new Date(newsletter.generated_at).toLocaleDateString('es-ES');
  const lines = [`♔ *CHESS INVEST — Top 20 IA* (${date})`, `_${escapeMd(newsletter.title || '')}_`, ''];
  items.slice(0, 20).forEach((it, i) => {
    const emoji = it.impact >= 80 ? '🔴' : it.impact >= 60 ? '🟡' : '🟢';
    const tickers = (it.tickers || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 4).join(' ');
    lines.push(`${emoji} *${i + 1}. ${escapeMd(it.title)}* (impacto ${it.impact})`);
    if (it.summary) lines.push(escapeMd(it.summary));
    if (tickers) lines.push(`_${escapeMd(tickers)}_`);
    lines.push('');
  });
  lines.push('_Solo informativo, no es asesoramiento financiero._');
  return lines.join('\n');
}

async function broadcastTop20(newsletter, items) {
  const out = { channel: false, dms: 0, errors: 0 };
  if (!isConfigured()) {
    logger.debug('Telegram broadcast skipped: not configured');
    return out;
  }
  const text = formatTop20Telegram(newsletter, items);

  if (config.telegram.channelId) {
    try {
      await sendToChat(config.telegram.channelId, text);
      out.channel = true;
    } catch (err) {
      out.errors++;
      logger.warn(`Telegram channel broadcast failed: ${err.message}`);
    }
  }

  try {
    const admin = getSupabaseAdmin();
    if (admin) {
      const { data: settings } = await admin
        .from('user_settings')
        .select('user_id, telegram_chat_id')
        .eq('telegram_enabled', 1);
      for (const s of settings || []) {
        if (!s.telegram_chat_id) continue;
        try {
          await sendToChat(s.telegram_chat_id, text);
          out.dms++;
        } catch (err) {
          out.errors++;
          logger.warn(`Telegram DM failed for user ${s.user_id}: ${err.message}`);
        }
      }
    }
  } catch (err) {
    logger.warn(`Telegram DM broadcast failed: ${err.message}`);
  }

  return out;
}

// Polling de /start [codigo] para vincular chats. Sin webhook: el scheduler lo llama cada 2 min.
async function pollTelegramUpdates() {
  if (!isConfigured()) return { polled: false };
  try {
    const admin = getSupabaseAdmin();
    let offset = null;
    if (admin) {
      const { data } = await admin.from('market_cache').select('value').eq('key', 'telegram:offset').single();
      if (data?.value) offset = Number(data.value) || null;
    }

    const params = new URLSearchParams({ timeout: '0' });
    if (offset) params.set('offset', String(offset));
    const res = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/getUpdates?${params}`);
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(data.description || 'getUpdates failed');

    let maxId = offset || 0;
    let linked = 0;
    for (const upd of data.result || []) {
      maxId = Math.max(maxId, (upd.update_id || 0) + 1);
      const msg = upd.message;
      if (!msg || typeof msg.text !== 'string') continue;
      const chatId = String(msg.chat?.id || '');
      if (!chatId || !msg.text.startsWith('/start')) continue;
      const code = msg.text.split(/\s+/)[1]?.trim().toUpperCase() || null;

      if (admin) {
        await admin.from('telegram_chats').upsert({
          chat_id: chatId,
          username: msg.chat?.username || msg.from?.username || null,
          active: 1,
        }, { onConflict: 'chat_id' });

        if (code) {
          const { data: settings } = await admin
            .from('user_settings')
            .select('user_id')
            .eq('telegram_link_code', code)
            .limit(1)
            .single();
          if (settings?.user_id) {
            await admin.from('user_settings').update({
              telegram_chat_id: chatId,
              telegram_enabled: 1,
              telegram_link_code: null,
              updated_at: new Date().toISOString(),
            }).eq('user_id', settings.user_id);
            await admin.from('telegram_chats').update({ user_id: settings.user_id }).eq('chat_id', chatId);
            await sendToChat(chatId, '✅ ChessInvest vinculado. Recibirás el Top 20 IA cada mañana. Gestiona tu suscripción en tu perfil.');
            linked++;
            continue;
          }
          await sendToChat(chatId, '⚠️ Código no válido. Genera uno nuevo en tu perfil de ChessInvest y envía: /start CODIGO');
        } else {
          await sendToChat(chatId, '👋 Para recibir el Top 20 IA, genera tu código en tu perfil de ChessInvest y envía: /start CODIGO');
        }
      }
    }

    if (admin && maxId !== (offset || 0)) {
      await admin.from('market_cache').upsert({
        key: 'telegram:offset',
        value: String(maxId),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    }

    return { polled: true, updates: (data.result || []).length, linked };
  } catch (err) {
    logger.warn(`Telegram poll failed: ${err.message}`);
    return { polled: false, error: err.message };
  }
}

async function generateLinkCode(userId) {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase not configured');
  const code = Array.from({ length: 6 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
  const { error } = await admin.from('user_settings').upsert({
    user_id: userId,
    telegram_link_code: code,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw error;
  const me = await tgApi('getMe', {});
  return { code, botUsername: me.username };
}

module.exports = {
  isConfigured,
  sendToChat,
  formatTop20Telegram,
  broadcastTop20,
  pollTelegramUpdates,
  generateLinkCode,
};
