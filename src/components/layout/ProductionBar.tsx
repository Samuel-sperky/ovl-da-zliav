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

  /*
   * ŠTÍTOK, NIE PÁS (kostra 19. 8. 2026).
   *
   * Do 19. 8. to bol pás cez celú šírku s vetou „každý zápis ide do ostrého
   * shopu". V jednoriadkovom topbare zaberal ~440 px a odsekával menovky stavu
   * vedľa seba — „Katalóg 41 220" sa skrátil na „Katalóg 41".
   *
   * Čo zostalo a je bezpečnostne podstatné: štítok je na KAŽDEJ obrazovke,
   * NEDÁ SA zavrieť, je červený, má role="alert" a MENUJE DOMÉNU, do ktorej sa
   * zapíše. Vymyslenú doménu nezobrazí nikdy.
   *
   * Čo sa presunulo: dôsledok („každý zápis ide do ostrého shopu") je v title.
   * Nie je to strata — tá istá veta stojí celá na obrazovke potvrdenia zápisu,
   * teda presne tam, kde na nej záleží.
   */
  return (
    <div className="ovl-production-bar" role="alert" title="Každý zápis ide do ostrého shopu." data-testid="production-bar">
      PRODUKCIA{loaded ? <> · <code>{label}</code></> : null}
    </div>
  );
}

export default ProductionBar;
