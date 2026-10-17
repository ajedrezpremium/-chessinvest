const { Router } = require('express');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const logger = require('../services/logger');

const router = Router();

// STT Whisper vía endpoint OpenAI-compatible (Groq por defecto, tier gratuito).
// Env: STT_API_KEY, STT_BASE_URL (default groq), STT_MODEL (default whisper-large-v3).
const MAX_AUDIO_BYTES = 2 * 1024 * 1024; // 2MB ≈ ~1 min opus

router.post('/stt', requireAuth, async (req, res) => {
  const key = process.env.STT_API_KEY || '';
  if (!key) {
    // Noquirer res 501 para que el front guíe al usuario
    return res.status(501).json({
      error: 'Dictado Whisper no configurado (falta STT_API_KEY). El dictado nativo sigue disponible en Chrome/Edge.',
    });
  }
  const { audio, mime } = req.body || {};
  if (!audio || typeof audio !== 'string') {
    return res.status(400).json({ error: 'Falta el audio' });
  }
  const sizeBytes = Buffer.from(audio, 'base64').length;
  if (sizeBytes > MAX_AUDIO_BYTES) {
    return res.status(413).json({ error: 'Audio demasiado largo (máx ~1 minuto)' });
  }
  const base = process.env.STT_BASE_URL || 'https://api.groq.com/openai/v1';
  const model = process.env.STT_MODEL || 'whisper-large-v3';
  try {
    const blob = new Blob([Buffer.from(audio, 'base64')], { type: mime || 'audio/webm' });
    const form = new FormData();
    form.append('file', blob, 'audio.webm');
    form.append('model', model);
    form.append('language', 'es');
    form.append('response_format', 'json');
    form.append('temperature', '0');
    const t0 = Date.now();
    const r = await fetch(`${base}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      logger.warn(`STT provider ${r.status}: ${JSON.stringify(d).slice(0, 200)}`);
      return res.status(r.status === 429 ? 429 : 502).json({ error: d.error?.message || 'Proveedor de transcripción falló' });
    }
    logger.info(`STT ok (${sizeBytes}B → ${(d.text || '').length} chars, ${Date.now() - t0}ms)`);
    res.json({ text: d.text || '' });
  } catch (err) {
    logger.error(`STT error: ${err.message}`);
    res.status(502).json({ error: 'Error transcribiendo el audio' });
  }
});

module.exports = router;
