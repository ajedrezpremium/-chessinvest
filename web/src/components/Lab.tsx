'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getApiUrl } from '@/lib/api';

async function authedPost<T>(path: string, body: unknown): Promise<T> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${getApiUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(parsed.error || `Error ${res.status}`);
  return parsed as T;
}

function renderMarkdown(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<h3 style="color:var(--accent);font-size:13px;margin:12px 0 6px">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

export function AnalyzerBox() {
  const [ticker, setTicker] = useState('');
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function analyze(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await authedPost<{ analysis: string }>(
        '/api/analyzer/analyze',
        { ticker },
      );
      setHtml(renderMarkdown(data.analysis || 'Sin análisis.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <form onSubmit={analyze} style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'end' }}>
        <div className="field">
          <label>Ticker</label>
          <input
            className="input"
            style={{ width: 180, textTransform: 'uppercase', fontFamily: 'monospace' }}
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="AAPL, SAN, MSFT"
            required
          />
        </div>
        <button className="btn" disabled={loading}>
          {loading ? 'Analizando...' : 'Analizar'}
        </button>
      </form>
      {error && <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>}
      {html ? (
        <div style={{ fontSize: 14, lineHeight: 1.8 }} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        !loading && (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>
            Introduce un ticker para obtener un informe profesional.
          </p>
        )
      )}
    </div>
  );
}

interface ChatMsg {
  role: 'user' | 'ai';
  text: string;
}

export function ChatBox() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setLoading(true);
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }]);
    try {
      const data = await authedPost<{ response: string }>('/api/analyzer/chat', {
        message: text,
      });
      setMessages((m) => [...m, { role: 'ai', text: data.response }]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: 'ai', text: `Error: ${err instanceof Error ? err.message : 'conexión'}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div
        style={{
          maxHeight: 400,
          overflowY: 'auto',
          marginBottom: 16,
          padding: 10,
          background: 'var(--bg4)',
          borderRadius: 12,
          minHeight: 200,
        }}
      >
        {!messages.length && (
          <p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>
            Hola, soy tu <strong style={{ color: 'var(--accent)' }}>Amigo Inversor</strong>.
            Pregúntame lo que quieras.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 12, display: 'flex', gap: 10, flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
            <div
              style={{
                maxWidth: '80%',
                padding: '10px 14px',
                borderRadius: 12,
                fontSize: 13,
                lineHeight: 1.6,
                background: m.role === 'user' ? 'var(--accent)' : 'var(--bg3)',
                color: m.role === 'user' ? '#000' : 'var(--text)',
                border: m.role === 'ai' ? '1px solid var(--border)' : 'none',
              }}
              dangerouslySetInnerHTML={
                m.role === 'ai' ? { __html: renderMarkdown(m.text) } : undefined
              }
            >
              {m.role === 'user' ? m.text : undefined}
            </div>
          </div>
        ))}
        {loading && <p style={{ color: 'var(--muted)', fontSize: 13, fontStyle: 'italic' }}>Pensando...</p>}
      </div>
      <form onSubmit={send} style={{ display: 'flex', gap: 10 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribe tu pregunta..."
        />
        <button className="btn" disabled={loading}>
          Enviar
        </button>
      </form>
    </div>
  );
}
