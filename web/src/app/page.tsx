import MarketsDashboard from '@/components/MarketsDashboard';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function Home() {
  let regions = {};
  try {
    const data = await api.markets();
    regions = data.regions || {};
  } catch {
    regions = {};
  }

  return (
    <div>
      <div className="section-title">Mercados mundiales en vivo</div>
      <MarketsDashboard regions={regions} />
    </div>
  );
}
