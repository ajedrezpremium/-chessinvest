import { api } from '@/lib/api';
import { getAccessToken } from '@/lib/supabase/server';
import { AddPositionForm, AddWatchlistForm, RemoveButton } from '@/components/PortfolioForms';

export const dynamic = 'force-dynamic';

export default async function PortfolioPage() {
  const token = await getAccessToken();
  if (!token) {
    return <p style={{ color: 'var(--muted)' }}>Sesión no válida.</p>;
  }

  const [summary, portfolioRes, watchlistRes] = await Promise.all([
    api.profileSummary(token).catch(() => null),
    api.portfolio(token).catch(() => ({ portfolio: [] })),
    api.watchlist(token).catch(() => ({ watchlist: [] })),
  ]);

  const stats = summary?.stats;

  return (
    <div>
      <div className="section-title">Mi cartera</div>

      {stats && (
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-val" style={{ color: 'var(--accent)' }}>
              {stats.portfolioCount}
            </div>
            <div className="stat-lbl">Posiciones</div>
          </div>
          <div className="stat-card">
            <div className="stat-val" style={{ color: 'var(--purple)' }}>
              {stats.watchlistCount}
            </div>
            <div className="stat-lbl">En seguimiento</div>
          </div>
          <div className="stat-card">
            <div className="stat-val" style={{ color: 'var(--amber)' }}>
              {stats.activeAlerts}
            </div>
            <div className="stat-lbl">Alertas activas</div>
          </div>
          <div className="stat-card">
            <div className="stat-val">{summary?.subscription?.plan ?? 'free'}</div>
            <div className="stat-lbl">Plan</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div className="panel" style={{ flex: 1, minWidth: 280 }}>
          <div className="section-title">Watchlist</div>
          <AddWatchlistForm />
          <table className="table" style={{ marginTop: 12 }}>
            <tbody>
              {watchlistRes.watchlist.map((w) => (
                <tr key={w.id}>
                  <td className="ticker">{w.ticker}</td>
                  <td style={{ textAlign: 'right' }}>
                    <RemoveButton path={`/api/portfolio/watchlist/${w.ticker}`} label={w.ticker} />
                  </td>
                </tr>
              ))}
              {!watchlistRes.watchlist.length && (
                <tr>
                  <td style={{ color: 'var(--muted)' }}>Vacía. Añade tu primer ticker.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="panel" style={{ flex: 1, minWidth: 280 }}>
          <div className="section-title">Posiciones</div>
          <AddPositionForm />
          <table className="table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Acciones</th>
                <th>P. medio</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {portfolioRes.portfolio.map((p) => (
                <tr key={p.id}>
                  <td className="ticker">{p.ticker}</td>
                  <td>{p.shares}</td>
                  <td>${p.avg_price}</td>
                  <td style={{ textAlign: 'right' }}>
                    <RemoveButton path={`/api/portfolio/portfolio/${p.ticker}`} label={p.ticker} />
                  </td>
                </tr>
              ))}
              {!portfolioRes.portfolio.length && (
                <tr>
                  <td colSpan={4} style={{ color: 'var(--muted)' }}>
                    Sin posiciones todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
