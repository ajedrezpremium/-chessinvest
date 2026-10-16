'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function Header({ email }: { email: string | null }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    try {
      localStorage.removeItem('chessinvest_token');
      localStorage.removeItem('chessinvest_refresh');
    } catch {}
    router.push('/');
    router.refresh();
  }

  const link = (href: string, label: string) => (
    <Link key={href} href={href} className={pathname === href ? 'active' : ''}>
      {label}
    </Link>
  );

  return (
    <div className="topbar">
      <Link href="/" className="logo">
        ♔ CHESS INVEST <span style={{ fontSize: 10 }}>V2.0</span>
      </Link>
      <nav className="nav">
        {link('/', 'Mercados')}
        {link('/portfolio', 'Mi Cartera')}
        {link('/lab', 'Laboratorio')}
        {email ? (
          <>
            <span style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 6px' }}>
              {email}
            </span>
            <button className="btn btn-outline" onClick={logout} style={{ padding: '6px 14px' }}>
              Salir
            </button>
          </>
        ) : (
          <>
            {link('/login', 'Entrar')}
            {link('/register', 'Registro')}
          </>
        )}
      </nav>
    </div>
  );
}
