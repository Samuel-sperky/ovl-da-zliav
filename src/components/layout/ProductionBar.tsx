'use client';

/**
 * Aura Zľavy — trvalý červený pruh „PRODUKCIA — <doména>" (D6).
 *
 * Je na KAŽDEJ stránke a nedá sa zavrieť. Doménu číta z `/api/settings`
 * (§5); kým nie je nastavená alebo endpoint neodpovedá, pruh to priznáva
 * — nikdy nezobrazuje vymyslenú doménu.
 */
import { useEffect, useState } from 'react';

import { fetchJson, type SettingsData } from '@/components/layout/health';

export function ProductionBar() {
  const [domain, setDomain] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const data = await fetchJson<SettingsData>('/api/settings');
      setDomain(data?.shopDomain ?? null);
      setLoaded(true);
    })();
  }, []);

  const label = !loaded
    ? 'PRODUKCIA'
    : domain
      ? domain.replace(/^https:\/\//, '')
      : 'doména zatiaľ nenastavená';

  return (
    <div className="ovl-production-bar" role="alert" data-testid="production-bar">
      PRODUKCIA{loaded ? <> — <code>{label}</code></> : null} · každý zápis ide do ostrého shopu
    </div>
  );
}

export default ProductionBar;
