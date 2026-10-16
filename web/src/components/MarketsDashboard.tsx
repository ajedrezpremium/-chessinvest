'use client';

import { useState } from 'react';
import type { RegionGroup } from '@/lib/api';

export default function MarketsDashboard({
  regions,
}: {
  regions: Record<string, RegionGroup>;
}) {
  const keys = Object.keys(regions).sort(
    (a, b) => (regions[a].order ?? 99) - (regions[b].order ?? 99),
  );
  const [active, setActive] = useState(keys[0] ?? '');

  if (!keys.length) {
    return <p style={{ color: 'var(--muted)' }}>Sin datos de mercado ahora mismo.</p>;
  }

  const group = regions[active];

  return (
    <div>
      <div className="region-tabs">
        {keys.map((k) => (
          <button
            key={k}
            className={k === active ? 'active' : ''}
            onClick={() => setActive(k)}
          >
            {regions[k].label} ({regions[k].markets.length})
          </button>
        ))}
      </div>
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-val" style={{ color: 'var(--accent)' }}>
            {group.stats.total}
          </div>
          <div className="stat-lbl">Índices</div>
        </div>
        <div className="stat-card">
          <div className="stat-val" style={{ color: 'var(--green)' }}>
            {group.stats.up}
          </div>
          <div className="stat-lbl">En positivo</div>
        </div>
        <div className="stat-card">
          <div className="stat-val" style={{ color: 'var(--red)' }}>
            {group.stats.down}
          </div>
          <div className="stat-lbl">En negativo</div>
        </div>
      </div>
      <div className="markets-grid">
        {group.markets.map((m) => (
          <div key={m.id} className={`mcard ${m.dir}`}>
            <div className="mcard-name">
              {m.country} — {m.name}
            </div>
            <div
              className="mcard-val"
              style={{ color: m.dir === 'up' ? 'var(--green)' : 'var(--red)' }}
            >
              {m.val}
            </div>
            <div className={`mcard-chg ${m.dir}`}>
              {m.dir === 'up' ? '▲' : '▼'} {m.chg} ({m.pts})
            </div>
            <div className="mcard-vol">
              Vol: {m.vol} · {m.state}
              {m.source === 'fallback' ? ' · ⏸ SIMULADO' : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
