/**
 * Aura Zľavy — ČISTÉ POČÍTANIE KPI RIADKU PREHĽADU (D136, V6b krok 1/3).
 *
 * D136 hovorí „riadok dlaždíc s pilulkou smeru hore, hlavný graf pod nimi":
 * číslo najprv, priebeh druhý. Tento modul je to „číslo" — bez Reactu, bez
 * `fetch`, bez databázy, aby sa celá jeho pravdivosť dala dokázať bez
 * prehliadača. Vykresľuje `KpiRow.tsx`.
 *
 * ═══ TROJSTAVOVOSŤ JE TU JADRO, NIE OKRAJ (I11) ═══
 *
 * Každá dlaždica smie ukázať PRESNE jedno z troch:
 *   · hodnotu (aj nulu — nula je meraný fakt),
 *   · pomlčku `—`, teda „nevieme",
 *   · dolnú hranicu `≥ N`, teda „zmerali sme, ale okno nie je celé".
 *
 * Rozhodovanie o tom NEROBÍ tento modul sám: pre počty ho robí `statValue()`
 * z `ui/kpi.ts` (vrátane pravidla, že `≥ 0` sa nevykreslí nikdy — je to prázdna
 * veta, nie priznanie). Tu je len jedna vec, ktorú `statValue()` robiť nemôže:
 * TRŽBA. Suma je desatinný REŤAZEC z `DECIMAL(12,2)` a prevod na `number` by
 * na tridsiatich dňoch stratil halier, ktorý by nikto nevedel vysvetliť —
 * preto má vlastnú cestu (`moneyValue()`), ale tie isté tri stavy a ten istý
 * znak `≥`.
 *
 * ═══ PILULKA SMERU: ODKIAĽ SA BERIE „OPROTI ČOMU" ═══
 *
 * Obe okenné dlaždice porovnávajú okno s PREDCHÁDZAJÚCIM oknom rovnakej dĺžky.
 * Nie je to nový endpoint (nesmel by vzniknúť): `/api/insights/sales-daily`
 * aj `/api/insights/revenue-daily` majú `?anchor=`, ktorý posúva „dnešok"
 * odpovede, takže predchádzajúce okno je tá istá route s iným kotvením.
 *
 * Porovnanie sa pripustí LEN vtedy, keď sú SPLNENÉ VŠETKY tri podmienky:
 *   1. obe okná sú `measured` — dolná hranica oproti dolnej hranici nie je
 *      zmena, ale rozdiel dvoch nedočítaných čísel,
 *   2. okná na seba KALENDÁRNE naväzujú (`prev.to` je deň pred `cur.from`) —
 *      kotva sa počíta na klientovi z „dneška", takže na hrane polnoci sa môže
 *      s dňom servera rozísť o jeden deň a okná by sa prekryli,
 *   3. staršie okno je nenulové — delenie nulou dá „+∞ %", čo nie je
 *      informácia, ale hluk.
 *
 * Inak je zmena `null` a `DeltaPill` z nej nakreslí pomlčku a slovo „zmenu
 * nevieme". **Nikdy nie 0 %.** Nula je tvrdenie „nič sa nezmenilo" a appka ho
 * o nezmeranom období urobiť nesmie; presne to je štvrtý stav pilulky.
 *
 * Samotné percento počíta `trendPercent()` zo `sales-view.ts` — to isté
 * pravidlo, aké má sekcia Predaj. Druhý výpočet zmeny by sa s ním rozišiel.
 *
 * ═══ ČO SA TU NESMIE POKAZIŤ ═══
 *
 * 1. **Tržba per produkt NEEXISTUJE** (D117, I11). Objednávkové API ceny
 *    položiek nevracia, takže euro je VÝHRADNE denný súčet za celý eshop.
 *    Preto sa dlaždica volá „Tržba celého eshopu" a nie „Tržba" — bez tej
 *    menovky si suma sadne vedľa dlaždice kusov a prečíta sa ako ich obrat.
 * 2. **Meny sa nesčítavajú.** 125,50 EUR plus 2 500 CZK nie je 2 625,50
 *    čohokoľvek. Dlaždica ukáže JEDNU menu (`primaryRevenueSeries()`,
 *    deterministicky) a v detaile POVIE, že ďalšie sú v sekcii Predaj —
 *    nezamlčí ich a nezleje.
 * 3. **`undefined` a `null` nie sú to isté.** `undefined` = „nežiadali sme"
 *    (okno sa práve ťahá) a vtedy sa NEPRIZNÁVA medzera v dátach — to by bolo
 *    tvrdenie o eshope namiesto tvrdenia o načítaní. `null` = „odpoveď sa
 *    nedala prečítať" a to sa povedať MUSÍ.
 * 4. **Popisky sú ZABEHNUTÉ formulácie.** „Zľavy bežia", „Pripravené",
 *    „zlacnených produktov podľa vlastných zápisov" a „aspoň toľko, časť dní
 *    nemáme celú" už v appke stoja (`StatusSection.tsx`, `SalesSection.tsx`).
 *    Druhá formulácia toho istého priznania sa raz rozíde s prvou.
 * 5. **Porovnáva sa explicitne** (`=== null`, `=== undefined`). Turbopack tu
 *    už raz zahodil skrátený null-guard ako compile-time falsy.
 *
 * Vlastník: V6b, KPI riadok Prehľadu.
 */
/*
 * `dayCount()` sa NEPÍŠE znova. Tvar „30 dní" už v appke je a je EXPORTOVANÝ
 * (`campaigns/queue-model.ts`); jeho vlastná kópia je v tomto repe štvrtá
 * a piata by bola presne to, čomu CLAUDE.md hovorí „to isté číslo nesmie žiť
 * na dvoch miestach". Import je čistá funkcia, žiadny React ani `fetch`.
 */
import { dayCount } from '@/components/campaigns/queue-model';
import type { CalmNumbers, OverviewWindow } from '@/components/dashboard/overview-model';
import { dayFromNumber, dayNumber, trendPercent } from '@/components/dashboard/sales-view';
import type {
  RevenueDailyView,
  RevenueSeriesView,
  SalesWindowView,
} from '@/components/dashboard/window-api';
import {
  KPI_LOWER_BOUND,
  KPI_UNKNOWN,
  statValue,
  type DeltaSense,
  type StatValueView,
} from '@/components/ui/kpi';
import type { StatAccent } from '@/components/ui/StatTile';
import type { EnrichStatePayload } from '@/lib/catalog/enrich-view';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

/* ═════════════════════════ 1. Tvar jednej dlaždice ════════════════════════ */

/**
 * Štyri dlaždice, uzavretý zoznam a ZÁVÄZNÉ poradie.
 *
 * Poradie je poradím otázky, na ktorú Prehľad odpovedá („čo sa predáva, čo
 * leží, čo robia moje zľavy"): čo sa predalo → čo to zarobilo → čo z toho
 * robia naše zľavy → o koľkých produktoch to appka vôbec vie. Piata dlaždica
 * sa pridáva TU, nie na obrazovke.
 */
export const KPI_TILE_IDS = ['predane', 'trzba', 'zlavy', 'obohatene'] as const;

export type KpiTileId = (typeof KPI_TILE_IDS)[number];

/** Pilulka smeru dlaždice. `value: null` = „zmenu nevieme", NIKDY nie nula. */
export interface KpiDelta {
  readonly value: number | null;
  readonly suffix: string;
  readonly digits: number;
  /** Čo znamená RAST. Bez neho pilulka nefarbí (`ui/kpi.ts` bod 6). */
  readonly sense: DeltaSense;
  /** Veta pod kurzorom. `null` = nechaj predvolené priznanie pilulky. */
  readonly title: string | null;
}

export interface KpiTile {
  readonly id: KpiTileId;
  readonly label: string;
  /** Hodnota a to, čím naozaj je — hodnota, pomlčka, alebo dolná hranica. */
  readonly value: StatValueView;
  /** Riadok pod hodnotou: rozsah, obdobie pilulky a priznanie medzery. */
  readonly detail: string;
  /**
   * Smer zmeny. `null` = táto dlaždica porovnanie NEMÁ (nie „nepoznáme ho"):
   * počet práve bežiacich zliav je momentka, nie meranie za obdobie, a
   * pilulka „zmenu nevieme" by pri ňom sľubovala porovnanie, ktoré neexistuje.
   */
  readonly delta: KpiDelta | null;
  /** Zdôraznenie, NIE stav. Zlatú má JEDNA dlaždica radu (`ui/StatTile.tsx`). */
  readonly accent: StatAccent;
}

/* ══════════════════════════ 2. Vstup celého radu ══════════════════════════ */

export interface KpiRowInput {
  readonly windowDays: OverviewWindow;
  /** Súhrn okna kusov. `undefined` = nežiadali sme, `null` = neprečítalo sa. */
  readonly sold?: SalesWindowView | null;
  /** To isté za PREDCHÁDZAJÚCE okno — jediný zdroj „oproti čomu". */
  readonly soldBefore?: SalesWindowView | null;
  readonly revenue?: RevenueDailyView | null;
  readonly revenueBefore?: RevenueDailyView | null;
  /** Čísla pokojného stavu zo zoznamu zliav. `null` = zoznam sa neprečítal. */
  readonly calm: CalmNumbers | null;
  readonly enrich?: EnrichStatePayload | null;
}

/* ════════════════════════════ 3. Slová a čísla ════════════════════════════ */

/**
 * Peňažný reťazec a mena → `„1 234,50 €"`.
 *
 * Delí sa MEDZERA, desatinná ČIARKA — to isté pravidlo ako `formatEur()`
 * v `lib/ui/format.ts`; test to porovnáva výstupmi, nie zdrojovým textom, aby
 * sa dva tvary jedného čísla nemohli rozísť. Rozdiel je jediný: mena nie je
 * zabetónovaná na euro, lebo eshop vracia rady po menách.
 *
 * `null` pri nečitateľnej sume — cenu si NEVYMÝŠĽAME.
 */
export function formatMoneySk(
  value: string | number | null | undefined,
  currency: string,
): string | null {
  if (value === null || value === undefined || value === '') return null;
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) return null;
  const [int, frac] = Math.abs(amount).toFixed(2).split('.');
  const grouped = formatCountSk(Number(int));
  const sign = amount < 0 ? '−' : '';
  const unit = currency === 'EUR' ? '€' : currency;
  return `${sign}${grouped},${frac} ${unit}`;
}

/** Deň pred zadaným dňom. `null` pri nečitateľnom vstupe — nehádame. */
export function dayBefore(day: string): string | null {
  const number = dayNumber(day);
  if (number === null) return null;
  return dayFromNumber(number - 1);
}

/**
 * Kotva PREDCHÁDZAJÚCEHO okna: „dnešok" mínus dĺžka okna.
 *
 * Aktuálne okno je `[dnes − (N−1), dnes]`, takže predchádzajúce je
 * `[dnes − (2N−1), dnes − N]` a jeho kotva (posledný deň) je `dnes − N`.
 * `null` pri nečitateľnom dni — vtedy sa predchádzajúce okno vôbec nežiada.
 */
export function previousWindowAnchor(today: string, windowDays: number): string | null {
  const number = dayNumber(today);
  if (number === null) return null;
  return dayFromNumber(number - windowDays);
}

/**
 * Naväzujú okná na seba kalendárne?
 *
 * Podmienka 2 z hlavičky. Kotva sa počíta na klientovi, takže medzi 23:00 a
 * polnocou sa „dnešok" prehliadača a „dnešok" servera môžu rozísť o deň — a
 * dve okná, ktoré sa prekrývajú, by dali percento, ktoré nemeria nič.
 */
export function windowsAdjoin(
  before: { readonly to: string },
  current: { readonly from: string },
): boolean {
  return before.to === dayBefore(current.from);
}

/* ═════════════════════ 4. Dlaždica: predané kusy ══════════════════════════ */

const SOLD_UNREADABLE = 'predaj za okno sa nepodarilo prečítať';
const REVENUE_UNREADABLE = 'tržbu celého eshopu sa nepodarilo prečítať';
/** Zabehnutá formulácia zo sekcie Predaj — dve verzie by sa rozišli. */
const NO_DAY_AT_ALL = 'ani jeden deň okna zatiaľ nemáme';
const LOWER_BOUND_WORD = 'aspoň toľko, časť dní nemáme celú';
const AGAINST_PREVIOUS = 'oproti minulému oknu';

/** Veta pod kurzorom pilulky, keď porovnanie EXISTUJE. */
function previousWindowTitle(windowDays: number): string {
  return `Oproti predchádzajúcim ${dayCount(windowDays)} rovnakej dĺžky.`;
}

/**
 * Zmena kusov medzi oknami. `null` vždy, keď čo i len jedna podmienka
 * z hlavičky nedrží — a `null` je „zmenu nevieme", nie nula.
 */
export function soldChangePercent(
  before: SalesWindowView | null | undefined,
  current: SalesWindowView | null | undefined,
): number | null {
  if (before === null || before === undefined) return null;
  if (current === null || current === undefined) return null;
  if (before.unitsState !== 'measured' || current.unitsState !== 'measured') return null;
  if (!windowsAdjoin(before, current)) return null;
  return trendPercent(before.windowUnits, current.windowUnits);
}

export function soldTile(input: KpiRowInput): KpiTile {
  const { sold, windowDays } = input;
  const delta: KpiDelta = {
    value: soldChangePercent(input.soldBefore, sold),
    suffix: '%',
    digits: 0,
    sense: 'rise-good',
    title: null,
  };
  const withTitle: KpiDelta =
    delta.value === null ? delta : { ...delta, title: previousWindowTitle(windowDays) };

  const base = `za ${dayCount(windowDays)} · povolené produkty`;
  const tail = ` · ${AGAINST_PREVIOUS}`;

  if (sold === undefined) {
    /* Nežiadali sme — medzeru v dátach NEPRIZNÁVAME, to by bolo tvrdenie
       o eshope namiesto tvrdenia o načítaní. */
    return tile('predane', 'Predané kusy', unknownValue(), base, withTitle, 'gold');
  }
  if (sold === null) {
    return tile('predane', 'Predané kusy', unknownValue(), `${base} · ${SOLD_UNREADABLE}`, withTitle, 'gold');
  }

  const lowerBound = sold.unitsState === 'lower_bound';
  const value = statValue(sold.windowUnits, { lowerBound });
  const detail =
    sold.unitsState === 'unknown'
      ? `${base} · ${NO_DAY_AT_ALL}`
      : lowerBound
        ? `${base} · ${missingDaysPhrase(sold.unknownDays)}${tail}`
        : `${base}${tail}`;
  return tile('predane', 'Predané kusy', value, detail, withTitle, 'gold');
}

/**
 * Priznanie dolnej hranice s ČÍSLOM, keď ho appka má.
 *
 * Tri stavy, nie dva: číslo je zmeraná medzera, `null` znamená, že odpoveď
 * zoznam chýbajúcich dní vôbec nenesie. Mlčanie pri `null` by sa prečítalo
 * ako „okno je celé", a to je práve to, čo dolná hranica popiera.
 */
function missingDaysPhrase(unknownDays: number | null): string {
  if (unknownDays === null) return 'aspoň toľko, koľko dní okna chýba, nevieme';
  if (unknownDays <= 0) return LOWER_BOUND_WORD;
  return `aspoň toľko, ${dayCount(unknownDays)} okna nemáme`;
}

/* ══════════════════ 5. Dlaždica: tržba celého eshopu ══════════════════════ */

/**
 * Ktorá mena reprezentuje okno. Deterministicky: najviac dní s riadkom, pri
 * rovnosti abecedne podľa kódu meny.
 *
 * NIE „prvá v odpovedi": server ich vracia zoradené abecedne, takže by
 * o hlavnej mene rozhodlo písmeno, nie objem. A NIE súčet — meny sa
 * nesčítavajú (bod 2 hlavičky).
 */
export function primaryRevenueSeries(
  series: readonly RevenueSeriesView[],
): RevenueSeriesView | null {
  let best: RevenueSeriesView | null = null;
  for (const row of series) {
    if (best === null) {
      best = row;
      continue;
    }
    if (row.days.length > best.days.length) best = row;
    else if (row.days.length === best.days.length && row.currency < best.currency) best = row;
  }
  return best;
}

/**
 * Suma jednej meny → tri stavy jednej hodnoty.
 *
 * Znak `≥` je ten istý, aký píše `statValue()`; a rovnako ako tam sa `≥ 0`
 * NEVYKRESLÍ nikdy — „zarobilo sa aspoň nič" je prázdna veta, nie priznanie.
 */
export function moneyValue(
  sum: string | null,
  currency: string,
  lowerBound: boolean,
): StatValueView {
  const text = formatMoneySk(sum, currency);
  if (text === null) return unknownValue();
  if (lowerBound && Number(sum) === 0) return unknownValue();
  return {
    text: lowerBound ? `${KPI_LOWER_BOUND} ${text}` : text,
    unknown: false,
    lowerBound,
  };
}

/** Zmena tržby medzi oknami — tá istá brána ako pri kusoch, plus ROVNAKÁ MENA. */
export function revenueChangePercent(
  before: RevenueDailyView | null | undefined,
  current: RevenueDailyView | null | undefined,
): number | null {
  if (before === null || before === undefined) return null;
  if (current === null || current === undefined) return null;
  if (!windowsAdjoin(before, current)) return null;

  const now = primaryRevenueSeries(current.series);
  if (now === null || now.sumState !== 'measured' || now.sum === null) return null;
  const then = before.series.find((row) => row.currency === now.currency);
  if (then === undefined || then.sumState !== 'measured' || then.sum === null) return null;

  const a = Number(then.sum);
  const b = Number(now.sum);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return trendPercent(a, b);
}

export function revenueTile(input: KpiRowInput): KpiTile {
  const { revenue, windowDays } = input;
  const label = 'Tržba celého eshopu';
  const raw: KpiDelta = {
    value: revenueChangePercent(input.revenueBefore, revenue),
    suffix: '%',
    digits: 0,
    sense: 'rise-good',
    title: null,
  };
  const delta: KpiDelta =
    raw.value === null ? raw : { ...raw, title: previousWindowTitle(windowDays) };
  const base = `za ${dayCount(windowDays)} · ${AGAINST_PREVIOUS}`;

  if (revenue === undefined) {
    return tile('trzba', label, unknownValue(), `za ${dayCount(windowDays)}`, delta, 'none');
  }
  if (revenue === null) {
    return tile('trzba', label, unknownValue(), `za ${dayCount(windowDays)} · ${REVENUE_UNREADABLE}`, delta, 'none');
  }

  const primary = primaryRevenueSeries(revenue.series);
  if (primary === null) {
    return tile('trzba', label, unknownValue(), `za ${dayCount(windowDays)} · ${NO_DAY_AT_ALL}`, delta, 'none');
  }

  const lowerBound = primary.sumState === 'lower_bound';
  const value =
    primary.sumState === 'unknown'
      ? unknownValue()
      : moneyValue(primary.sum, primary.currency, lowerBound);
  const others = revenue.series.length - 1;
  const parts = [base];
  if (lowerBound) parts.push(LOWER_BOUND_WORD);
  if (others > 0) {
    /* Zamlčať druhú menu by znamenalo, že dlaždica ukazuje časť tržby ako
       celú. Sčítať ju nemožno, tak sa aspoň POVIE, že existuje a kde je. */
    parts.push(
      `${formatCountSk(others)} ${pluralSk(others, 'ďalšia mena', 'ďalšie meny', 'ďalších mien')} v Predaji`,
    );
  }
  return tile('trzba', label, value, parts.join(' · '), delta, 'none');
}

/* ═════════════════════ 6. Dlaždice bez porovnania ═════════════════════════ */

/**
 * Zľavy, ktoré zákazníci PRÁVE vidia.
 *
 * Popisky sú zabehnuté zo stavovej sekcie („Zľavy bežia", „Pripravené",
 * „zlacnených produktov podľa vlastných zápisov"). To posledné je I11:
 * appka pozná svoje ZÁPISY, nie stav eshopu, a nesmie tvrdiť druhé.
 */
export function discountsTile(input: KpiRowInput): KpiTile {
  const { calm } = input;
  if (calm === null) {
    return tile(
      'zlavy',
      'Zľavy bežia',
      unknownValue(),
      'zoznam zliav sa nepodarilo prečítať',
      null,
      'none',
    );
  }
  const ready = `${formatCountSk(calm.ready)} ${pluralSk(calm.ready, 'pripravená', 'pripravené', 'pripravených')}`;
  const detail = `${ready} · ${formatCountSk(calm.discounted)} zlacnených produktov podľa vlastných zápisov`;
  return tile('zlavy', 'Zľavy bežia', statValue(calm.live), detail, null, 'none');
}

/**
 * Koľko z katalógu appka naozaj ZMERALA.
 *
 * Pilulka tu nemeria okno, ale DNEŠOK: `enrichedToday` je jediné číslo zmeny,
 * ktoré appka o obohacovaní má. `null` = dávka dnes nebežala, takže dnešný
 * prírastok NEPOZNÁME — a to nie je nula (`enrich-view.ts` bod 3).
 *
 * Percento sa tu ZÁMERNE nepočíta: `enrichCoverageSentence()` ho už formátuje
 * a druhý formátovač percenta by sa s ním rozišiel. Podiel je v Nastaveniach.
 */
export function enrichTile(input: KpiRowInput): KpiTile {
  const label = 'Obohatené z katalógu';
  const payload = input.enrich;
  const today = payload === null || payload === undefined ? null : payload.state?.enrichedToday;
  const delta: KpiDelta = {
    value: today === undefined ? null : today,
    suffix: 'ks',
    digits: 0,
    sense: 'rise-good',
    title:
      today === null || today === undefined
        ? 'Dávka obohacovania dnes nebežala, takže dnešný prírastok nepoznáme. Nie je to nula.'
        : 'Koľko produktov dávka obohatila dnes.',
  };

  if (payload === undefined) {
    return tile('obohatene', label, unknownValue(), 'zmena za dnes', delta, 'none');
  }
  if (payload === null) {
    return tile(
      'obohatene',
      label,
      unknownValue(),
      'stav dávky sa nepodarilo prečítať',
      delta,
      'none',
    );
  }

  const { enriched, catalogProducts } = payload.coverage;
  const detail =
    catalogProducts === null
      ? `z koľkých, appka nevie · zmena za dnes`
      : `z ${formatCountSk(catalogProducts)} v zrkadle · zmena za dnes`;
  return tile('obohatene', label, statValue(enriched), detail, delta, 'none');
}

/* ═══════════════════════════ 7. Celý rad ══════════════════════════════════ */

/**
 * Štyri dlaždice v záväznom poradí `KPI_TILE_IDS`.
 *
 * ZLATÚ má PRESNE JEDNA (`predane`) — vlas zdôraznenia hovorí „pozri sa sem
 * prvý" a keby ho mali dve, neznamenal by nič. Stráži to test.
 */
export function kpiTiles(input: KpiRowInput): readonly KpiTile[] {
  return [soldTile(input), revenueTile(input), discountsTile(input), enrichTile(input)];
}

/* ══════════════════════════ 8. Drobné pomôcky ═════════════════════════════ */

/** Pomlčka „nevieme" — ten istý znak, aký appka píše v tabuľkách a v grafoch. */
function unknownValue(): StatValueView {
  return { text: KPI_UNKNOWN, unknown: true, lowerBound: false };
}

function tile(
  id: KpiTileId,
  label: string,
  value: StatValueView,
  detail: string,
  delta: KpiDelta | null,
  accent: StatAccent,
): KpiTile {
  return { id, label, value, detail, delta, accent };
}
