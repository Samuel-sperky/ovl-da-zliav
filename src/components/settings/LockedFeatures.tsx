'use client';

/**
 * Aura Zľavy — ZAMKNUTÉ FUNKCIE (V12; kontrakt V3, bod K-osem; architektúra §5).
 *
 * Kategóriu, kov, typ šperku, nákupné ceny ani sklad nevariantných produktov
 * appka dnes nemá — a toto je JEDINÉ miesto v celej appke, kde je k tomu
 * vysvetlenie. Vo filtroch a v bunkách tabuliek zostáva len tlmená pomlčka;
 * žiadny žltý pruh cez stránku, žiadne opakované hlášky pri každom čísle,
 * žiadne počítadlo v hlavičke.
 *
 * DÔVOD NIE JE ESHOP (nález P3 auditu 30)
 * ───────────────────────────────────────
 * Do 26. 8. tu stálo, že „eshop nevracia" tie údaje — a klipboardové tlačidlo
 * ten text posielalo správcovi shopu. Nebola to pravda: eshop ich vracia od
 * 13. 8. (`docs/58-CO-VIEME-TAHAT-Z-API.md` §2 — `getFull` dáva
 * `purchase_price`, `margin`, `qty` aj `categories`, `search` presné filtre,
 * `categories` strom kategórií). Chýba OPRÁVNENIE `product:read` na kľúči,
 * ktorý appka používa, a to je jediná vec, o ktorú má zmysel správcu shopu
 * žiadať. Zámok samotný je správny (K8) — opravil sa DÔVOD, nie zámok.
 *
 * TRI STAVY, NIKDY DVA — A FAIL-CLOSED
 * ────────────────────────────────────
 * `product:read` má tri stavy (`ShopCapabilityState` v
 * `lib/catalog/product-codes.ts`): má · nemá · NEVIEME. Kým sa kľúč neoveril,
 * je to „nevieme" a sekcia zostáva zamknutá — a presne to je dnešný stav, lebo
 * `whoami` sa nedá zavolať (naša adresa je v shope zablokovaná). Odomknutie sa
 * teda NEDÁ overiť naživo; jediný dôkaz, ktorý máme, je test nad všetkými
 * tromi stavmi (`test/unit/zamknute-funkcie.spec.ts`).
 *
 * ČO ODOMKNE FILTRE — A ČO ICH NEODOMKNE
 * ──────────────────────────────────────
 * Samotné oprávnenie NIE. Zrkadlo katalógu na tie údaje nemá stĺpce
 * (`db/migrations/0003_allowlist_catalog.sql`, `0011_katalog.sql`) a `getFull`
 * je jedno volanie na produkt, teda 41 082 volaní z tej istej kvóty, z ktorej
 * zapisuje fronta (K2). Stav `available` preto NEODOMKNE nič: len prestane
 * vinu klásť na oprávnenie a pomenuje zvyšný krok. Filtre zhasnú až vtedy, keď
 * ich vlastník vyradí z `LOCKED_FILTERS` v `lib/repo/catalog.repo.ts` — po
 * zmene schémy a po dočítaní. Táto obrazovka to sama neurobí a nesmie
 * predstierať, že sa to už stalo.
 *
 * Dlhá veta zo servera (`missingScopeSentence`, chodí v `/api/key` ako
 * `productReadNote`) sa tu ZÁMERNE nekreslí: je adresovaná používateľovi
 * („Vypýtaj si…") a má nad 90 znakov, čo je na povrchu tejto stránky strop
 * (P2). Povrch preto nesie jednu krátku vetu o dôvode a celá prosba je
 * v texte do schránky, kde ju dĺžka neobmedzuje.
 *
 * Tlačidlo skopíruje text do schránky, aby si ho používateľ mohol poslať
 * správcovi shopu sám. Appka žiadny e-mail neposiela.
 *
 * Vlastník: V12.
 */
import { Fragment, useState } from 'react';

import Button from '@/components/ui/Button';
import type { ShopCapabilityState } from '@/lib/catalog/product-codes';

interface LockedRow {
  readonly feature: string;
  readonly missing: string;
}

/** Presne štyri riadky z architektúry §5. Piaty sa sem nevymýšľa. */
export const LOCKED_FEATURES: readonly LockedRow[] = [
  { feature: 'Filter podľa kategórie a kovu', missing: 'zoznam kategórií a kovov' },
  { feature: 'Marža a odhad dopadu', missing: 'nákupné ceny' },
  { feature: 'Obrátkovosť', missing: 'nákupné ceny' },
  { feature: 'Sklad nevariantných produktov', missing: 'stavy skladu' },
];

/**
 * `productRead` z `/api/key` na tri stavy.
 *
 * `null` (kľúč sa neoveril) a `undefined` (staršia odpoveď alebo obrazovka,
 * ktorá kľúč nesťahuje) znamenajú to isté: NEVIEME — a teda zamknuté. Domyslieť
 * si „oprávnenie tam je" sa nesmie ani raz; to je celý zmysel troch stavov.
 */
export function productReadState(productRead: boolean | null | undefined): ShopCapabilityState {
  if (productRead === true) return 'available';
  if (productRead === false) return 'locked';
  return 'unknown';
}

/**
 * Jedna krátka veta o dôvode zámku. Strop 90 znakov (P2) — preto je to vlastná
 * veta a nie `productReadNote` zo servera.
 */
export function lockedCause(state: ShopCapabilityState): string {
  if (state === 'available') {
    return 'Oprávnenie product:read kľúč má; tieto údaje ešte nie sú v zrkadle katalógu.';
  }
  if (state === 'locked') {
    return 'Kľúč nemá oprávnenie product:read; eshop tie údaje dáva až s ním.';
  }
  return 'Nevieme, či kľúč má oprávnenie product:read — appka si ho nemohla overiť.';
}

/**
 * Text do schránky — čistá funkcia, aby sa dal otestovať bez prehliadača.
 *
 * Je to prosba o OPRÁVNENIE, nie sťažnosť na rozhranie: príjemca (správca
 * shopu) tie údaje dodal 13. 8. a text, ktorý mu tvrdí opak, ho pošle hľadať
 * chybu, ktorá nikde nie je.
 */
export function lockedFeaturesText(
  state: ShopCapabilityState = 'unknown',
  rows: readonly LockedRow[] = LOCKED_FEATURES,
): string {
  const lines = rows.map((r) => `- ${r.feature}: chýba ${r.missing}`);
  if (state === 'available') {
    return [
      'Aura Zľavy — oprávnenie product:read kľúč už má, prosba je vybavená.',
      '',
      'Zvyšok je na našej strane: údaje z getFull ešte nie sú v zrkadle katalógu,',
      'takže tieto funkcie zostávajú v appke viditeľné, ale vypnuté:',
      ...lines,
    ].join('\n');
  }
  return [
    'Aura Zľavy — prosba o oprávnenie product:read pre kľúč, ktorý appka používa.',
    '',
    state === 'locked'
      ? 'Kľúč, ktorý appka má, toto oprávnenie nemá.'
      : 'Oprávnenia toho kľúča si appka nemohla overiť, takže nevie, či ho už nemá.',
    'Údaje samotné eshop vracia — getFull (purchase_price, margin, qty, categories),',
    'search (presné filtre) a categories (strom). Chýba oprávnenie, nie rozhranie.',
    '',
    'Bez product:read zostávajú tieto funkcie v appke viditeľné, ale vypnuté:',
    ...lines,
    '',
    'Stačí rozšíriť súčasný kľúč, alebo poslať druhý kľúč s oprávnením product:read.',
  ].join('\n');
}

export interface LockedFeaturesProps {
  /**
   * `productRead` z `/api/key` (`KeyMetaView`). Chýbajúca hodnota znamená
   * „nevieme", teda zamknuté — obrazovka si oprávnenie nikdy nedomyslí.
   */
  readonly productRead?: boolean | null;
}

export function LockedFeatures({ productRead = null }: LockedFeaturesProps) {
  const state = productReadState(productRead);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(lockedFeaturesText(state));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Bez práv na schránku si používateľ text označí sám — je na obrazovke.
      setCopied(false);
    }
  }

  return (
    <section className="sec" id="zamknute" data-testid="locked-features">
      <div className="sec-h">
        <h2>Zamknuté funkcie</h2>
        <div className="act">
          {/* Dôvod stojí V HLAVIČKE, nie v odstavci pod zoznamom — presne ako
              „Zapisuje sa navždy, mazať sa nedá" v `AuditPanel`. Vlastný
              odstavec stál 30 px a stránka s ním merala 1363 px, teda 1,51
              obrazovky; strop P4 je 1,5. V hlavičke nestojí ani pixel. */}
          <span className="lvl-3" data-testid="locked-cause">
            {lockedCause(state)}
          </span>
          {/* Keď oprávnenie už je, nie je to prosba — tlačidlo to nesmie
              tvrdiť, lebo príjemca by hľadal, čo má ešte dodať. */}
          <Button small onClick={() => void copy()} data-testid="locked-copy">
            {copied
              ? 'Skopírované'
              : state === 'available'
                ? 'Skopírovať stav pre správcu shopu'
                : 'Skopírovať prosbu pre správcu shopu'}
          </Button>
        </div>
      </div>
      {/* Zoznam, nie rámovaná tabuľka. Slovo „chýba" nesie každý riadok sám,
          takže hlavička „Funkcia / Chýba" ani rám nemajú čo pridať — a na
          podstránke s piatimi sekciami bolo tých 192 px cítiť. Text je do
          písmena ten istý; zmenilo sa iba, ako je poskladaný, a ostáva celý
          na POVRCHU: pod rozklik tento zoznam nesmie (kontrakt bod 18). */}
      <div className="locked-list" data-testid="locked-list">
        {LOCKED_FEATURES.map((row) => (
          <Fragment key={row.feature}>
            <span className="lf-f">{row.feature}</span>
            <span className="lf-m">chýba {row.missing}</span>
          </Fragment>
        ))}
      </div>
      <p className="set-note gap-t" data-testid="locked-sold">
        Predané kusy fungujú vždy — tie appka počíta z objednávok.
      </p>
    </section>
  );
}

export default LockedFeatures;
