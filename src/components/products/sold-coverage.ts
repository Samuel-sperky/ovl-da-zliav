'use client';

/**
 * Aura Zľavy — POKRYTIE PREDAJNOSTI NA POVRCHU (KONTRAKT-PREDAJNOST P3;
 * kontrakt V3 K8, I11).
 *
 * Prečo tento modul existuje
 * ──────────────────────────
 * Stĺpec „Predané 180 d" aj pravidlo pásma „0 predaných za 180 dní → 30 %"
 * vyzerajú ako meraný fakt o 180 dňoch. Nie sú: okno prvého behu je zámerne
 * krátke (`SALES_WINDOW_DAYS`) a nočné dopĺňanie ho rozširuje po dni, takže
 * appka môže mať objednávky stiahnuté za dva dni a stĺpec sa aj tak menuje
 * podľa 180. `catalog/search` navyše dopĺňa chýbajúcu predajnosť nulou, čiže
 * „nevieme" a „nepredalo sa" vyjdú na obrazovke rovnako — a práve podľa toho
 * čísla si používateľ vyberá tisíce produktov do zľavy.
 *
 * Prehľad to priznáva („N dní s údajmi", „V grafe chýba N dní") a karta výkonu
 * čísla mimo pokrytia odmieta. Produkty a sprievodca to do 26. 8. 2026
 * nepriznávali nikde. Tento modul je ten chýbajúci kus: jedna veta, ktorá
 * povie, za koľko dní sú dáta NAOZAJ stiahnuté.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * ───────────────────────
 *
 * 1. **Tri stavy, nie dva.** „Ešte sme sa nepýtali", „pýtali sme sa a nevieme"
 *    a „vieme presne toto" sú tri rôzne veci. Kto prvé dva zlije, buď
 *    vykreslí varovanie skôr, než odpoveď prišla (bliká na každom otvorení
 *    obrazovky), alebo nečitateľnú odpoveď vydá za plné pokrytie.
 *
 * 2. **Pokrytie je MERANIE, nie nastavenie.** `daysCovered` prichádza z dní,
 *    ktoré appka naozaj stiahla; `windowDays` je len to, čo si používateľ
 *    naklikal. Porovnávať sa musia práve tieto dve čísla — nie `windowDays`
 *    s nastaveným oknom prvého behu, ktoré o stiahnutých dňoch nevie nič.
 *
 * 3. **Veta MLČÍ, keď je pokrytie plné.** Trvalá vysvetlivka pod stĺpcom by sa
 *    po týždni prestala čítať a odniesla by si aj tie prípady, keď platí.
 *
 * Vlastník: V10 (obrazovka Produkty), sprievodca V11.
 */
import { asRecord, readCount, readText, readTriState } from '@/components/dashboard/json';
import { fetchJson } from '@/components/layout/health';
import { useRefreshable } from '@/components/layout/refresh';
import { useState } from 'react';

/** Pokrytie predajnosti tak, ako ho obrazovka potrebuje. */
export interface SoldCoverage {
  /** Sťahovanie objednávok je vôbec zapnuté? */
  readonly syncEnabled: boolean;
  /** Koľko dní appka NAOZAJ zmerala. Nie nastavené okno. */
  readonly daysCovered: number;
  /** Prvý a posledný zmeraný deň; `null` = ani jeden. */
  readonly from: string | null;
  readonly to: string | null;
}

/**
 * Tri stavy, ktoré sa nesmú zliať (bod 1 v hlavičke). `asked: false` je stav
 * pred prvou odpoveďou — vtedy obrazovka nemá čo priznať ani vyvrátiť.
 */
export type SoldCoverageState =
  | { readonly asked: false }
  | { readonly asked: true; readonly coverage: SoldCoverage | null };

/** Obrazovka sa ešte nepýtala. */
export const SOLD_COVERAGE_UNASKED: SoldCoverageState = { asked: false };

/** Vysvetlivka na vykreslenie. `null` = niet čo priznať. */
export interface SoldCoverageNoteView {
  readonly variant: 'info' | 'warn';
  readonly text: string;
}

/**
 * `coverage` z odpovede `/api/insights/sales-daily`. `null` znamená „odpoveď sa
 * nedala prečítať" — nie prázdne pokrytie. Chýbajúci `syncEnabled` alebo
 * `daysCovered` je nečitateľná odpoveď: dopočítať si ich znamená vyrobiť
 * tvrdenie o tom, čo appka zmerala.
 */
export function parseSoldCoverage(raw: unknown): SoldCoverage | null {
  const root = asRecord(raw);
  if (root === null) return null;
  const coverage = asRecord(root['coverage']);
  if (coverage === null) return null;
  const syncEnabled = readTriState(coverage, 'syncEnabled');
  const daysCovered = readCount(coverage, 'daysCovered');
  if (syncEnabled === null || daysCovered === null) return null;
  return {
    syncEnabled,
    daysCovered,
    from: readText(coverage, 'from'),
    to: readText(coverage, 'to'),
  };
}

/**
 * Jediné miesto, kde sa veta o pokrytí formuluje — pre tabuľku Produktov aj pre
 * pásma v sprievodcovi. Poradie vetiev je poradie závažnosti: vypnuté
 * sťahovanie je iná veta než „ešte nič nestiahol", a obe sú iné než „stiahol
 * menej, než sa pýtaš".
 */
export function soldCoverageNote(
  state: SoldCoverageState,
  windowDays: number,
): SoldCoverageNoteView | null {
  if (!state.asked) return null;

  const asked = Math.max(1, Math.trunc(windowDays));

  if (state.coverage === null) {
    return {
      variant: 'warn',
      text:
        `Za koľko dní má appka objednávky naozaj stiahnuté, sa nepodarilo zistiť. ` +
        `Predané kusy preto môžu pokrývať kratšie obdobie než ${asked} dní.`,
    };
  }

  const { syncEnabled, daysCovered } = state.coverage;

  if (!syncEnabled) {
    return {
      variant: 'warn',
      text:
        `Sťahovanie objednávok je vypnuté, takže predané kusy za ${asked} dní appka ` +
        `nemá zmerané. Nula neznamená, že sa produkt nepredáva.`,
    };
  }

  if (daysCovered <= 0) {
    return {
      variant: 'warn',
      text:
        `Objednávky sa zatiaľ nestiahli ani za jeden deň, takže predané kusy za ` +
        `${asked} dní appka nemá zmerané. Nula neznamená, že sa produkt nepredáva.`,
    };
  }

  if (daysCovered < asked) {
    return {
      variant: 'warn',
      text:
        `Objednávky má appka stiahnuté za ${daysCovered} z ${asked} dní. Nula predaných ` +
        `preto môže znamenať aj to, že sa produkt za toto obdobie nepredal — nie že ` +
        `sa nepredáva.`,
    };
  }

  // Pokrytie je plné. Vysvetlivka mlčí (bod 3 v hlavičke).
  return null;
}

/**
 * Pokrytie z `/api/insights/sales-daily`. Tá istá odpoveď, akú číta graf
 * predaja na Prehľade — obrazovka Produktov z nej berie len hlavičku
 * o pokrytí, nie rad po dňoch.
 *
 * Zlyhané načítanie skončí ako `{ asked: true, coverage: null }`, teda ako
 * priznané „nevieme". Ticho by znamenalo, že obrazovka tvrdí plné pokrytie.
 */
export function useSoldCoverage(): SoldCoverageState {
  const [state, setState] = useState<SoldCoverageState>(SOLD_COVERAGE_UNASKED);

  useRefreshable(async () => {
    const body = await fetchJson<unknown>('/api/insights/sales-daily');
    setState({ asked: true, coverage: parseSoldCoverage(body) });
  });

  return state;
}
