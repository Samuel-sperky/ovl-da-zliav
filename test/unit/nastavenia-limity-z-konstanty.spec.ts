/**
 * Aura Zľavy — LIMIT ESHOPU SA V NASTAVENIACH NEPÍŠE RUČNE (V6b).
 *
 * ČO SA STALO A PREČO TENTO TEST EXISTUJE
 * ---------------------------------------
 * Kvótu zápisového kľúča zdvihol správca shopu 1. 9. 2026 z `20/min · 200/deň`
 * na `150/min · 1000/deň`. `SHOP_KEYED_LIMIT` sa opravil a všetko, čo je z neho
 * ODVODENÉ, sa prepočítalo samo. Dve miesta v Nastaveniach však to isté číslo
 * niesli ako LITERÁL — technický detail Pripojenia („Limit eshopu:
 * 20/min · 200/UTC deň") a technický detail Rozpočtov („min. 3 s (limit
 * 20/min)") — a tie sa rozišli okamžite. Obrazovka tak tvrdila strop, ktorý
 * shop už nemal, a nespadlo pri tom nič: literál nemá ako vedieť, že sa jeho
 * pôvodná hodnota zmenila.
 *
 * Je to tá istá trieda chyby, akú s tou istou kvótou spravil literál `200`
 * v `settings.repo.ts` (`budget.ts` prijal 1000 a repozitár ho odmietol
 * hláškou „musí byť 1–200"). Rozdiel je, že tam to zhodilo zápis a tu len
 * tichú vetu na obrazovke — a práve preto to nikto nenašiel.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *  1. **Meria sa VYKRESLENÝ markup, nie zdroj.** Test nad textom `.tsx` by
 *     zakázal aj to, čo je napísané v komentári — a v oboch súboroch stojí
 *     v komentári práve to staré číslo, aby bolo vidieť, čo sa pokazilo.
 *  2. **Číslo sa porovnáva s KONŠTANTOU, nie s ďalším literálom.** Keby tu
 *     stálo `expect(html).toContain('150/min')`, vznikla by TRETIA kópia toho
 *     istého čísla a pri ďalšom zdvihnutí kvóty by padol tento test namiesto
 *     toho, aby prešiel.
 *  3. **Pauza medzi zápismi číslo z kvóty NIE JE.** `MIN_WRITE_PAUSE_MS` je
 *     podlaha appky (3 s) a zdvihnutie kvóty ju nemení; importovať ju sem
 *     nemožno, `executor.ts` číta `env` a ťahá si serverový graf. Zostáva
 *     literálom vedome a tento test to tvrdí, aby si to niekto neopravil
 *     „na odvodenú".
 *
 * Vlastník: V6b (Nastavenia, krok 3/3: Poistky a kľúče).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import BudgetSection from '@/components/settings/BudgetSection';
import DomainForm from '@/components/settings/DomainForm';
import type { SettingsView } from '@/components/settings/api';
import { SHOP_KEYED_LIMIT } from '@/lib/shop/rate-limits';

const noop = () => {};

const SETTINGS: SettingsView = {
  shopDomain: 'https://sperky-eshop.sk',
  domainConfirmedAt: '2026-08-10T09:12:00.000Z',
  eagerWriteDefault: true,
  writesLocked: false,
  writesLockedReason: null,
  onboardingDoneAt: null,
  scopeMode: 'plny',
  maxProducts: 150,
  maxProductsPerCampaign: 150,
  pilotMaxProducts: 10,
  scopeFailClosed: false,
  dailyWriteBudget: SHOP_KEYED_LIMIT.perUtcDay,
};

const DOMAIN = renderToStaticMarkup(
  createElement(DomainForm, {
    shopDomain: SETTINGS.shopDomain,
    domainConfirmedAt: SETTINGS.domainConfirmedAt,
    onSaved: noop,
  }),
);

const BUDGET = renderToStaticMarkup(
  createElement(BudgetSection, { settings: SETTINGS, queue: null, catalog: null }),
);

/** Vykreslený text bez značiek — číslo sa nesmie stratiť v atribúte. */
function textOf(html: string): string {
  return html
    .replace(/<svg\b[\s\S]*?<\/svg>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('Pripojenie — „Limit eshopu" je odvodený zo SHOP_KEYED_LIMIT', () => {
  const text = textOf(DOMAIN);

  it('vypisuje obe čísla z konštanty', () => {
    expect(text).toContain(`${SHOP_KEYED_LIMIT.perMinute}/min`);
    expect(text).toContain(`${SHOP_KEYED_LIMIT.perUtcDay}/UTC deň`);
  });

  it('a nedrží pri nich starú, rozišlú kópiu', () => {
    /*
     * Tvrdenie nie je „neobsahuje 20" (to by padlo na dátume alebo na inom
     * čísle), ale „neobsahuje TEN TVAR, v ktorom stará kópia stála". Zároveň
     * je poistkou proti tomu, že by niekto pridal riadok navyše a nechal
     * v ňom staré čísla.
     */
    expect(text).not.toContain('20/min');
    expect(text).not.toContain('200/UTC deň');
  });
});

describe('Rozpočty — minútový strop je z konštanty, pauza je podlaha appky', () => {
  const text = textOf(BUDGET);

  it('minútový strop sa vypisuje z konštanty', () => {
    expect(text).toContain(`${SHOP_KEYED_LIMIT.perMinute}/min`);
    expect(text).not.toContain('limit 20/min');
  });

  it('pauza medzi zápismi je ďalej 3 s a nezávisí od kvóty', () => {
    /*
     * `MIN_WRITE_PAUSE_MS` = 3 000 ms. Keby ju niekto „odvodil" z nového
     * minútového stropu (60 000 / 120 = 500 ms), appka by začala zapisovať
     * šesťkrát rýchlejšie než podlaha, ktorú si K2 stanovilo — a tá podlaha
     * nie je odhad rýchlosti shopu, ale strop nášho vlastného rizika.
     */
    expect(text).toContain('min. 3 s');
  });
});
