/**
 * Aura Zľavy — PODKLAD PRE HISTOGRAM CIEN KATALÓGU (V1).
 * NIE JE to route — Next.js registruje výhradne `route.ts`.
 *
 * KDE SA POČÍTA ČO
 * ────────────────
 *
 * Miestna kópia katalógu má rádovo 40 000 riadkov. Poslať ich do prehliadača,
 * aby si tam narátal dvadsať stĺpcov, znamená prejsť 40 000 cien cez sieť pri
 * každom otvorení obrazovky. Zaraďovanie do pásiem preto robí databáza a von
 * ide dvadsaťjeden čísel.
 *
 * SQL tu ale NEŽIJE. Nad `catalog_cache` má dotazy `catalog.repo.ts` a je to
 * jediné miesto, ktoré tú tabuľku pozná — presne ako `counts()` pre bočný
 * panel. `_shared.ts` to pre čítacie route-y grafov vyžaduje bez výnimky
 * („jediné, čo robí, je SELECT cez repozitár"). Tento modul je nad repozitárom
 * len TVAR PRE GRAF: dá mu rozmery pásiem, riedke počty rozloží na súvislý rad
 * a časy preloží do ISO pre drôt.
 *
 * ČO SA TU SMIE TICHO POKAZIŤ
 * ───────────────────────────
 *
 *  1. **Orezanie chvosta bez priznania.** Ceny idú od nuly po vyše 1 700 €,
 *     ale drvivá väčšina katalógu leží pod 200 €. Bez orezania by histogram
 *     bol jeden stĺpec vľavo a 170 prázdnych vpravo. Posledné pásmo je preto
 *     ZBERNÉ (`to: null`) a odpoveď nesie `maxPrice`, aby graf vedel povedať,
 *     kam až chvost siaha. Kto zberné pásmo označí ako obyčajné, začne graf
 *     tvrdiť, že najdrahší produkt stojí 200 €.
 *
 *  2. **Produkt bez ceny sa započíta ako nula.** `catalog_cache.price` je
 *     `NULL`, kým sa produkt nestiahol. Nula by ho posadila do najlacnejšieho
 *     pásma a vyrobila neexistujúci vrchol pri nule. Riadky bez ceny sa preto
 *     z pásiem VYNECHÁVAJÚ a počítajú sa zvlášť (`withoutPrice`) — graf ich
 *     musí priznať, nie zamlčať.
 *
 *  3. **Cena sa vydáva za dnešnú.** Je to KÓPIA. Obnovuje sa pri otvorení
 *     zápisového formulára a ručne, nie na pozadí — takže riadok môže byť
 *     týždne starý. Odpoveď preto nesie najstarší aj najnovší čas stiahnutia
 *     a graf musí obe ukázať. Bez toho by histogram tvrdil, že takto vyzerá
 *     cenník TERAZ.
 *
 *  4. **Zámena za „ceny v eshope".** Sú to ceny v miestnej kópii. Produkty,
 *     ktoré sa nikdy nestiahli, tu nie sú vôbec — a to sa z počtu riadkov
 *     nedá zistiť. Graf preto hovorí „miestna kópia katalógu", nikdy „katalóg".
 *
 * ČISTO ČÍTACIE: samé `SELECT`, žiadne volanie shopu, žiadny zápis.
 *
 * Vlastník: V1.
 */
import type { Queryable } from '@/contracts';

import { catalogRepo } from '@/lib/repo/catalog.repo';

/* ═══════════════════════════ 1. Rozmery pásiem ════════════════════════════ */

/** Šírka pásma v eurách. */
export const PRICE_BIN_WIDTH = 10;

/** Koľko obyčajných pásiem je pred zberným. 20 × 10 € = 0 až 200 €. */
export const PRICE_BIN_COUNT = 20;

/* ═══════════════════════════════ 2. Typy ══════════════════════════════════ */

/** Jedno pásmo histogramu. `to === null` je ZBERNÉ pásmo (a viac). */
export interface PriceBin {
  from: number;
  to: number | null;
  count: number;
}

export interface CatalogPrices {
  bins: PriceBin[];
  /** Koľko riadkov má miestna kópia katalógu spolu. */
  rows: number;
  /** Z toho bez ceny — do pásiem nevstupujú a graf ich musí priznať. */
  withoutPrice: number;
  minPrice: number | null;
  maxPrice: number | null;
  /** Najstarší a najnovší čas stiahnutia riadku (ISO). */
  oldestFetchedAt: string | null;
  newestFetchedAt: string | null;
}

/* ═══════════════════════════ 3. Čistá časť ════════════════════════════════ */

/**
 * Riedke počty z databázy → súvislý rad pásiem.
 *
 * Pásmo, ktoré v odpovedi databázy CHÝBA, dostane nulu — a to je tu správne:
 * dotaz prešiel celú tabuľku, takže „žiadny riadok v tomto pásme" je meraný
 * fakt, nie medzera v poznaní. Je to presne opačný prípad než nesťahovaný deň
 * v grafe predaja a je to jediné miesto v grafoch tejto appky, kde sa nula
 * dopĺňa zámerne.
 */
export function foldBuckets(counts: ReadonlyMap<number, number>): PriceBin[] {
  const bins: PriceBin[] = [];
  for (let i = 0; i < PRICE_BIN_COUNT; i += 1) {
    bins.push({
      from: i * PRICE_BIN_WIDTH,
      to: (i + 1) * PRICE_BIN_WIDTH,
      count: counts.get(i) ?? 0,
    });
  }
  bins.push({
    from: PRICE_BIN_COUNT * PRICE_BIN_WIDTH,
    to: null,
    count: counts.get(PRICE_BIN_COUNT) ?? 0,
  });
  return bins;
}

/* ═══════════════════════════ 4. Čítanie ═══════════════════════════════════ */

/**
 * Rozdelenie cien pre graf. `conn` je výhradne pre testy — bez neho ide dotaz
 * cez pool, ako všade inde.
 */
export async function catalogPrices(conn?: Queryable): Promise<CatalogPrices> {
  const raw = await catalogRepo.priceBuckets(PRICE_BIN_WIDTH, PRICE_BIN_COUNT, conn);

  const counts = new Map<number, number>();
  for (const bucket of raw.buckets) {
    counts.set(bucket.bucket, (counts.get(bucket.bucket) ?? 0) + bucket.count);
  }

  return {
    bins: foldBuckets(counts),
    rows: raw.rows,
    withoutPrice: raw.withoutPrice,
    minPrice: raw.minPrice,
    maxPrice: raw.maxPrice,
    /* Na drôt idú ISO stringy, nie `Date`. Repozitár vracia domáci typ,
       preklad je práca tejto vrstvy — a `null` musí prežiť ako `null`. */
    oldestFetchedAt: raw.oldestFetchedAt?.toISOString() ?? null,
    newestFetchedAt: raw.newestFetchedAt?.toISOString() ?? null,
  };
}
