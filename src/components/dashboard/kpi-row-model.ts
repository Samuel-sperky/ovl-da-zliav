/**
 * Aura Zľavy — ČISTÉ POČÍTANIE KPI RIADKU PREHĽADU (V7: D148, D152, D154, D155).
 *
 * D152 zúžil Prehľad na štyri sekcie a rad KPI je prvá z nich. Karty sú TRI,
 * nie štyri, a v tomto poradí:
 *
 *   1. **Produktov v katalógu** — koľko riadkov má miestna kópia katalógu,
 *   2. **V zľave** — koľko produktov je DNES v okne zľavy podľa VLASTNÝCH
 *      zápisov appky (I11) a aký podiel katalógu to je,
 *   3. **Predané na sklad** — `soldPerStock` ako `N×` za vybrané okno.
 *
 * Modul je bez Reactu, bez `fetch` a bez databázy, aby sa celá pravdivosť radu
 * dala dokázať bez prehliadača. Vykresľuje ho `KpiRow.tsx`.
 *
 * ═══ AKO SA TRETIA KARTA VOLÁ A PREČO PRÁVE TAK (D148, K3) ═══
 * Samuel si vyžiadal účtovný pomer zásoby a predaja. Ten sa z dát appky
 * spočítať NEDÁ: zásoba z `getFull` je jedna momentka, nie priemer za obdobie,
 * a nákupné ceny appka nemá. Karta preto nesie inú veličinu s iným významom —
 * `soldPerStock`, teda „predané za okno ÷ dnešný sklad" — a volá sa **Predané
 * na sklad**. Meno účtovnej metriky je v tomto repe zakázané slovo a stráži to
 * `test/unit/sales-insights.spec.ts`; tento súbor je v jeho zozname.
 *
 * ═══ TROJSTAVOVOSŤ JE TU JADRO, NIE OKRAJ (I11, K4) ═══
 *
 * Každá karta smie ukázať PRESNE jedno z troch:
 *   · hodnotu (aj nulu — nula je meraný fakt),
 *   · pomlčku `—`, teda „nevieme",
 *   · dolnú hranicu `≥ N`, teda „zmerali sme, ale okno nie je celé".
 *
 * Rozhodovanie nerobí tento modul sám: pre počty ho robí `statValue()`
 * z `ui/kpi.ts` (vrátane pravidla, že `≥ 0` sa nevykreslí NIKDY — je to prázdna
 * veta, nie priznanie). Pomer má vlastnú cestu (`ratioValue()`), pretože sa
 * nepíše ako počet, ale tie isté tri stavy a ten istý znak `≥` platia aj preň.
 *
 * DNEŠNÝ BEŽNÝ STAV JE POMLČKA (R4). Appka je bez `shop_write` kľúča a jej IP
 * je zabanovaná, takže rad musí vyzerať dobre PRÁZDNY: karta nemá „prázdny"
 * variant a pomlčka je v nej riadna hodnota s vlastnou tlmenou farbou.
 *
 * ═══ ČO SA TU NESMIE POKAZIŤ ═══
 *
 * 1. **„V zľave" je podľa VLASTNÝCH zápisov, nie podľa eshopu** (I11, D156).
 *    Zľava nastavená ručne v administrácii je pre appku neviditeľná, takže
 *    číslo je o tom, čo appka zapísala — a menovka to musí povedať. Karta bez
 *    tej vety by tvrdila, koľko produktov je zlacnených v eshope.
 * 2. **Podiel a menovateľ musia byť z JEDNEJ odpovede.** Oba čítame
 *    z `catalog-distribution?by=own-discount` (`kpi-api.ts`). Keby sa počet
 *    zliav bral odtiaľ a počet riadkov z inej route, karta by delila dnešné
 *    číslo včerajším a nikto by si to nevšimol.
 * 3. **Pilulku smeru má LEN tretia karta.** Prvé dve sú momentky, nie meranie
 *    za obdobie: pilulka „zmenu nevieme" by pri nich sľubovala porovnanie,
 *    ktoré neexistuje. To nie je to isté ako `value: null` (= „porovnanie máme
 *    z čoho robiť, ale zmenu nepoznáme"). **Nula sa ako zmena nekreslí NIKDY.**
 * 4. **Porovnanie sa pripustí len pri splnení VŠETKÝCH troch podmienok** —
 *    obe okná `measured` (dolná hranica oproti dolnej hranici nie je zmena),
 *    okná na seba KALENDÁRNE naväzujú (kotva sa počíta na klientovi a na hrane
 *    polnoci sa môže s dňom servera rozísť o deň) a staršie okno je nenulové
 *    (delenie nulou dá „+∞ %", čo je hluk, nie informácia).
 * 5. **Zlatý vlas má PRESNE JEDNA karta** — tretia. Vlas hovorí „pozri sa sem
 *    prvý" a dostáva ho karta, ktorú ovláda prepínač okna a ktorú tabuľka pod
 *    grafom rozpisuje (D155). Dva vlasy neznamenajú nič a test to stráži.
 * 6. **Popisky sú ZABEHNUTÉ formulácie.** „aspoň toľko, časť dní nemáme celú",
 *    „ani jeden deň okna zatiaľ nemáme", „podľa vlastných zápisov" a „v zrkadle"
 *    už v appke stoja. Druhá formulácia toho istého priznania sa raz rozíde
 *    s prvou.
 * 7. **Porovnáva sa explicitne** (`=== null`, `=== undefined`). Turbopack tu
 *    už raz zahodil skrátený null-guard ako compile-time falsy.
 *
 * Vlastník: V7, krok 1/4 (KPI riadok a prepínače okna).
 */
/*
 * `dayCount()` sa NEPÍŠE znova. Tvar „30 dní" už v appke je a je EXPORTOVANÝ
 * (`campaigns/queue-model.ts`); jeho vlastná kópia by bola v tomto repe piata.
 * Import je čistá funkcia, žiadny React ani `fetch`.
 */
import { dayCount } from '@/components/campaigns/queue-model';
import type { OwnDiscountShareView, SoldPerStockView } from '@/components/dashboard/kpi-api';
import { dayFromNumber, dayNumber, trendPercent } from '@/components/dashboard/sales-view';
import type { SoldWindow } from '@/components/dashboard/sold-window';
import {
  KPI_LOWER_BOUND,
  KPI_UNKNOWN,
  statValue,
  type DeltaSense,
  type StatValueView,
} from '@/components/ui/kpi';
import type { StatAccent } from '@/components/ui/StatTile';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

/* ═════════════════════════ 1. Tvar jednej karty ═══════════════════════════ */

/**
 * Tri karty, uzavretý zoznam a ZÁVÄZNÉ poradie (D152).
 *
 * Poradie je poradím otázky, na ktorú Prehľad odpovedá: o koľkých produktoch
 * appka vôbec vie → čo z nich práve zlacnila → ako rýchlo sa tovar hýbe.
 * Štvrtá karta sa pridáva TU, nie na obrazovke.
 */
export const KPI_CARD_IDS = ['katalog', 'zlacnene', 'predane-na-sklad'] as const;

export type KpiCardId = (typeof KPI_CARD_IDS)[number];

/** Pilulka smeru karty. `value: null` = „zmenu nevieme", NIKDY nie nula. */
export interface KpiDelta {
  readonly value: number | null;
  readonly suffix: string;
  readonly digits: number;
  /** Čo znamená RAST. Bez neho pilulka nefarbí (`ui/kpi.ts` bod 6). */
  readonly sense: DeltaSense;
  /** Veta pod kurzorom. `null` = nechaj predvolené priznanie pilulky. */
  readonly title: string | null;
}

export interface KpiCard {
  readonly id: KpiCardId;
  readonly label: string;
  /** Hodnota a to, čím naozaj je — hodnota, pomlčka, alebo dolná hranica. */
  readonly value: StatValueView;
  /** Riadok pod hodnotou: rozsah, z čoho je počítaná a priznanie medzery. */
  readonly detail: string;
  /**
   * Smer zmeny. `null` = táto karta porovnanie NEMÁ (nie „nepoznáme ho") —
   * pozri bod 3 hlavičky.
   */
  readonly delta: KpiDelta | null;
  /** Zdôraznenie, NIE stav. Zlatú má PRESNE JEDNA karta radu (bod 5). */
  readonly accent: StatAccent;
}

/* ══════════════════════════ 2. Vstup celého radu ══════════════════════════ */

export interface KpiRowInput {
  /** Okno prepínača kariet a tabuľky (D155). */
  readonly windowDays: SoldWindow;
  /**
   * Katalóg a vlastné zľavy z jednej odpovede. `undefined` = nežiadali sme
   * (rad sa práve ťahá), `null` = odpoveď sa nedala prečítať. Zliať sa nesmú:
   * prvé je tvrdenie o načítaní, druhé o appke, a len druhé sa priznáva.
   */
  readonly catalog?: OwnDiscountShareView | null;
  /** Pomer za vybrané okno. Tie isté tri stavy `undefined`/`null`/hodnota. */
  readonly soldPerStock?: SoldPerStockView | null;
  /** To isté za PREDCHÁDZAJÚCE okno — jediný zdroj „oproti čomu". */
  readonly soldPerStockBefore?: SoldPerStockView | null;
}

/* ════════════════════════════ 3. Slová a čísla ════════════════════════════ */

/** Zabehnuté formulácie priznaní. Jedna veta, jedno miesto (bod 6). */
const NO_DAY_AT_ALL = 'ani jeden deň okna zatiaľ nemáme';
const LOWER_BOUND_WORD = 'aspoň toľko, časť dní nemáme celú';
const OWN_WRITES_WORD = 'podľa vlastných zápisov';
const AGAINST_PREVIOUS = 'oproti minulému oknu';
const CATALOG_UNREADABLE = 'rozdelenie katalógu sa nepodarilo prečítať';
const RATIO_UNREADABLE = 'pomer sa nepodarilo prečítať';

/**
 * Pomer → text karty: `1.5×`.
 *
 * TVAR JE PREBRATÝ, NIE VYMYSLENÝ. Tá istá jedna desatinná pozícia a ten istý
 * znak `×` píše stĺpec „predané/sklad" v tabuľkách produktov
 * (`soldPerStockCell()` v `lib/ui/product-columns.ts`) — a tabuľka pod grafom
 * je ROZPIS tejto karty (D155), takže karta a jej rozpis musia to isté číslo
 * napísať rovnako. Kópia tela je tu vedomá: `product-columns.ts` formátovač
 * neexportuje a je mimo oblasti tohto kroku. Aby sa dve kópie nerozišli ticho,
 * je hodnota pribitá na vlastnú tabuľku očakávaní v teste — nie porovnaná
 * klon s klonom (to je poučenie V6b z troch kópií pravidla osi).
 *
 * Pozor na desatinnú BODKU: je to jediné číslo v appke, ktoré ju má, pretože
 * ju má aj stĺpec tabuľky. Zmena patrí na OBE miesta naraz, nie sem.
 */
export function formatSoldPerStock(ratio: number): string {
  return `${ratio.toFixed(1)}×`;
}

/**
 * Pomer → jeden z troch stavov jednej hodnoty.
 *
 * Znak `≥` je ten istý, aký píše `statValue()`, a rovnako ako tam sa `≥ 0`
 * NEVYKRESLÍ nikdy: „predalo sa aspoň nič zo skladu" je prázdna veta.
 */
export function ratioValue(ratio: number | null, lowerBound: boolean): StatValueView {
  if (ratio === null || !Number.isFinite(ratio)) return unknownValue();
  if (lowerBound && ratio === 0) return unknownValue();
  const body = formatSoldPerStock(ratio);
  return {
    text: lowerBound ? `${KPI_LOWER_BOUND} ${body}` : body,
    unknown: false,
    lowerBound,
  };
}

/**
 * Podiel 0–1 → percento slovensky: `1,5 %`, `12 %`.
 *
 * Desatinná ČIARKA a jedno desatinné miesto — to isté pravidlo, aké má veta
 * o pokrytí obohatenia (`enrich-view.ts`). `null` znamená „podiel neexistuje"
 * (nulový celok) a nikdy sa nedopočítava na nulu.
 *
 * Podiel, ktorý po zaokrúhlení vyjde nula, ale nulový NIE JE, sa napíše ako
 * „menej než 0,1 %": „0 % zliav" pri dvoch bežiacich zľavách je nepravda, aj
 * keď je to správne zaokrúhlenie.
 */
export function formatSharePercentSk(share: number | null): string | null {
  if (share === null || !Number.isFinite(share)) return null;
  const percent = share * 100;
  const rounded = Math.round(percent * 10) / 10;
  if (rounded === 0 && percent > 0) return 'menej než 0,1 %';
  const body = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(1).replace('.', ',');
  return `${body} %`;
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
 * Naväzujú okná na seba kalendárne? Podmienka 2 z bodu 4 hlavičky.
 *
 * Kotva sa počíta na klientovi, takže medzi 23:00 a polnocou sa „dnešok"
 * prehliadača a „dnešok" servera môžu rozísť o deň — a dve okná, ktoré sa
 * prekrývajú, by dali percento, ktoré nemeria nič.
 */
export function windowsAdjoin(
  before: { readonly to: string },
  current: { readonly from: string },
): boolean {
  return before.to === dayBefore(current.from);
}

/**
 * Priznanie dolnej hranice s ČÍSLOM, keď ho appka má.
 *
 * Tri stavy, nie dva: číslo je zmeraná medzera, `null` znamená, že odpoveď
 * zoznam chýbajúcich dní vôbec nenesie. Mlčanie pri `null` by sa prečítalo
 * ako „okno je celé", a to je práve to, čo dolná hranica popiera.
 */
export function missingDaysPhrase(unknownDays: number | null): string {
  if (unknownDays === null) return 'aspoň toľko, koľko dní okna chýba, nevieme';
  if (unknownDays <= 0) return LOWER_BOUND_WORD;
  return `aspoň toľko, ${dayCount(unknownDays)} okna nemáme`;
}

/* ══════════════════ 4. Karta: produktov v katalógu ════════════════════════ */

/**
 * Koľko riadkov má miestna kópia katalógu.
 *
 * Detail hovorí „v zrkadle", nie „v eshope", a je to invariant, nie štýl:
 * appka pozná len to, čo stiahla, a shop medzitým pridáva aj maže. Číslo
 * z tejto karty preto nikdy nesmie zaznieť ako počet produktov v eshope.
 */
export function catalogCard(input: KpiRowInput): KpiCard {
  const label = 'Produktov v katalógu';
  const base = 'riadkov v zrkadle katalógu, nie v eshope';
  const { catalog } = input;

  if (catalog === undefined) {
    return card('katalog', label, unknownValue(), base, null, 'none');
  }
  if (catalog === null) {
    return card('katalog', label, unknownValue(), CATALOG_UNREADABLE, null, 'none');
  }
  return card('katalog', label, statValue(catalog.catalogRows), base, null, 'none');
}

/* ═══════════════════════ 5. Karta: v zľave ════════════════════════════════ */

/**
 * Produkty, ktoré sú DNES v okne zľavy podľa VLASTNÝCH zápisov (I11, D156).
 *
 * Podiel sa napíše len vtedy, keď ho odpoveď naozaj má a keď jej diely dávajú
 * celok (`sumMatchesTotal`). Inak by percento vyšlo z iného menovateľa, než
 * aký je v odpovedi — a karta radšej povie, že podiel nemá, než aby napísala
 * číslo, ktoré nesedí so svojím celkom.
 */
export function discountedCard(input: KpiRowInput): KpiCard {
  const label = 'V zľave';
  const { catalog } = input;

  if (catalog === undefined) {
    return card('zlacnene', label, unknownValue(), OWN_WRITES_WORD, null, 'none');
  }
  if (catalog === null) {
    return card('zlacnene', label, unknownValue(), CATALOG_UNREADABLE, null, 'none');
  }

  const parts: string[] = [];
  if (catalog.catalogRows === null) {
    parts.push('z koľkých v katalógu, appka nevie');
  } else {
    parts.push(`z ${formatCountSk(catalog.catalogRows)} v zrkadle katalógu`);
  }

  const share = catalog.sumMatchesTotal ? formatSharePercentSk(catalog.share) : null;
  if (share !== null) parts.push(share);
  else if (!catalog.sumMatchesTotal) parts.push('podiel appka nevyjadrí — diely nedávajú celok');

  parts.push(OWN_WRITES_WORD);
  return card(
    'zlacnene',
    label,
    statValue(catalog.discountedNow),
    parts.join(' · '),
    null,
    'none',
  );
}

/* ════════════════════ 6. Karta: predané na sklad ══════════════════════════ */

/** Veta pod kurzorom pilulky, keď porovnanie EXISTUJE. */
function previousWindowTitle(windowDays: number): string {
  return `Oproti predchádzajúcim ${dayCount(windowDays)} rovnakej dĺžky.`;
}

/**
 * Zmena pomeru medzi oknami. `null` vždy, keď čo i len jedna podmienka z bodu 4
 * hlavičky nedrží — a `null` je „zmenu nevieme", nie nula.
 */
export function ratioChangePercent(
  before: SoldPerStockView | null | undefined,
  current: SoldPerStockView | null | undefined,
): number | null {
  if (before === null || before === undefined) return null;
  if (current === null || current === undefined) return null;
  if (before.ratioState !== 'measured' || current.ratioState !== 'measured') return null;
  if (before.ratio === null || current.ratio === null) return null;
  if (!windowsAdjoin(before, current)) return null;
  return trendPercent(before.ratio, current.ratio);
}

/**
 * Ako rýchlo sa tovar hýbe: predané za okno ÷ dnešný sklad, `N×` (D148).
 *
 * Detail povie, z koľkých produktov je pomer počítaný. Bez toho čísla je pomer
 * pravdivý, ale nemerateľný: sklad má appka len z obohatených riadkov, takže
 * človek by nevedel, či hovorí o katalógu, alebo o jeho stotine.
 */
export function soldPerStockCard(input: KpiRowInput): KpiCard {
  const label = 'Predané na sklad';
  const { soldPerStock, windowDays } = input;
  const raw: KpiDelta = {
    value: ratioChangePercent(input.soldPerStockBefore, soldPerStock),
    suffix: '%',
    digits: 0,
    sense: 'rise-good',
    title: null,
  };
  const delta: KpiDelta =
    raw.value === null ? raw : { ...raw, title: previousWindowTitle(windowDays) };
  const base = `za ${dayCount(windowDays)}`;

  if (soldPerStock === undefined) {
    /* Nežiadali sme — medzeru v dátach NEPRIZNÁVAME, to by bolo tvrdenie
       o eshope namiesto tvrdenia o načítaní. */
    return card('predane-na-sklad', label, unknownValue(), base, delta, 'gold');
  }
  if (soldPerStock === null) {
    return card(
      'predane-na-sklad',
      label,
      unknownValue(),
      `${base} · ${RATIO_UNREADABLE}`,
      delta,
      'gold',
    );
  }

  const lowerBound = soldPerStock.ratioState === 'lower_bound';
  const value = ratioValue(soldPerStock.ratio, lowerBound);
  const parts = [base];
  if (soldPerStock.ratioState === 'unknown') parts.push(NO_DAY_AT_ALL);
  else if (lowerBound) parts.push(missingDaysPhrase(soldPerStock.unknownDays));
  parts.push(coveragePhrase(soldPerStock.productsWithStock));
  if (!value.unknown) parts.push(AGAINST_PREVIOUS);
  return card('predane-na-sklad', label, value, parts.join(' · '), delta, 'gold');
}

/**
 * Z koľkých produktov je pomer počítaný.
 *
 * `null` sa NEZAMLČÍ a nedoplní nulou: „počítané z 0 produktov" by tvrdilo,
 * že sklad nemá ani jeden riadok, kým v skutočnosti appka nevie, koľkých sa
 * to týka.
 */
export function coveragePhrase(productsWithStock: number | null): string {
  if (productsWithStock === null) return 'z koľkých produktov, appka nevie';
  const word = pluralSk(productsWithStock, 'produktu', 'produktov', 'produktov');
  return `zo skladu ${formatCountSk(productsWithStock)} ${word}`;
}

/* ═══════════════════════════ 7. Celý rad ══════════════════════════════════ */

/**
 * Tri karty v záväznom poradí `KPI_CARD_IDS`.
 *
 * ZLATÚ má PRESNE JEDNA (`predane-na-sklad`) — bod 5 hlavičky.
 */
export function kpiCards(input: KpiRowInput): readonly KpiCard[] {
  return [catalogCard(input), discountedCard(input), soldPerStockCard(input)];
}

/* ══════════════════════════ 8. Drobné pomôcky ═════════════════════════════ */

/** Pomlčka „nevieme" — ten istý znak, aký appka píše v tabuľkách a v grafoch. */
function unknownValue(): StatValueView {
  return { text: KPI_UNKNOWN, unknown: true, lowerBound: false };
}

function card(
  id: KpiCardId,
  label: string,
  value: StatValueView,
  detail: string,
  delta: KpiDelta | null,
  accent: StatAccent,
): KpiCard {
  return { id, label, value, detail, delta, accent };
}
