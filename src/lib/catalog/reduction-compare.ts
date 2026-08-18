/**
 * Aura Zľavy — POROVNANIE „ČO SME ZAPÍSALI" vs. „ČO V ESHOPE NAOZAJ JE"
 * (KONTRAKT-API-V5-2026-08-13: bod A2, rozhodnutie R2, zmena invariantu I11).
 *
 * ČO TENTO MODUL RIEŠI
 * --------------------
 * Appka doteraz vedela len to, čo sama zapísala. Keď niekto zapol zľavu v admine
 * eshopu, appka o tom nemala ako vedieť — preto nesie 17 miest v UI výhradu
 * „podľa vlastných zápisov". `GET /api/products/getFull` vracia `reduction_percent`,
 * `reduction_from` a `reduction_to`, teda SKUTOČNÝ stav. Tento modul postaví obe
 * strany vedľa seba a povie, či sedia.
 *
 * Modul je ČISTÝ: žiadna sieť, žiadna DB, žiadny čas. Dostane dva už prečítané
 * stavy a vráti výrok. Čítanie zo shopu, rozpočet a oprávnenie sú vedľa
 * (`reduction-check.ts`), aby sa dala aritmetika porovnania testovať samostatne.
 *
 * ČO SA V TOMTO MODULE NESMIE POKAZIŤ A PREČO
 * -------------------------------------------
 *  1. **Tri výroky, nikdy dva.** `match` · `differs` · `unknown`. Tretí je ten
 *     najdôležitejší a NESMIE vyzerať ako prvý: „nevieme, či zľava beží" a
 *     „zľava nebeží" sú dve rôzne vety a zliatie by z medzery v poznaní spravilo
 *     tvrdenie o produkčnom eshope (I11). Preto sa `unknown` nikdy nepočíta do
 *     zhody a nikdy nemá prázdny dôvod.
 *  2. **Rozdiel je NÁLEZ, nie chyba.** `differs` neznamená, že sa niečo pokazilo
 *     — znamená, že dve strany hovoria rôzne. Modul preto NEHĽADÁ VINNÍKA a
 *     nepíše, čo rozdiel spôsobilo (P8). Vracia hodnoty oboch strán a zoznam
 *     dostupných krokov; rozhoduje človek.
 *  3. **`getFull` hlási LEN PRÁVE BEŽIACU zľavu.** Dokumentácia v5 to hovorí
 *     doslova: „the product's **active** percentage reduction, or all three
 *     `null` if none is **currently active**". Fronta pritom zapisuje DOPREDU —
 *     zľava Z-1 sa zapisuje od 24. 7. s oknom od 4. 9. Pri takom produkte je
 *     dnešné `null` zo shopu úplne nevypovedajúce: nedá sa z neho odvodiť ani
 *     „zápis tam je", ani „zápis tam nie je". Vyhlásiť to za rozdiel by vyrobilo
 *     8 000 falošných nálezov na jednej zľave a celý nástroj by sa stal
 *     nedôveryhodným. Preto je to `unknown` s dôvodom `not_started`.
 *  4. **Neistý zápis (D45) sa nezamieňa za zápis.** Položka so stavom
 *     `uncertain` znamená „nevieme, či sa zapísalo". Nesie sa ďalej ako vlastný
 *     príznak (`writeStatus`), lebo práve pre ňu je `getFull` najcennejší:
 *     odpoveď z eshopu tú neistotu uzavrie (`resolvesUncertainWrite`).
 *  5. **Percento sa neupravuje, len zaokrúhľuje na dve desatinné miesta.**
 *     Eshop môže hlásiť zľavu mimo nášho rozsahu 1–30 (ruka v admine, flash
 *     sale). Zamlčať to alebo „opraviť" by znamenalo hlásiť zhodu tam, kde je
 *     rozdiel. Zaokrúhľuje sa preto, že `15` a `15.00` je to isté číslo, a
 *     porovnávať desatinné čísla na presnú rovnosť je chyba, nie prísnosť.
 *
 * ČO TENTO MODUL VEDOME NEVIE
 * ---------------------------
 * Či je `reduction_to` zo shopu posledný deň zľavy (vrátane), alebo prvý deň bez
 * nej. Appka posiela `to` ako POSLEDNÝ deň vrátane (`validateWriteParams`,
 * `campaigns.date_to`), PrestaShop drží okno ako `DATETIME`. Kým sa to nedá
 * odmerať naostro (chýba oprávnenie `product:read`), sa tu NIČ nenormalizuje:
 * obe hodnoty idú do výsledku tak, ako sú, a keby sa v ostrej prevádzke ukázal
 * systematický posun o jeden deň, opraví sa to podľa merania — nie podľa
 * domnienky. Odhad by tu bol horší než priznaný rozdiel.
 *
 * Vlastník: V16 (overenie skutočnosti).
 */
import type {
  DateOnly,
  DiscountPercent,
  ItemStatus,
  ShopReductionState,
} from '@/contracts';

import type { ProductWriteRow } from '@/lib/repo/insights.repo';

/* ═══════════════ 1. Čo o produkte hovoria VLASTNÉ zápisy ══════════════════ */

/**
 * Jeden vlastný zápis, ktorý sa dnešného dňa týka.
 *
 * `writeStatus` má len dve hodnoty, hoci `campaign_items.status` ich má osem:
 * `ok` (shop zápis potvrdil) a `uncertain` (D45 — odpoveď neprišla alebo
 * neprešla zod schémou, takže NEVIEME, či sa zapísalo). Zvyšné stavy sa sem
 * nedostanú: `failed`, `not_found`, `blocked`, `skipped` a `interrupted`
 * znamenajú, že sa nezapísalo, a `pending`, že sa ešte nezapisovalo — ani
 * z jedného sa nedá odvodiť očakávanie voči eshopu.
 */
export interface OwnWriteRecord {
  readonly campaignId: number;
  readonly campaignName: string;
  readonly percent: DiscountPercent;
  /** Prvý deň okna (vrátane) tak, ako ho appka poslala shopu. */
  readonly from: DateOnly;
  /** Posledný deň okna (VRÁTANE) tak, ako ho appka poslala shopu. */
  readonly to: DateOnly;
  /** Kedy sa pokus uzavrel (ISO). `null` = ešte nedobehol. */
  readonly at: string | null;
  /** `uncertain` = D45: appka nevie, či zápis prešiel (I11). */
  readonly writeStatus: 'ok' | 'uncertain';
}

/**
 * Čo appka o produkte tvrdí k porovnávanému dňu — z VLASTNÝCH zápisov.
 *
 * `ahead` je vlastný stav a nie „none": zápis je hotový, len okno sa ešte
 * nezačalo. Práve tam sa `getFull` nedá prečítať ako odpoveď (viď bod 3
 * v doc-bloku), takže zliatie s `none` by z fronty vyrobilo samé rozdiely.
 */
export type OwnReductionState =
  /** Appka nemá zápis, ktorý by sa porovnávaného dňa týkal. */
  | { readonly state: 'none' }
  /** Okno vlastného zápisu porovnávaný deň pokrýva — appka zľavu očakáva. */
  | { readonly state: 'expected'; readonly write: OwnWriteRecord }
  /** Zápis je za nami, ale okno sa ešte nezačalo (fronta píše dopredu). */
  | { readonly state: 'ahead'; readonly write: OwnWriteRecord }
  /**
   * Vlastné zápisy sa nedali prečítať (vlastná DB mlčí). NIE JE to `none`:
   * „appka nič nezapísala" je tvrdenie o vlastných dátach, ktoré nikto nevidel.
   */
  | { readonly state: 'unknown' };

/** Stavy položky, z ktorých sa dá odvodiť očakávanie voči eshopu. */
const USABLE_ITEM_STATUSES: ReadonlySet<ItemStatus> = new Set<ItemStatus>(['ok', 'uncertain']);

/** Kľúč na zoradenie „najnovší prvý" — čas uzavretia, potom id položky. */
function writeOrderKey(row: ProductWriteRow): string {
  return `${row.at ?? ''}|${String(row.itemId).padStart(12, '0')}`;
}

/**
 * Z histórie vlastných zápisov na jeden produkt vyberie ten, ktorý sa
 * porovnávaného dňa týka.
 *
 * Poradie rozhodovania je zámerne toto a nie iné:
 *   1. najnovší zápis, ktorého okno deň POKRÝVA → `expected`,
 *   2. inak najnovší zápis, ktorého okno sa ešte NEZAČALO → `ahead`,
 *   3. inak `none` (všetky okná sú za nami, alebo sme nikdy nezapísali).
 *
 * „Najnovší" sa počíta z času uzavretia pokusu, nie z okna: produkt môže byť
 * vo dvoch kampaniach naraz a platí to, čo appka poslala do shopu naposledy —
 * shop si predošlú hodnotu neodkladá.
 *
 * Vstup sa NEMUTUJE (`insightsRepo.productWrites()` ho vracia už zoradený, ale
 * spoliehať sa na cudzie `ORDER BY` by znamenalo, že zmena SQL ticho zmení
 * výrok tejto funkcie).
 */
export function deriveOwnReduction(
  writes: readonly ProductWriteRow[],
  day: DateOnly,
): OwnReductionState {
  const usable = writes
    .filter((row) => USABLE_ITEM_STATUSES.has(row.status))
    .slice()
    .sort((a, b) => writeOrderKey(b).localeCompare(writeOrderKey(a)));

  const toRecord = (row: ProductWriteRow): OwnWriteRecord => ({
    campaignId: row.campaignId,
    campaignName: row.campaignName,
    percent: row.percent,
    from: row.dateFrom,
    to: row.dateTo,
    at: row.at,
    writeStatus: row.status === 'uncertain' ? 'uncertain' : 'ok',
  });

  const covering = usable.find((row) => row.dateFrom <= day && row.dateTo >= day);
  if (covering !== undefined) return { state: 'expected', write: toRecord(covering) };

  const ahead = usable.find((row) => row.dateFrom > day);
  if (ahead !== undefined) return { state: 'ahead', write: toRecord(ahead) };

  return { state: 'none' };
}

/* ═══════════════════════════ 2. Výrok porovnania ══════════════════════════ */

/**
 * Tri výroky, ktoré sa nikdy nezlievajú:
 *  - `match`   — vlastný záznam a skutočnosť v eshope hovoria to isté,
 *  - `differs` — hovoria rôzne. Je to NÁLEZ, nie chyba,
 *  - `unknown` — appka to nevie. Nikdy sa nesmie vykresliť ako `match`.
 */
export type ReductionVerdict = 'match' | 'differs' | 'unknown';

/**
 * V čom sa strany rozchádzajú. Môže ich byť viac naraz (iné percento AJ iné okno).
 *
 * `missing` a `extra` sú zámerne dve rôzne veci: prvé je „appka zľavu zapísala,
 * eshop ju nehlási", druhé „eshop zľavu hlási, appka ju nezapisovala" — teda
 * presne tá cudzia zmena v admine, kvôli ktorej celé overovanie vzniklo.
 */
export type ReductionDifferenceKind =
  /** Obe strany hlásia zľavu, líši sa percento. */
  | 'percent'
  /** Obe strany hlásia zľavu, líši sa okno. */
  | 'window'
  /** Appka má na tento deň zápis, eshop žiadnu zľavu nehlási. */
  | 'missing'
  /** Eshop hlási zľavu, appka na tento deň žiadny zápis nemá. */
  | 'extra';

/**
 * Prečo je výrok `unknown`. Vždy vyplnené, keď je verdikt `unknown`, a vždy
 * `null` inak — prázdny dôvod by bol tichý `unknown`, teda to najhoršie.
 *
 * Podrobnosť o stave eshopu (`not_checked` · `read_failed` · `partial` ·
 * `invalid`) sa tu NEOPAKUJE — nesie ju `ShopReductionState.reason`, ktorý je
 * vo výsledku vedľa. Druhý číselník tej istej veci by sa po prvej zmene rozišiel.
 */
export type ReductionUnknownCause =
  /** Stav v eshope sa nepodarilo prečítať; podrobnosť je v `shop.reason`. */
  | 'shop_unread'
  /** Vlastné zápisy sa nedali prečítať, takže niet čo porovnať. */
  | 'own_unread'
  /** Okno vlastného zápisu sa ešte nezačalo a `getFull` hlási len bežiacu zľavu. */
  | 'not_started';

/**
 * Čo sa s výsledkom dá urobiť. Je to ZOZNAM DOSTUPNÝCH KROKOV, nie rada:
 * appka nehodnotí, prečo rozdiel vznikol (P8), a rozhodnutie necháva človeku.
 * Slová sú tu ako kódy pre UI — vetu k nim píše obrazovka, nie tento modul.
 */
export type ReductionNextStep =
  /** Netreba nič. */
  | 'none'
  /** Zľavu je možné zapísať znova (appka ju má, eshop ju nehlási). */
  | 'write_again'
  /** Strany sa nezhodujú v čísle alebo v okne — čo ďalej, rozhodne človek. */
  | 'decide'
  /** Overiť sa dá až po začiatku okna. */
  | 'check_after_start'
  /** Bez oprávnenia na čítanie produktu sa overiť nedá. */
  | 'need_permission'
  /** Čítanie sa nepodarilo; dá sa zopakovať. */
  | 'read_again';

export interface ReductionComparison {
  readonly verdict: ReductionVerdict;
  /** Čo o produkte hovoria vlastné zápisy k `day`. */
  readonly own: OwnReductionState;
  /** Čo o ňom hlási eshop. `unknown` je medzera v poznaní, nie „bez zľavy". */
  readonly shop: ShopReductionState;
  /** Prázdne pri `match` aj pri `unknown`. */
  readonly differences: readonly ReductionDifferenceKind[];
  /** Vyplnené VÝHRADNE pri `unknown`. */
  readonly unknownCause: ReductionUnknownCause | null;
  /**
   * `true` = posledný vlastný zápis skončil ako „nevieme, či sa zapísalo" (D45)
   * a eshop na otázku odpovedal, takže tá neistota je uzavretá. Je to fakt
   * o stave poznania, nie tvrdenie o príčine.
   */
  readonly resolvesUncertainWrite: boolean;
  readonly nextStep: ReductionNextStep;
}

/** Percento na dve desatinné miesta — `15` a `15.00` je to isté číslo. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Postaví vlastný záznam a skutočnosť zo shopu vedľa seba.
 *
 * Poradie vetiev je nosné a mení význam, keby sa prehodilo:
 *
 *   1. **Nečitateľné vlastné zápisy prebíjajú všetko.** Keď appka nevie, čo sama
 *      zapísala, nemá čo s čím porovnať — nech eshop hlási čokoľvek. Prečítať to
 *      ako „nič sme nezapísali" by z každej bežiacej zľavy spravilo cudziu zmenu
 *      v admine. Preto je táto vetva PRVÁ: keby bola druhá, výsledok by ukazoval
 *      na eshop tam, kde je pokazená vlastná DB, a poslal by človeka opravovať
 *      zlú vec.
 *   2. **Nečitateľný stav eshopu je druhý.** Keď `getFull` neodpovedal, nedá sa
 *      povedať ani „sedí", ani „rozchádza sa".
 *   3. **Zápis dopredu s tichým eshopom je `unknown`, nie rozdiel.** Viď bod 3
 *      v doc-bloku modulu: `getFull` hlási len práve bežiacu zľavu.
 *   4. Zvyšok je štvorpolová tabuľka „máme / nemáme" × „eshop hlási / nehlási".
 *
 * @param own   čo hovoria vlastné zápisy (`deriveOwnReduction`)
 * @param shop  čo hlási eshop (`ProductFullDetail.reduction`)
 */
export function compareReduction(
  own: OwnReductionState,
  shop: ShopReductionState,
): ReductionComparison {
  const uncertainWrite =
    (own.state === 'expected' || own.state === 'ahead') && own.write.writeStatus === 'uncertain';

  const base = {
    own,
    shop,
    // Neistota z D45 je uzavretá vždy, keď eshop odpovedal — teda keď jeho stav
    // NIE JE `unknown`. Či odpovedal „beží" alebo „nebeží", je až druhá otázka.
    resolvesUncertainWrite: uncertainWrite && shop.state !== 'unknown',
  } as const;

  /* ── 1. vlastné zápisy sa nedali prečítať ───────────────────────────────── */

  if (own.state === 'unknown') {
    return {
      ...base,
      verdict: 'unknown',
      differences: [],
      unknownCause: 'own_unread',
      nextStep: 'read_again',
    };
  }

  /* ── 2. eshop sa nedal prečítať ─────────────────────────────────────────── */

  if (shop.state === 'unknown') {
    return {
      ...base,
      verdict: 'unknown',
      differences: [],
      unknownCause: 'shop_unread',
      // `not_checked` je typicky chýbajúce oprávnenie; ostatné dôvody sa dajú
      // skúsiť znova. Rozlíšenie je tu preto, aby obrazovka neposielala človeka
      // klikať na „skúsiť znova" pri veci, ktorú tlačidlo nespraví.
      nextStep: shop.reason === 'not_checked' ? 'need_permission' : 'read_again',
    };
  }

  /* ── 3. zápis dopredu, ktorého okno sa ešte nezačalo ────────────────────── */

  if (own.state === 'ahead') {
    if (shop.state === 'none') {
      return {
        ...base,
        verdict: 'unknown',
        differences: [],
        unknownCause: 'not_started',
        nextStep: 'check_after_start',
      };
    }
    // Eshop hlási bežiacu zľavu. Keď je to presne tá, ktorú appka zapísala
    // dopredu, sedí — a mimochodom sa tým dozvedáme, že shop okná do budúcnosti
    // hlási. Keď je iná, beží na produkte niečo, čo appka na dnešok nezapisovala.
    const sameAsPlanned =
      round2(shop.percent) === round2(own.write.percent) &&
      shop.from === own.write.from &&
      shop.to === own.write.to;
    return sameAsPlanned
      ? { ...base, verdict: 'match', differences: [], unknownCause: null, nextStep: 'none' }
      : { ...base, verdict: 'differs', differences: ['extra'], unknownCause: null, nextStep: 'decide' };
  }

  /* ── 4. appka na tento deň nič nezapísala ───────────────────────────────── */

  if (own.state === 'none') {
    if (shop.state === 'none') {
      return { ...base, verdict: 'match', differences: [], unknownCause: null, nextStep: 'none' };
    }
    return { ...base, verdict: 'differs', differences: ['extra'], unknownCause: null, nextStep: 'decide' };
  }

  /* ── 5. appka zľavu na tento deň zapísala ───────────────────────────────── */

  if (shop.state === 'none') {
    return {
      ...base,
      verdict: 'differs',
      differences: ['missing'],
      unknownCause: null,
      nextStep: 'write_again',
    };
  }

  const differences: ReductionDifferenceKind[] = [];
  if (round2(shop.percent) !== round2(own.write.percent)) differences.push('percent');
  if (shop.from !== own.write.from || shop.to !== own.write.to) differences.push('window');

  return differences.length === 0
    ? { ...base, verdict: 'match', differences: [], unknownCause: null, nextStep: 'none' }
    : { ...base, verdict: 'differs', differences, unknownCause: null, nextStep: 'decide' };
}

/* ═══════════════════════════ 3. Súhrn pre obrazovku ═══════════════════════ */

/**
 * Počty po výrokoch. `unknown` je vlastné číslo a NIKDY sa nepripočítava
 * k `match` — súčet troch čísel je počet porovnaných produktov, nie viac.
 */
export interface ReductionSummary {
  readonly match: number;
  readonly differs: number;
  readonly unknown: number;
}

export function summarizeReductions(
  comparisons: readonly Pick<ReductionComparison, 'verdict'>[],
): ReductionSummary {
  let match = 0;
  let differs = 0;
  let unknown = 0;
  for (const item of comparisons) {
    if (item.verdict === 'match') match += 1;
    else if (item.verdict === 'differs') differs += 1;
    else unknown += 1;
  }
  return { match, differs, unknown };
}
