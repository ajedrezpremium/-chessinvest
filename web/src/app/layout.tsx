import type { Metadata } from 'next';
import './globals.css';
import { getSession } from '@/lib/supabase/server';
import Header from '@/components/Header';

export const metadata: Metadata = {
  title: '♔ CHESS INVEST V2.0',
  description: 'Plataforma profesional de análisis y gestión de inversiones',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  const email = session?.user?.email ?? null;

  return (
    <html lang="es">
      <body>
        <Header email={email} />
        <main className="main">{children}</main>
        <footer className="footer">
          <div>
            <strong style={{ color: 'var(--amber)' }}>⚠️ AVISO LEGAL:</strong>{' '}
            La información de CHESS INVEST es solo con fines informativos y
            educativos. No constituye asesoramiento financiero.
          </div>
          <div style={{ marginTop: 8, opacity: 0.6 }}>
            © 2026 CHESS INVEST V2.0 — Todos los derechos reservados
          </div>
        </footer>
      </body>
    </html>
  );
}
