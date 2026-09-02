/**
 * Aura Zľavy — OKNÁ ZLIAV V ČASE, model pásov (graf G1; `/api/insights/timeline`).
 *
 * Endpoint existoval od šprintu B2 a nečítala ho žiadna obrazovka. Tento modul
 * je jeho čítacia strana: odpoveď servera → pásy na osi, v čistých funkciách,
 * ktoré sa dajú overiť bez prehliadača.
 *
 * ČO PÁS TVRDÍ A ČO NIE
 * ---------------------
 *  1. **Kampaň, ktorá do okna len ZASAHUJE, na osi JE** — route ju vracia
 *     zámerne (`date_from <= to AND date_to >= from`) a orezanie na hranu je
 *     práca grafu. Orezaná hrana sa preto PRIZNÁVA (`clippedStart`/
 *     `clippedEnd`); bez toho by zľava bežiaca od minulého mesiaca vyzerala,
 *     že začala na kraji osi.
 *  2. **Prekryv v čase nie je prekryv na produkte.** Blokujúci je len druhý
 *     (D28) a odlíšiť sa dá jedine cez `productIds`, ktoré route posiela práve
 *     na toto. Dva pásy nad sebou samy o sebe nehlásia nič.
 *  3. **Nedopočítava sa.** Pás bez čitateľných dátumov sa zahodí; prázdna os
 *     je „za toto obdobie appka nemá ani jednu zľavu" (meraný fakt), zatiaľ čo
 *     neúspešné čítanie je veta o čítaní, nie prázdna os (I11).
 *
 * Vlastník: V4 (obrazovka Zľavy).
 */
import { asRecord, readCount, readText } from '@/components/dashboard/json';
import { diffDays } from '@/lib/domain/dates';

/* ═══════════════════════════ 1. Tvar odpovede ═════════════════════════════ */

/** Jedno okno kampane na osi. */
export interface TimelineCampaign {
  readonly id: number;
  readonly name: string;
  readonly status: string;
  readonly percent: number;
  readonly dateFrom: string;
  readonly dateTo: string;
  /** ID produktov kampane — bez nich sa prekryv na produkte nedá tvrdiť. */
  readonly productIds: readonly number[];
}

export interface TimelineView {
  readonly today: string;
  readonly from: string;
  readonly to: string;
  /** `null` = pôvodná trojmesačná os stránky Zľavy, nie okno prepínača. */
  readonly windowDays: number | null;
  readonly campaigns: readonly TimelineCampaign[];
}

const DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

const isDay = (value: string | null): value is string => value !== null && DAY_SHAPE.test(value);

/** Jedno okno, alebo `null` keď sa nedá ani nakresliť (chýba deň alebo id). */
export function parseTimelineCampaign(raw: unknown): TimelineCampaign | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const id = readCount(record, 'id');
  const dateFrom = readText(record, 'dateFrom');
  const dateTo = readText(record, 'dateTo');
  if (id === null || !isDay(dateFrom) || !isDay(dateTo)) return null;
  if (dateTo < dateFrom) return null;
  const ids = record['productIds'];
  return {
    id,
    name: readText(record, 'name') ?? '',
    status: readText(record, 'status') ?? '',
    percent: readCount(record, 'percent') ?? 0,
    dateFrom,
    dateTo,
    productIds: Array.isArray(ids)
      ? ids.filter((value): value is number => typeof value === 'number' && Number.isInteger(value))
      : [],
  };
}

/**
 * Celá odpoveď, alebo `null`.
 *
 * Bez `from`/`to` os neexistuje — nedopočítava sa z kampaní, ktoré prišli
 * (rozsah osi hovorí server a graf ho nesmie prepísať tým, čo v ňom leží).
 */
export function parseTimeline(raw: unknown): TimelineView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const from = readText(record, 'from');
  const to = readText(record, 'to');
  const today = readText(record, 'today');
  if (!isDay(from) || !isDay(to) || from > to) return null;
  const rows = record['campaigns'];
  return {
    from,
    to,
    today: isDay(today) ? today : from,
    windowDays: readCount(record, 'windowDays'),
    campaigns: Array.isArray(rows)
      ? rows
          .map(parseTimelineCampaign)
          .filter((row): row is TimelineCampaign => row !== null)
      : [],
  };
}

/* ═══════════════════════════ 2. Pás na osi ════════════════════════════════ */

export interface TimelineBand {
  /** Odsadenie zľava v percentách šírky osi. */
  readonly leftPct: number;
  /** Šírka pásu v percentách; nikdy 0 — jednodňová zľava musí byť vidieť. */
  readonly widthPct: number;
  /** `true` = zľava začala PRED osou a pás je orezaný. */
  readonly clippedStart: boolean;
  /** `true` = zľava končí PO osi. */
  readonly clippedEnd: boolean;
}

/** Koľko dní má os (inkluzívne). Vždy aspoň 1. */
export function axisDays(range: { readonly from: string; readonly to: string }): number {
  const days = diffDays(range.from, range.to) + 1;
  return days > 0 ? days : 1;
}

/**
 * Pás jednej kampane na osi.
 *
 * Percentá sa počítajú z INKLUZÍVNEHO počtu dní: zľava od 1. do 1. je jeden
 * deň, nie nula. Zaokrúhľuje sa až na dve desatiny — pás sa kreslí v CSS
 * a celé čísla by pri trojmesačnej osi posunuli hranu o skoro celý deň.
 */
export function bandOf(
  campaign: { readonly dateFrom: string; readonly dateTo: string },
  range: { readonly from: string; readonly to: string },
): TimelineBand | null {
  if (campaign.dateTo < range.from || campaign.dateFrom > range.to) return null;
  const total = axisDays(range);
  const start = campaign.dateFrom < range.from ? range.from : campaign.dateFrom;
  const end = campaign.dateTo > range.to ? range.to : campaign.dateTo;
  const offset = diffDays(range.from, start);
  const length = diffDays(start, end) + 1;
  const round = (value: number): number => Math.round(value * 100) / 100;
  return {
    leftPct: round((offset / total) * 100),
    widthPct: round((Math.max(1, length) / total) * 100),
    clippedStart: campaign.dateFrom < range.from,
    clippedEnd: campaign.dateTo > range.to,
  };
}

/** Kde na osi stojí dnešok, alebo `null` keď dnešok do osi nepatrí. */
export function todayPct(range: {
  readonly from: string;
  readonly to: string;
  readonly today: string;
}): number | null {
  if (!DAY_SHAPE.test(range.today)) return null;
  if (range.today < range.from || range.today > range.to) return null;
  const total = axisDays(range);
  return Math.round((diffDays(range.from, range.today) / total) * 10000) / 100;
}

/* ═══════════════════ 3. Prekryv na tom istom produkte (D28) ═══════════════ */

/** Prekrývajú sa okná dvoch kampaní v čase? Hranica je inkluzívna. */
export function windowsOverlap(
  a: { readonly dateFrom: string; readonly dateTo: string },
  b: { readonly dateFrom: string; readonly dateTo: string },
): boolean {
  return a.dateFrom <= b.dateTo && b.dateFrom <= a.dateTo;
}

/**
 * ID kampaní, ktoré sa s inou kampaňou prekrývajú V ČASE **a zároveň NA TOM
 * ISTOM PRODUKTE**. Len to je blokujúci prekryv (D28).
 *
 * Kampaň bez známych produktov sa do výsledku nedostane: „nevieme, ktoré
 * produkty" nie je „prekrýva sa" (I11). Príznak preto hovorí menej, než by
 * mohol — a to je správna strana omylu, keď z neho appka kreslí poplach.
 */
export function overlappingCampaignIds(
  campaigns: readonly TimelineCampaign[],
): ReadonlySet<number> {
  const hit = new Set<number>();
  for (let i = 0; i < campaigns.length; i += 1) {
    for (let j = i + 1; j < campaigns.length; j += 1) {
      const a = campaigns[i]!;
      const b = campaigns[j]!;
      if (!windowsOverlap(a, b)) continue;
      if (a.productIds.length === 0 || b.productIds.length === 0) continue;
      const set = new Set(a.productIds);
      if (!b.productIds.some((id) => set.has(id))) continue;
      hit.add(a.id);
      hit.add(b.id);
    }
  }
  return hit;
}

/**
 * Poradie pásov: podľa začiatku, potom podľa konca, potom podľa `id`.
 *
 * Stabilné zámerne — os, ktorá po obnovení prehodí riadky, sa nedá čítať ako
 * to isté, čo človek videl pred sekundou.
 */
export function orderTimeline(
  campaigns: readonly TimelineCampaign[],
): readonly TimelineCampaign[] {
  return [...campaigns].sort((a, b) => {
    if (a.dateFrom !== b.dateFrom) return a.dateFrom < b.dateFrom ? -1 : 1;
    if (a.dateTo !== b.dateTo) return a.dateTo < b.dateTo ? -1 : 1;
    return a.id - b.id;
  });
}

/**
 * ID kampaní, o ktorých sa „neprekrýva sa" DOKÁZAŤ NEDÁ.
 *
 * `overlappingCampaignIds()` je zámerne opatrné: kampaň bez známych produktov
 * do poplachu nezaradí. Kým bola os pásmi, tá opatrnosť znamenala TICHO — pás
 * bez príznaku vyzeral rovnako ako pás, o ktorom appka vie, že je čistý.
 * V tabuľke má každá zľava na prekryv vlastnú bunku, a bunka musí povedať,
 * ktorý z TROCH stavov to je (I11):
 *
 *   · `overlappingCampaignIds()` → prekrýva sa na tom istom produkte (fakt),
 *   · TENTO zoznam                → nevieme (pomlčka),
 *   · ani jeden                    → neprekrýva sa (fakt).
 *
 * Nedokázateľné je to vtedy, keď zľava má v ČASE súseda, ktorého produkty
 * appka nepozná — vlastné alebo susedove. Vtedy sa o tie isté kusy ísť môže
 * a nemusí; „neprekrýva sa" by bolo tvrdenie z neznalosti.
 *
 * Kampaň, ktorá v čase nemá ani jedného suseda, tu NIE JE, aj keď o svojich
 * produktoch nevie nič: bez prekryvu v čase sa na tom istom kuse zraziť nedá,
 * takže „neprekrýva sa" je pri nej meraný fakt.
 */
export function unprovableOverlapIds(
  campaigns: readonly TimelineCampaign[],
): ReadonlySet<number> {
  const hit = new Set<number>();
  for (let i = 0; i < campaigns.length; i += 1) {
    for (let j = i + 1; j < campaigns.length; j += 1) {
      const a = campaigns[i]!;
      const b = campaigns[j]!;
      if (!windowsOverlap(a, b)) continue;
      /* Porovnáva sa výslovne — obe strany musia byť ZNÁME, inak je dvojica
         nerozhodnutá a nesie ju obom. */
      if (a.productIds.length !== 0 && b.productIds.length !== 0) continue;
      hit.add(a.id);
      hit.add(b.id);
    }
  }
  return hit;
}
