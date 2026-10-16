'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getApiUrl } from '@/lib/api';

async function authedFetch(path: string, init?: RequestInit) {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sesión expirada. Entra de nuevo.');
  const res = await fetch(`${getApiUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
  return body;
}

export function AddWatchlistForm() {
  const router = useRouter();
  const [ticker, setTicker] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authedFetch('/api/portfolio/watchlist', {
        method: 'POST',
        body: JSON.stringify({ ticker }),
      });
      setTicker('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
      <div className="field">
        <label>Ticker</label>
        <input
          className="input"
          style={{ width: 110, textTransform: 'uppercase' }}
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="AAPL"
          required
        />
      </div>
      <button className="btn" disabled={loading}>
        + Añadir
      </button>
      {error && <span style={{ color: 'var(--red)', fontSize: 12 }}>{error}</span>}
    </form>
  );
}

export function AddPositionForm() {
  const router = useRouter();
  const [ticker, setTicker] = useState('');
  const [shares, setShares] = useState('');
  const [avgPrice, setAvgPrice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authedFetch('/api/portfolio/portfolio', {
        method: 'POST',
        body: JSON.stringify({
          ticker,
          shares: Number(shares),
          avg_price: Number(avgPrice),
        }),
      });
      setTicker('');
      setShares('');
      setAvgPrice('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
      <div className="field">
        <label>Ticker</label>
        <input
          className="input"
          style={{ width: 90, textTransform: 'uppercase' }}
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="AAPL"
          required
        />
      </div>
      <div className="field">
        <label>Acciones</label>
        <input
          className="input"
          style={{ width: 80 }}
          type="number"
          step="any"
          value={shares}
          onChange={(e) => setShares(e.target.value)}
          placeholder="10"
          required
        />
      </div>
      <div className="field">
        <label>Precio medio</label>
        <input
          className="input"
          style={{ width: 100 }}
          type="number"
          step="any"
          value={avgPrice}
          onChange={(e) => setAvgPrice(e.target.value)}
          placeholder="150.00"
          required
        />
      </div>
      <button className="btn" disabled={loading}>
        + Añadir
      </button>
      {error && <span style={{ color: 'var(--red)', fontSize: 12 }}>{error}</span>}
    </form>
  );
}

export function RemoveButton({ path, label }: { path: string; label: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function remove() {
    if (!confirm(`Eliminar ${label}?`)) return;
    setLoading(true);
    try {
      await authedFetch(path, { method: 'DELETE' });
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      className="btn btn-outline"
      style={{ padding: '4px 10px', fontSize: 11 }}
      onClick={remove}
      disabled={loading}
    >
      ✕
    </button>
  );
}
