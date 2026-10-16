// Cliente tipado de la API Express (Render en prod, localhost:3000 en dev).
// En Server Components se pasa el access token de Supabase (misma sesión,
// el backend lo valida por JWKS). En cliente, getApiUrl() + Bearer manual.

export function getApiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL || 'https://chessinvest.onrender.com';
}

export interface MarketIndex {
  id: string;
  name: string;
  region: string;
  regionLabel: string;
  country: string;
  symbol: string;
  val: string;
  chg: string;
  pts: string;
  dir: 'up' | 'down';
  vol: string;
  spark?: number[];
  state: string;
  source: 'live' | 'cache' | 'cache-stale' | 'fallback';
}

export interface RegionGroup {
  label: string;
  order: number;
  markets: MarketIndex[];
  stats: { total: number; up: number; down: number };
}

export interface PortfolioItem {
  id: string;
  ticker: string;
  shares: number;
  avg_price: number;
  added_at: string;
}

export interface WatchItem {
  id: string;
  ticker: string;
  added_at: string;
}

export interface ProfileSummary {
  user: {
    id: string;
    email: string;
    username: string;
    role: string;
    avatar: string;
    created_at: string;
  };
  subscription: { plan: string; status: string } | null;
  settings: Record<string, unknown> | null;
  stats: {
    goalsCount: number;
    ideasCount: number;
    activeAlerts: number;
    watchlistCount: number;
    portfolioCount: number;
  };
}

async function apiFetch<T>(
  path: string,
  token?: string | null,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${getApiUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `API ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  markets: () =>
    apiFetch<{ regions: Record<string, RegionGroup> }>('/api/markets'),
  marketsFlat: () => apiFetch<{ markets: MarketIndex[] }>('/api/markets/flat'),
  status: () => apiFetch<Record<string, unknown>>('/api/status'),
  me: (token: string) => apiFetch('/api/auth/me', token),
  portfolio: (token: string) =>
    apiFetch<{ portfolio: PortfolioItem[] }>('/api/portfolio/portfolio', token),
  watchlist: (token: string) =>
    apiFetch<{ watchlist: WatchItem[] }>('/api/portfolio/watchlist', token),
  profileSummary: (token: string) =>
    apiFetch<ProfileSummary>('/api/profile/summary', token),
  addPortfolio: (token: string, body: { ticker: string; shares: number; avg_price: number }) =>
    apiFetch('/api/portfolio/portfolio', token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  removePortfolio: (token: string, ticker: string) =>
    apiFetch(`/api/portfolio/portfolio/${ticker}`, token, { method: 'DELETE' }),
  addWatchlist: (token: string, ticker: string) =>
    apiFetch('/api/portfolio/watchlist', token, {
      method: 'POST',
      body: JSON.stringify({ ticker }),
    }),
  removeWatchlist: (token: string, ticker: string) =>
    apiFetch(`/api/portfolio/watchlist/${ticker}`, token, { method: 'DELETE' }),
  analyze: (token: string | null, ticker: string) =>
    apiFetch<{ ticker: string; analysis: string; fallback?: boolean }>(
      '/api/analyzer/analyze',
      token,
      { method: 'POST', body: JSON.stringify({ ticker }) },
    ),
  chat: (token: string | null, message: string) =>
    apiFetch<{ response: string; wisdom?: string }>(
      '/api/analyzer/chat',
      token,
      { method: 'POST', body: JSON.stringify({ message }) },
    ),
};
