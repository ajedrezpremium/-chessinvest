const config = require('../config');
const logger = require('./logger');
const { safeParseRecomendaciones, safeParseAlertas } = require('./schemas');
const { buildMessages } = require('./promptBuilder');
const { getAllIndices } = require('./marketDataService');

const VALID_TYPES = ['recommendations', 'alerts', 'summary', 'executive', 'analysis'];

async function callAI(body) {
  const type = detectRequestType(body);
  const markets = await getAllIndices();

  if (config.openRouter.apiKey) {
    return callOpenRouter(body, type, markets);
  }
  if (config.anthropic.apiKey) {
    return callAnthropic(body, type, markets);
  }
  return buildFallbackResponse(type);
}

function detectRequestType(body) {
  const prompt = extractPrompt(body);
  if (prompt.includes('Genera exactamente 10 recomendaciones')) return 'recommendations';
  if (prompt.includes('Genera 6 alertas extraordinarias')) return 'alerts';
  if (prompt.includes('RESUMEN DIARIO DE MERCADOS')) return 'summary';
  if (prompt.includes('Resumen ejecutivo ultrabreve')) return 'executive';
  if (prompt.includes('Analiza el')) return 'analysis';
  return 'unknown';
}

async function callAnthropic(body) {
  logger.info('Calling Anthropic API');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.anthropic.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const data = safeParse(text);
  return { status: response.status, data };
}

async function callOpenRouter(body, type, markets) {
  logger.info('Calling OpenRouter API');
  const enriched = await buildMessages(type, extractPrompt(body), markets);

  const openRouterBody = mapAnthropicToOpenRouter({
    ...body,
    system: enriched.system,
    messages: [{ role: 'user', content: enriched.userMessage }],
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  let response;
  try {
    response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openRouter.apiKey}`,
        'HTTP-Referer': config.openRouter.referer,
        'X-Title': config.openRouter.appName,
      },
      body: JSON.stringify(openRouterBody),
      signal: controller.signal,
    });
  } catch (fetchErr) {
    clearTimeout(timeout);
    const msg = fetchErr.name === 'AbortError' ? 'OpenRouter request timed out after 25s' : `OpenRouter network error: ${fetchErr.message}`;
    logger.error(msg);
    return { status: 503, data: { error: msg } };
  }
  clearTimeout(timeout);

  const text = await response.text();
  let parsed = safeParse(text);

  if (!response.ok) {
    const errorMsg = parsed?.error?.message || parsed?.error || `OpenRouter error (${response.status})`;
    logger.error(`OpenRouter error: ${errorMsg}`);
    return { status: response.status, data: { error: errorMsg } };
  }

  if (!parsed) {
    logger.error('OpenRouter returned unparseable response');
    return { status: 502, data: { error: 'Invalid response from AI provider' } };
  }

  const normalized = mapOpenRouterToAnthropic(parsed);
  const validated = validateAIResponse(type, normalized);

  if (!validated.valid && validated.fallback) {
    logger.warn(`AI response validation failed for ${type}, using fallback`);
    return { status: 200, data: validated.fallback };
  }

  return { status: 200, data: validated.data };
}

function validateAIResponse(type, normalized) {
  const content = normalized.content?.[0]?.text || '';
  const raw = extractJSON(content);

  if (type === 'recommendations' && raw) {
    const result = safeParseRecomendaciones(raw);
    if (result.valid) return { valid: true, data: normalized };
    return { valid: false, fallback: textResponse(JSON.stringify(provideFallbackRecomendaciones())) };
  }

  if (type === 'alerts' && raw) {
    const result = safeParseAlertas(raw);
    if (result.valid) return { valid: true, data: normalized };
    return { valid: false, fallback: textResponse(JSON.stringify(provideFallbackAlertas())) };
  }

  if (type === 'recommendations' || type === 'alerts') {
    return { valid: false, fallback: textResponse(JSON.stringify({})) };
  }

  return { valid: true, data: normalized };
}

function extractJSON(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json|```/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return parsed;
  } catch {
    const braceStart = cleaned.indexOf('{');
    const braceEnd = cleaned.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd > braceStart) {
      try {
        return JSON.parse(cleaned.slice(braceStart, braceEnd + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function provideFallbackRecomendaciones() {
  return {
    acciones: [
      { ticker: 'MSFT', nombre: 'Microsoft', mercado: 'NASDAQ', precio: '428.15', variacion: '+1.1%', puntuacion: 89, criterios_met: 18, razon: 'Fortaleza relativa, caja sólida y momentum estable.', catalizador: 'Resultados trimestrales', riesgo: 'bajo', sector: 'Tecnologia' },
      { ticker: 'NVDA', nombre: 'NVIDIA', mercado: 'NASDAQ', precio: '132.40', variacion: '+2.4%', puntuacion: 91, criterios_met: 19, razon: 'Demanda de IA mantiene el impulso.', catalizador: 'Nuevo ciclo de producto', riesgo: 'medio', sector: 'Semiconductores' },
      { ticker: 'GOOGL', nombre: 'Alphabet', mercado: 'NASDAQ', precio: '178.92', variacion: '+0.8%', puntuacion: 84, criterios_met: 17, razon: 'Márgenes sólidos y múltiplo razonable.', catalizador: 'Expansión cloud e IA', riesgo: 'bajo', sector: 'Tecnologia' },
      { ticker: 'AMZN', nombre: 'Amazon', mercado: 'NASDAQ', precio: '191.34', variacion: '+1.5%', puntuacion: 83, criterios_met: 16, razon: 'Mejora operativa y AWS sólido.', catalizador: 'Demanda empresarial en nube', riesgo: 'medio', sector: 'Consumo/Cloud' },
      { ticker: 'META', nombre: 'Meta Platforms', mercado: 'NASDAQ', precio: '522.80', variacion: '+0.9%', puntuacion: 82, criterios_met: 16, razon: 'Ingresos publicitarios resilientes.', catalizador: 'Monetización IA', riesgo: 'medio', sector: 'Tecnologia' },
      { ticker: 'LLY', nombre: 'Eli Lilly', mercado: 'NYSE', precio: '811.20', variacion: '+0.6%', puntuacion: 80, criterios_met: 15, razon: 'Crecimiento estructural visible.', catalizador: 'Actualización fármacos', riesgo: 'bajo', sector: 'Salud' },
      { ticker: 'JPM', nombre: 'JPMorgan Chase', mercado: 'NYSE', precio: '214.55', variacion: '+0.5%', puntuacion: 78, criterios_met: 15, razon: 'Balance fuerte.', catalizador: 'Margen financiero', riesgo: 'bajo', sector: 'Financiero' },
      { ticker: 'AVGO', nombre: 'Broadcom', mercado: 'NASDAQ', precio: '168.47', variacion: '+1.7%', puntuacion: 86, criterios_met: 17, razon: 'Exposición alta a infraestructura IA.', catalizador: 'Contratos enterprise', riesgo: 'medio', sector: 'Semiconductores' },
      { ticker: 'V', nombre: 'Visa', mercado: 'NYSE', precio: '296.74', variacion: '+0.4%', puntuacion: 77, criterios_met: 14, razon: 'Modelo defensivo con crecimiento.', catalizador: 'Consumo internacional', riesgo: 'bajo', sector: 'Pagos' },
      { ticker: 'XOM', nombre: 'Exxon Mobil', mercado: 'NYSE', precio: '121.63', variacion: '+0.7%', puntuacion: 74, criterios_met: 14, razon: 'Caja robusta.', catalizador: 'Recompra de acciones', riesgo: 'medio', sector: 'Energia' },
    ],
  };
}

function provideFallbackAlertas() {
  return {
    alertas: [
      { tipo: 'geopolitico', nivel: 'critical', titulo: 'Tensión geopolítica en aumento', descripcion: 'Aumenta el riesgo sobre suministros energéticos globales.', impacto: 'alto', acciones_afectadas: ['XOM', 'CVX'], sector: 'Energia', direccion: 'negativo' },
      { tipo: 'tecnologia', nivel: 'neutral', titulo: 'Innovación en semiconductores', descripcion: 'Nuevos desarrollos en IA impulsan el sector.', impacto: 'alto', acciones_afectadas: ['NVDA', 'AVGO'], sector: 'Semiconductores', direccion: 'positivo' },
      { tipo: 'regulacion', nivel: 'neutral', titulo: 'Regulación tecnológica en Europa', descripcion: 'Nuevas normas de competencia para big tech.', impacto: 'medio', acciones_afectadas: ['META', 'GOOGL'], sector: 'Tecnologia', direccion: 'negativo' },
      { tipo: 'adquisicion', nivel: 'critical', titulo: 'Movimiento corporativo en salud', descripcion: 'Se especula con consolidación en el sector farmacéutico.', impacto: 'alto', acciones_afectadas: ['LLY', 'MRNA'], sector: 'Salud', direccion: 'positivo' },
      { tipo: 'producto', nivel: 'neutral', titulo: 'Lanzamiento disruptivo en cloud', descripcion: 'Nueva plataforma empresarial podría redefinir el mercado.', impacto: 'medio', acciones_afectadas: ['AMZN', 'MSFT'], sector: 'Tecnologia', direccion: 'positivo' },
      { tipo: 'contratacion', nivel: 'neutral', titulo: 'Talento clave en inteligencia artificial', descripcion: 'Contratación estratégica en una empresa líder de IA.', impacto: 'medio', acciones_afectadas: ['META', 'GOOGL'], sector: 'Tecnologia', direccion: 'positivo' },
    ],
  };
}

async function buildFallbackResponse(type) {
  logger.warn(`No API key — fallback for type: ${type}`);

  const fallbacks = {
    recommendations: textResponse(JSON.stringify(provideFallbackRecomendaciones())),
    alerts: textResponse(JSON.stringify(provideFallbackAlertas())),
    summary: textResponse(
      [
        '## Apertura y tono general',
        'Sesión con tono moderadamente constructivo. Mercado operando con cautela selectiva.',
        '',
        '## Movimientos destacados',
        'Rotación hacia calidad con liderazgo de tecnología. Mercados globales mixtos.',
        '',
        '## Conclusión',
        'Entorno de incertidumbre controlada. Posicionamiento defensivo con sesgo selectivo.',
      ].join('\n')
    ),
    executive: textResponse(
      'Sesión mixta con tono constructivo. Tecnología lidera. Cautela en sectores cíclicos. Posicionamiento escalonado.'
    ),
    analysis: textResponse(
      [
        '## Situación técnica',
        'Mercado mantiene estructura constructiva de corto plazo.',
        '',
        '## Factores clave',
        '- Tipos estables sostienen múltiplos de crecimiento.',
        '- Rotación sectorial hacia calidad.',
        '',
        '## Perspectiva',
        'Continuidad con volatilidad controlada mientras se respeten soportes.',
      ].join('\n')
    ),
  };

  return { status: 200, data: fallbacks[type] || textResponse('Modo demostración — configura una API key en .env') };
}

function mapAnthropicToOpenRouter(body) {
  const system =
    typeof body.system === 'string' && body.system
      ? [{ role: 'system', content: body.system }]
      : [];
  const messages = Array.isArray(body.messages)
    ? body.messages.map((m) => ({
        role: m.role,
        content: flattenContent(m.content),
      }))
    : [];

  return {
    model: config.openRouter.model,
    messages: system.concat(messages),
    max_tokens: body.max_tokens || 1000,
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
    reasoning: {
      effort: config.openRouter.reasoningEffort,
      exclude: true,
    },
  };
}

function mapOpenRouterToAnthropic(payload) {
  const choice = payload?.choices?.[0] || null;
  const message = choice?.message || {};
  const text = typeof message.content === 'string' ? message.content : '';

  return {
    id: payload.id || 'msg_openrouter',
    type: 'message',
    role: 'assistant',
    model: payload.model || config.openRouter.model,
    content: [{ type: 'text', text }],
    stop_reason: choice?.finish_reason || 'end_turn',
    usage: {
      input_tokens: payload.usage?.prompt_tokens || 0,
      output_tokens: payload.usage?.completion_tokens || 0,
    },
  };
}

function flattenContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => (item?.type === 'text' ? item.text : ''))
    .filter(Boolean)
    .join('\n');
}

function extractPrompt(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return messages
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('\n');
}

function textResponse(text) {
  return {
    id: 'msg_' + (config.openRouter.apiKey ? 'openrouter' : 'mock'),
    type: 'message',
    role: 'assistant',
    model: config.openRouter.apiKey ? config.openRouter.model : 'mock-dev',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function callAIStream(body, onToken, onDone) {
  if (!config.openRouter.apiKey) {
    const fallback = await buildFallbackResponse(detectRequestType(body));
    const text = fallback.data?.content?.[0]?.text || '';
    for (let i = 0; i < text.length; i += 10) {
      onToken(text.slice(i, i + 10));
    }
    if (onDone) onDone({ content: [{ text }] });
    return;
  }

  const type = detectRequestType(body);
  const markets = await getAllIndices();
  const enriched = await buildMessages(type, extractPrompt(body), markets);

  const openRouterBody = mapAnthropicToOpenRouter({
    ...body,
    system: enriched.system,
    messages: [{ role: 'user', content: enriched.userMessage }],
  });
  openRouterBody.stream = true;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openRouter.apiKey}`,
        'HTTP-Referer': config.openRouter.referer,
        'X-Title': config.openRouter.appName,
      },
      body: JSON.stringify(openRouterBody),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      logger.error(`OpenRouter stream error: ${errText}`);
      const fallback = await buildFallbackResponse(type);
      const fbText = fallback.data?.content?.[0]?.text || '';
      onToken(fbText);
      if (onDone) onDone({ content: [{ text: fbText }], fallback: true });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed?.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullText += delta;
            onToken(delta);
          }
        } catch {
          // skip malformed JSON lines
        }
      }
    }

    if (onDone) onDone({ content: [{ text: fullText }] });
  } catch (err) {
    clearTimeout(timeout);
    const msg = err.name === 'AbortError' ? 'Stream timed out' : err.message;
    logger.error(`Stream error: ${msg}`);
    const fallback = await buildFallbackResponse(type);
    const fbText = fallback.data?.content?.[0]?.text || '';
    onToken(fbText);
    if (onDone) onDone({ content: [{ text: fbText }], fallback: true });
  }
}

module.exports = { callAI, callAIStream };
