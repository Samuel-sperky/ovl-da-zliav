'use client';

/**
 * Aura Zľavy — ČÍTANIE TROCH KPI KARIET PREHĽADU (V7, D148, D152, K8).
 *
 * Karty V7 sú tri a čítajú DVE odpovede:
 *
 *   `GET /api/insights/catalog-distribution?by=own-discount`
 *        → „Produktov v katalógu" (`total`) a „V zľave" (diel `active_now`
 *          a jeho podiel). Obe z JEDNEJ odpovede zámerne: podiel a menovateľ
 *          musia prísť z toho istého dotazu, inak by karta delila dnešný počet
 *          zliav včerajším počtom riadkov zrkadla a nikto by si to nevšimol.
 *   `GET /api/insights/sold-per-stock?window=N`
 *        → „Predané na sklad" (`N×` za vybrané okno).
 *
 * ŽIADNY Z NICH NEVOLÁ SHOP (K8): sú to `SELECT`-y nad miestnou kópiou.
 *
 * ═══ PRAVIDLO MODULU: ČO SA NEDÁ PREČÍTAŤ, JE `null` ═══
 * Nikdy nula, nikdy dopočítaný odhad. `fetchJson()` vracia `null` aj na 404 aj
 * na `{ ok: false }`, takže karta z chýbajúcej odpovede nakreslí pomlčku — a to
 * je dnes BEŽNÝ stav (R4: appka je bez `shop_write` kľúča a IP je zabanovaná).
 * Rad kariet je nakreslený pre prázdny stav rovnako ako pre plný.
 *
 * ═══ TVAR ODPOVEDE `sold-per-stock` JE KONTRAKT, NIE DOHAD ═══
 * Route je dátová cesta V7 (mimo tohto kroku) a tento parser je jej jediný
 * konzument. Čo musí posielať:
 *
 *   {
 *     window: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' },
 *     soldPerStock: number | null,          // pomer za okno, `null` = nevieme
 *     ratioState: 'measured' | 'lower_bound' | 'unknown',
 *     windowUnits: number | null,           // predané kusy za dočítané dni
 *     stock: number | null,                 // sklad zo zrkadla (obohatené riadky)
 *     gaps: { unknownDays: number | null }, // koľko dní okna appka NEMÁ
 *     coverage: { productsWithStock: number | null, catalogRows: number | null }
 *   }
 *
 * Tri stavy sú v `ratioState`, nie v hodnote: `lower_bound` znamená, že okno
 * nie je dočítané (dnes to je pri 180 a 360 takmer isté, R3), a karta vtedy
 * píše `≥`. Neznámy kód stavu NIE JE `measured` — poradie podmienok v parseri
 * je záväzné, pretože kto sa najprv pozrie na číslo, dosadí súčet dočítaných
 * dní ako meranie celého okna.
 *
 * `stock` je zo zrkadla, teda z obohatených riadkov — preto sa vedľa pomeru
 * vracia `coverage.productsWithStock`. Bez toho čísla je pomer pravdivý, ale
 * nemerateľný: človek z neho nevie, či hovorí o katalógu, alebo o jeho stotine.
 *
 * Vlastník: V7, krok 1/4 (KPI riadok a prepínače okna).
 */
import { asRecord, readCount, readNumber, readText } from '@/components/dashboard/json';
import type { SoldWindow } from '@/components/dashboard/sold-window';
import { fetchJson } from '@/components/layout/health';

/* ════════════ 1. Katalóg a vlastné zľavy z jednej odpovede ════════════════ */

/**
 * Diel „práve v okne vlastnej zľavy" a celok, z ktorého je počítaný.
 *
 * `share` je zlomok 0–1 tak, ako ho posiela route — NIE percentá. Prepočet na
 * percentá robí model karty, aby existoval jeden formátovač podielu.
 */
export interface OwnDiscountShareView {
  /** Riadky miestnej kópie katalógu. `null` = odpoveď sa nedala prečítať. */
  readonly catalogRows: number | null;
  /** Produkty, ktoré sú DNES v okne vlastnej zľavy (I11). `null` = nevieme. */
  readonly discountedNow: number | null;
  /** Podiel dielu na celku, 0–1. `null` = celok je nula, podiel neexistuje. */
  readonly share: number | null;
  /**
   * `false` = diely nedávajú celok, takže podiel by bol z iného menovateľa,
   * než aký je v odpovedi. Model vtedy podiel NENAPÍŠE a povie prečo.
   */
  readonly sumMatchesTotal: boolean;
}

/**
 * Diel `active_now` z odpovede koláča.
 *
 * Hľadá sa PODĽA MENA `bucket`, nie podľa poradia: poradie dielov je vecou
 * route a keby sa raz zmenilo, karta by ticho ukazovala počet produktov, ktoré
 * zľavu mali NIEKEDY, ako počet tých, ktoré ju majú DNES.
 */
function activeNowSlice(raw: unknown): { count: number | null; share: number | null } {
  if (!Array.isArray(raw)) return { count: null, share: null };
  for (const entry of raw) {
    const row = asRecord(entry);
    if (row === null) continue;
    if (readText(row, 'bucket') !== 'active_now') continue;
    return { count: readCount(row, 'count'), share: readNumber(row, 'share') };
  }
  return { count: null, share: null };
}

/**
 * Odpoveď koláča → dve čísla prvých dvoch kariet.
 *
 * `dimension: 'own-discount'` je PODMIENKA, nie ozdoba: je to jediná menovka,
 * ktorá na povrchu drží rozdiel medzi „zľava podľa NAŠICH zápisov" a „zľava
 * podľa shopu" (D116, I11). Odpoveď s iným rozmerom sa preto nečíta vôbec —
 * radšej pomlčka než počet, o ktorom appka nevie, čoho je počtom.
 */
export function parseOwnDiscountShare(raw: unknown): OwnDiscountShareView | null {
  const root = asRecord(raw);
  if (root === null) return null;
  if (root.dimension !== 'own-discount') return null;
  const slice = activeNowSlice(root.slices);
  return {
    catalogRows: readCount(root, 'total'),
    discountedNow: slice.count,
    share: slice.share,
    /* Fail-closed: chýbajúci príznak NIE JE „diely dávajú celok". */
    sumMatchesTotal: root.sumMatchesTotal === true,
  };
}

export async function getOwnDiscountShare(): Promise<OwnDiscountShareView | null> {
  return parseOwnDiscountShare(
    await fetchJson('/api/insights/catalog-distribution?by=own-discount'),
  );
}

/* ═════════════════════ 2. Predané na sklad za okno ════════════════════════ */

/** Čím pomer JE. Tri stavy, presne ako ich posiela route (I11). */
export type SoldPerStockState = 'measured' | 'lower_bound' | 'unknown';

export interface SoldPerStockView {
  readonly from: string;
  readonly to: string;
  /** Pomer za okno. `null` ⇔ `ratioState === 'unknown'`. */
  readonly ratio: number | null;
  readonly ratioState: SoldPerStockState;
  /** Predané kusy za dočítané dni okna. `null` = nevieme. */
  readonly windowUnits: number | null;
  /** Sklad zo zrkadla. `0` je meraná nula, `null` je „nevieme". */
  readonly stock: number | null;
  /**
   * Koľko dní okna appka NEMÁ. `null` = odpoveď to nepovedala (fail-closed):
   * nula by tvrdila „nechýba nič", a to je práve to, čo `lower_bound` popiera.
   */
  readonly unknownDays: number | null;
  /** Z koľkých produktov je pomer počítaný. `null` = odpoveď to nepovedala. */
  readonly productsWithStock: number | null;
  /** Riadky zrkadla, teda kontext predchádzajúceho čísla. `null` = nevieme. */
  readonly catalogRows: number | null;
}

export function parseSoldPerStock(raw: unknown): SoldPerStockView | null {
  const root = asRecord(raw);
  if (root === null) return null;
  const window = asRecord(root.window);
  if (window === null) return null;
  const from = readText(window, 'from');
  const to = readText(window, 'to');
  if (from === null || to === null) return null;

  const state = root.ratioState;
  const ratioState: SoldPerStockState =
    state === 'measured' || state === 'lower_bound' ? state : 'unknown';
  const gaps = asRecord(root.gaps);
  const coverage = asRecord(root.coverage);
  return {
    from,
    to,
    /* Pri `unknown` sa číslo NEČÍTA vôbec — bola by to hodnota, o ktorej
       odpoveď sama tvrdí, že ju nemá. */
    ratio: ratioState === 'unknown' ? null : readNumber(root, 'soldPerStock'),
    ratioState,
    windowUnits: readCount(root, 'windowUnits'),
    stock: readCount(root, 'stock'),
    unknownDays: gaps === null ? null : readCount(gaps, 'unknownDays'),
    productsWithStock: coverage === null ? null : readCount(coverage, 'productsWithStock'),
    catalogRows: coverage === null ? null : readCount(coverage, 'catalogRows'),
  };
}

/**
 * `anchor` posúva „dnešok" odpovede na zadaný deň — tá istá dohoda, akú majú
 * `sales-daily` a `revenue-daily`. Karta ho používa na PREDCHÁDZAJÚCE okno;
 * bez neho by porovnanie neexistovalo a pilulka smeru by musela navždy hovoriť
 * „zmenu nevieme". Nový endpoint na to NEVZNIKÁ — je to tá istá route s inou
 * kotvou.
 */
export async function getSoldPerStock(
  windowDays: SoldWindow,
  anchor?: string,
): Promise<SoldPerStockView | null> {
  const at = anchor === undefined ? '' : `&anchor=${anchor}`;
  return parseSoldPerStock(
    await fetchJson(`/api/insights/sold-per-stock?window=${String(windowDays)}${at}`),
  );
}
