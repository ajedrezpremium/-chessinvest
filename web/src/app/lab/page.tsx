'use client';

import { useState } from 'react';
import { AnalyzerBox, ChatBox } from '@/components/Lab';

export default function LabPage() {
  const [tab, setTab] = useState<'analyze' | 'chat'>('analyze');

  return (
    <div>
      <div className="section-title">El laboratorio — ChessInvest IA</div>
      <div className="panel">
        <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
          <div
            onClick={() => setTab('analyze')}
            style={{
              padding: '10px 20px',
              fontSize: 13,
              fontWeight: 500,
              color: tab === 'analyze' ? 'var(--accent)' : 'var(--muted)',
              cursor: 'pointer',
              borderBottom: tab === 'analyze' ? '2px solid var(--accent)' : '2px solid transparent',
            }}
          >
            🔬 Analizar acción
          </div>
          <div
            onClick={() => setTab('chat')}
            style={{
              padding: '10px 20px',
              fontSize: 13,
              fontWeight: 500,
              color: tab === 'chat' ? 'var(--accent)' : 'var(--muted)',
              cursor: 'pointer',
              borderBottom: tab === 'chat' ? '2px solid var(--accent)' : '2px solid transparent',
            }}
          >
            💬 Amigo inversor
          </div>
        </div>
        {tab === 'analyze' ? <AnalyzerBox /> : <ChatBox />}
      </div>
    </div>
  );
}
