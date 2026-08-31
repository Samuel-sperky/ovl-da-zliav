/**
 * Aura Zľavy — čisté rozhodovanie Prehľadu (V9).
 *
 * Obrazovka sa nesmie rozhodovať sama a už vôbec nie priamo v JSX: „ukáž
 * pokojný stav" alebo „fronta stojí" sú tvrdenia o produkčnom eshope a musia sa
 * dať otestovať bez prehliadača. Tento modul preto berie surové snímky z API
 * a vracia hotové rozhodnutie; komponenty ho už len kreslia.
 *
 * Slovo o stave si tu nikto nevymýšľa — každé ide cez `campaignSentence()`
 * zo slovníka, ktorý pozná presne štyri stavy a zvyšok pripája ako príznak.
 *
 * Vlastník: V9.
 */
import type { CampaignRow, QueueSnapshot } from '@/components/dashboard/api';
import type { CampaignSentence, CampaignStatusCode } from '@/lib/ui/vocabulary';
import { campaignSentence, toStatusCode, todayHere } from '@/lib/ui/vocabulary';

/* ═════════════════════════ 0. Kód stavu zo servera ════════════════════════ */

/**
 * Kód stavu z API → kód, ktorý slovník pozná.
 *
 * TENTO MODUL UŽ PREVOD NEROBÍ, LEN HO PODÁVA ĎALEJ. Funkcia sa presťahovala do
 * `lib/ui/vocabulary.ts`, vedľa zoznamu `CAMPAIGN_STATUS_CODES`, podľa ktorého
 * sa rozhoduje: prevod patrí k slovníku, nie k jednej obrazovke. Dovtedy si ju
 * zoznam zliav (`campaigns/discounts-model.ts`) importoval odtiaľto — krížny
 * import medzi dvomi obrazovkami len preto, aby nevznikla druhá kópia.
 *
 * Re-export je DOČASNÝ most pre miesta, ktoré ešte ukazujú sem. Nové miesta
 * majú siahať rovno po `@/lib/ui/vocabulary` a k volaniu prevodu už nemajú dôvod
 * vôbec: `campaignSentence()` si neznámy kód ošetrí sám a navyše ho PRIZNÁ.
 */
export { toStatusCode };

/* ═══════════════════════ 1. Stav dominantnej sekcie ═══════════════════════ */

/**
 * Päť stavov dominanty, presne podľa predlôh:
 *
 *  - `unknown`  — appka neodpovedala; nič sa netvrdí (`prazdne-stavy.html`),
 *  - `empty`    — ešte nie je žiadna zľava (`prazdne-stavy.html`),
 *  - `calm`     — nič sa práve nezapisuje (`prehlad-pokoj.html`),
 *  - `paused`   — fronta stojí po odstávke počítača (`prehlad-pozastavene.html`),
 *  - `running`  — fronta zapisuje, číslo v 64 px (`prehlad.html`).
 *
 * `calm` NIE JE „všetko je v poriadku". Znamená len, že sa v tejto chvíli
 * nezapisuje, a to má dva dôvody: fronta nemá čo zapisovať, alebo má a nikto to
 * nezapisuje. Ten druhý je STOJACA fronta a hovorí o ňom `stalled`; verdikt
 * (`overview-verdict.ts`) sa ho pýta skôr, než vysloví „Všetko v poriadku".
 */
export type QueueMode = 'unknown' | 'empty' | 'calm' | 'paused' | 'running';

export interface QueueProgress {
  mode: QueueMode;
  done: number;
  total: number;
  /** Podiel spracovaných položiek v percentách, orezaný na 0–100. */
  percent: number;
  /** Zostáva zapísať. */
  pending: number;
  campaignId: number | null;
  campaignName: string | null;
  sentence: CampaignSentence | null;
  /** `3 pásma · 30 / 20 / 15 %` alebo `30 %`; `null`, keď pásma nepoznáme. */
  tiersLabel: string | null;
  /** Odhad dobehnutia — na povrchu VŽDY so `≈`. */
  finishDay: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  failed: number;
  /** Kedy fronta prestala zapisovať; `null`, keď to appka nevie. */
  pausedSince: string | null;
  /**
   * Stojí fronta na človeku? `null` je „nevieme" a je prísnejšie než `false`.
   *
   * Otázka má zmysel len pri `mode: 'calm'` — inak je odpoveď v samom stave
   * (`running` zapisuje, `paused` stojí, `empty` nemá čo zapisovať). Rozhoduje
   * o nej `queueStalled()`.
   */
  stalled: boolean | null;
}

/**
 * Pásma zľavy jedným riadkom: `3 pásma · 30 / 20 / 15 %`.
 *
 * Zoradené zostupne podľa percenta, nie podľa poradia pásma — používateľ číta
 * najprv najväčšiu zľavu, a hlavička zľavy hovorí práve najvyššie percento.
 */
export function tiersLabel(row: CampaignRow): string {
  if (row.tiers.length <= 1) return `${row.percent} %`;
  const percents = [...row.tiers]
    .map((tier) => tier.percent)
    .sort((a, b) => b - a)
    .join(' / ');
  return `${row.tiers.length} pásma · ${percents} %`;
}

/** Podiel v percentách, nikdy mimo 0–100 a nikdy `NaN`. */
export function progressPercent(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, (done / total) * 100));
}

/**
 * Stavy zľavy, ktorých položky sa počítajú do fronty.
 *
 * Musí to byť TEN ISTÝ zoznam ako v `SQL_QUEUE_TOTALS`
 * (`lib/repo/campaign-items.repo.ts`) — inak by obrazovka vysvetľovala inú
 * frontu, než akú server spočítal.
 */
const QUEUE_STATUSES: readonly CampaignStatusCode[] = [
  'scheduled',
  'needs_key',
  'running',
  'missed',
  'queued',
];

/**
 * Zľavy, ktoré sa samy nerozhýbu — čakajú na ČLOVEKA, nie na krok fronty.
 * `needs_key` a `missed` majú rovnakú váhu (D8/D33b) a rovnako ich už triedi
 * `findNeedsIntervention()` v `lib/ai/rules.ts`.
 */
const NEEDS_HUMAN: readonly CampaignStatusCode[] = ['needs_key', 'missed'];

/**
 * Stojí fronta na človeku? Odpoveď má tri hodnoty a `null` znamená „nevieme".
 *
 * Otázka sa kladie LEN vtedy, keď fronta má čo zapisovať (`queue.pending > 0`)
 * a server pritom nevrátil žiadnu kampaň v behu. `current` hľadá server priamo
 * medzi `running` a `queued` (`app/api/queue/route.ts`), takže čakajúce položky
 * v tej chvíli patria zľavám v stave `scheduled`, `needs_key` alebo `missed` —
 * a celý rozdiel je v tom, na čo čakajú:
 *
 *  - `needs_key` a `missed` čakajú na ČLOVEKA (D8/D33b) → fronta stojí,
 *  - `late` znamená, že okno už beží a položky sú stále nezapísané → stojí,
 *  - `scheduled` s oknom v budúcnosti čaká na svoj deň → nestojí.
 *
 * Keď v zozname nie je ani jedna zľava, ktorá by čakajúce položky mohla
 * vysvetliť (nečitateľný zoznam, alebo prvá strana 50 zliav, na ktorú sa
 * nezmestila), je odpoveď `null`. „Nevieme" je prísnejšie než „v poriadku" (P7)
 * a appka nesmie z chýbajúceho riadku vyrobiť dobrú správu.
 */
export function queueStalled(campaigns: readonly CampaignRow[] | null): boolean | null {
  if (campaigns === null) return null;
  const inQueue = campaigns.filter((row) => QUEUE_STATUSES.includes(toStatusCode(row.status)));
  if (inQueue.length === 0) return null;
  return inQueue.some((row) => NEEDS_HUMAN.includes(toStatusCode(row.status)) || row.late);
}

export interface QueueProgressInput {
  snapshot: QueueSnapshot | null;
  campaigns: readonly CampaignRow[] | null;
  today?: string;
}

export function queueProgress(input: QueueProgressInput): QueueProgress {
  const today = input.today ?? todayHere();
  const snapshot = input.snapshot;

  const base: QueueProgress = {
    mode: 'unknown',
    done: 0,
    total: 0,
    percent: 0,
    pending: 0,
    campaignId: null,
    campaignName: null,
    sentence: null,
    tiersLabel: null,
    finishDay: null,
    dateFrom: null,
    dateTo: null,
    failed: 0,
    pausedSince: null,
    // Bez odpovede appky sa o stojacej fronte netvrdí nič — ani to, že nestojí.
    stalled: null,
  };

  if (snapshot === null) return base;

  const { queue, current } = snapshot;
  /*
   * `campaigns: null` je „NEVIEME" — zoznam kampaní sa nepodarilo prečítať.
   * `campaigns: []` je „nič tam nie je". Do 24. 8. 2026 z oboch vychádzalo
   * `hasCombination === false`, a s prázdnou frontou teda `mode: 'empty'`:
   * appka na nečitateľnú odpoveď povedala „žiadne zľavy" a používateľ videl
   * pokojnú prázdnu obrazovku namiesto priznania, že nič nevie. To je tá istá
   * rodina chýb, akú Sprint 20 našiel štyrikrát — tvrdiť číslo (alebo tu stav),
   * ktorý appka nezmerala.
   *
   * `mode: 'unknown'` je pritom už hotový a `StatusSection` preň kreslí
   * `UnknownBody`, takže priznanie nič nové nepotrebuje.
   */
  const campaigns = input.campaigns;
  const campaignsKnown = campaigns !== null;
  const hasCampaigns = campaigns !== null && campaigns.length > 0;

  if (queue.total === 0 && !campaignsKnown) return base;
  // Prázdny stav nemá čo zapisovať, takže ani na čom stáť.
  if (queue.total === 0 && !hasCampaigns) return { ...base, mode: 'empty', stalled: false };

  // Fronta nemá čo zapisovať — pokojný stav, nie prázdny.
  if (queue.pending === 0) {
    return { ...base, mode: 'calm', stalled: false, done: queue.done, total: queue.total };
  }

  /*
   * Položky čakajú, ale server nemá čo zapisovať.
   *
   * `current` je LEN `running` alebo `queued` kampaň (`app/api/queue/route.ts`),
   * kým `queue.pending` počíta aj `scheduled`, `needs_key` a `missed`
   * (`lib/repo/campaign-items.repo.ts`). Do 26. 8. 2026 sa z tejto dvojice
   * vracal pokojný stav s `pending: 0` — appka teda zahodila jediné číslo,
   * ktorým sa stojaca fronta dá dokázať, a verdikt potom povedal „Všetko
   * v poriadku", kým tisíce položiek stáli (a zľava v `needs_key` je pritom
   * očakávaný stav). Číslo tu preto zostáva a otázku „stojí to na človeku?"
   * dostane verdikt zodpovedanú.
   */
  if (current === null) {
    return {
      ...base,
      mode: 'calm',
      stalled: queueStalled(campaigns),
      done: queue.done,
      total: queue.total,
      pending: queue.pending,
    };
  }

  // Brána je orientačná, heartbeat je fakt z databázy. Stačí jedno z dvoch:
  // keď scheduler nedáva o sebe vedieť, fronta nezapisuje, nech si brána
  // v tomto module grafe myslí čokoľvek.
  const stopped = snapshot.gate.paused || snapshot.heartbeat.stale;

  const sentence = campaignSentence({
    status: toStatusCode(current.status),
    dateFrom: current.dateFrom === '' ? null : current.dateFrom,
    dateTo: current.dateTo === '' ? null : current.dateTo,
    today,
    itemsWritten: current.itemsOk,
    failedCount: current.itemsFailed,
    paused: stopped,
    budgetExhausted: snapshot.budget !== null && snapshot.budget.exhausted,
    lateCount: current.late ? current.itemsPending : 0,
  });

  const known = (input.campaigns ?? []).find((row) => row.id === current.campaignId) ?? null;

  return {
    mode: stopped ? 'paused' : 'running',
    done: queue.done,
    total: queue.total,
    percent: progressPercent(queue.done, queue.total),
    pending: queue.pending,
    campaignId: current.campaignId,
    campaignName: current.name,
    sentence,
    tiersLabel: known === null ? null : tiersLabel(known),
    finishDay: snapshot.estimate === null ? null : snapshot.estimate.date,
    dateFrom: current.dateFrom === '' ? null : current.dateFrom,
    dateTo: current.dateTo === '' ? null : current.dateTo,
    failed: current.itemsFailed,
    pausedSince: snapshot.gate.since ?? snapshot.heartbeat.lastTickAt,
    // Kampaň v behu je: o stojacej fronte tu rozhoduje `mode`, nie `stalled`.
    stalled: false,
  };
}

/* ══════════════════════════ 2. Zľavy naživo ═══════════════════════════════ */

/** Poradie stavov v zoznamoch: zapisuje sa → beží → pripravená → skončila. */
const STATE_ORDER: Readonly<Record<string, number>> = {
  'zapisuje sa': 0,
  'beží': 1,
  'pripravená': 2,
  'skončila': 3,
};

export interface LiveCampaign {
  row: CampaignRow;
  sentence: CampaignSentence;
  /** `35 %` alebo `3 pásma` — hlavička hovorí najvyššie percento. */
  percentLabel: string;
  /** Zľava sa práve zapisuje, takže riadok nesie pruh priebehu. */
  writing: boolean;
  percent: number;
}

export function describeCampaign(row: CampaignRow, today: string): LiveCampaign {
  const sentence = campaignSentence({
    status: toStatusCode(row.status),
    dateFrom: row.dateFrom === '' ? null : row.dateFrom,
    dateTo: row.dateTo === '' ? null : row.dateTo,
    today,
    itemsWritten: row.itemsOk,
    failedCount: row.itemsFailed,
    lateCount: row.late ? row.itemsPending : 0,
  });
  const tierCount = row.tiers.length;
  return {
    row,
    sentence,
    percentLabel: tierCount > 1 ? `${tierCount} pásma` : `${row.percent} %`,
    writing: sentence.state === 'zapisuje sa',
    percent: progressPercent(row.itemsTotal - row.itemsPending, row.itemsTotal),
  };
}

/**
 * Zoznam „Zľavy naživo" — tri riadky, hore to, čo sa hýbe. Pri rovnakom stave
 * rozhoduje skorší začiatok okna, takže poradie sa medzi načítaniami nemení.
 */
export function liveCampaigns(
  rows: readonly CampaignRow[],
  today: string,
  limit = 3,
): LiveCampaign[] {
  return rows
    .map((row) => describeCampaign(row, today))
    .sort((a, b) => {
      const byState =
        (STATE_ORDER[a.sentence.state] ?? 9) - (STATE_ORDER[b.sentence.state] ?? 9);
      if (byState !== 0) return byState;
      if (a.row.dateFrom !== b.row.dateFrom) return a.row.dateFrom < b.row.dateFrom ? -1 : 1;
      return a.row.id - b.row.id;
    })
    .slice(0, limit);
}

/* ═════════════════════════ 3. Čísla pokojného stavu ═══════════════════════ */

export interface CalmNumbers {
  /** Zliav s otvoreným oknom — zákazníci ich práve vidia. */
  live: number;
  /** Zostavených, do fronty ešte nešli. */
  ready: number;
  /** Zlacnených produktov podľa VLASTNÝCH zápisov, nie podľa stavu eshopu. */
  discounted: number;
}

export function calmNumbers(rows: readonly CampaignRow[], today: string): CalmNumbers {
  let live = 0;
  let ready = 0;
  let discounted = 0;
  for (const row of rows) {
    const state = describeCampaign(row, today).sentence.state;
    if (state === 'beží') {
      live += 1;
      discounted += row.itemsOk;
    } else if (state === 'pripravená') {
      ready += 1;
    }
  }
  return { live, ready, discounted };
}

/* ══════════════ 4. Okno prepínača Prehľadu (V4, kontrakt §2) ══════════════ */

/**
 * Tri okná, nič medzi nimi. Zhodujú sa s `WINDOW_DAYS_ALLOWED` v
 * `src/app/api/insights/_shared.ts` — server iné okno odmietne, takže tu nie je
 * čo „pre istotu" pridávať; hodnota mimo zoznamu by skončila chybou dotazu.
 */
export const OVERVIEW_WINDOWS = [7, 30, 90] as const;

export type OverviewWindow = (typeof OVERVIEW_WINDOWS)[number];

/** Predvolené okno prvej strany (kontrakt V4 §2: 30 dní). */
export const DEFAULT_OVERVIEW_WINDOW: OverviewWindow = 30;

/** Je to okno, ktoré server pozná? Fail-closed: čokoľvek iné je `false`. */
export function isOverviewWindow(value: number): value is OverviewWindow {
  return (OVERVIEW_WINDOWS as readonly number[]).includes(value);
}

/* ═════════════ 5. Top a flop rebríček (V4, D113 + D116 + I11) ═════════════ */

/**
 * Jeden riadok rebríčka po prečítaní odpovede.
 *
 * `units` je zámerne `number` a nie `number | null`: riadok BEZ nameraného
 * predaja do rebríčka nepatrí a `rankRows()` ho zahodí ešte pred vytvorením
 * tohto typu. Kto sem pridá `null`, musí najprv odpovedať na otázku, čo taký
 * riadok v rebríčku predaja robí.
 */
export interface RankRow {
  productId: number;
  /** D116 — kód produktu. `null` = zrkadlo ho nemá (pomlčka + id na povrchu). */
  reference: string | null;
  name: string | null;
  /** Predané kusy za okno. VŽDY ≥ 1. */
  units: number;
  /** Podľa VLASTNÝCH zápisov je produkt dnes v okne zľavy (I11). */
  discountedNow: boolean;
  /** Marža v % z obohatenia. `null` = neobohatené, teda „nevieme" (D118). */
  marginPercent: number | null;
  /** Sklad z obohatenia. `0` je platná nula, `null` je „nevieme". */
  qty: number | null;
  /** `false` = produkt sa nikdy neobohatil, takže marža a sklad sú „nevieme". */
  enriched: boolean;
}

/**
 * Riadky rebríčka z odpovede servera.
 *
 * PREČO SA TU FILTRUJE, KEĎ TO ROBÍ AJ SERVER. Route `top-products` do rebríčka
 * nulu nepustí a hovorí to aj strojovo (`excludes.zeroSales`). Tento filter je
 * druhá brána a nie je zbytočná: obrazovka dostáva JSON, ktorého tvar typ
 * nechráni, a jediné, čo medzi „0 predaných" a „produkt bez dát" rozhoduje na
 * povrchu, je práve tento riadok kódu. Keby sa raz zmenil server, chyba by sa
 * neprejavila výnimkou, ale desiatimi nulami na dne flopu — teda tvrdením, že
 * tie produkty sú najhoršie predávané, hoci o nich appka nevie nič (I11).
 *
 * `units` sa preto musí prečítať ako KONEČNÉ ČÍSLO VÄČŠIE NEŽ NULA. `null`,
 * chýbajúce pole, `NaN` aj `0` vypadnú a je to to isté rozhodnutie: appka
 * o predaji toho produktu nemá meranie, tak ho do poradia nedáva.
 */
export function rankRows(raw: unknown): RankRow[] {
  if (!Array.isArray(raw)) return [];
  const out: RankRow[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const productId = row.productId;
    const units = row.units;
    if (typeof productId !== 'number' || !Number.isFinite(productId)) continue;
    // Nula ani „nevieme" do rebríčka predaja nevstupuje — viď hlavička.
    if (typeof units !== 'number' || !Number.isFinite(units) || units <= 0) continue;
    out.push({
      productId,
      reference: typeof row.reference === 'string' && row.reference.trim() !== '' ? row.reference : null,
      name: typeof row.name === 'string' && row.name.trim() !== '' ? row.name : null,
      units: Math.trunc(units),
      discountedNow: row.discountedNow === true,
      marginPercent:
        typeof row.marginPercent === 'number' && Number.isFinite(row.marginPercent)
          ? row.marginPercent
          : null,
      qty: typeof row.qty === 'number' && Number.isFinite(row.qty) ? Math.trunc(row.qty) : null,
      enriched: row.enriched === true,
    });
  }
  return out;
}

/* ═════════════ 6. Karta bežiacich zliav (V4, kontrakt §2 bod 6) ═══════════ */

/**
 * Najbližší PLÁNOVANÝ zápis. `fireAt` je čas, kedy sa fronta chystá zapisovať —
 * nie začiatok okna zľavy; tie dva sa pri režime „zapisuje sa dopredu" líšia.
 */
export interface NextFire {
  campaignId: number;
  name: string;
  percent: number;
  /** ISO čas zo servera. Formátuje ho povrch, nie tento modul. */
  fireAt: string;
}

/** Okno zľavy s časom zápisu — presne to, čo vracia `/api/insights/timeline`. */
export interface FireWindowInput {
  id: number;
  name: string;
  percent: number;
  fireAt: string | null;
}

/**
 * Najbližší plánovaný zápis z okien na osi.
 *
 * Porovnáva sa ISO reťazcami, nie `Date` — `fireAt` prichádza zo servera v
 * jednom formáte a lexikografické porovnanie ISO časov je to isté ako číselné,
 * bez rizika, že sa niekde stratí zóna. Minulý čas sa preskočí: „najbližší
 * plánovaný" nie je zápis, ktorý sa mal stať včera.
 *
 * `null` znamená „nič naplánované NEVIDÍME" — a povrch to tak musí povedať.
 * Nie je to „nič naplánované nie je": os pokrýva len okno prepínača.
 */
export function nextPlannedFire(
  windows: readonly FireWindowInput[],
  nowIso: string,
): NextFire | null {
  let best: NextFire | null = null;
  for (const window of windows) {
    const fireAt = window.fireAt;
    if (fireAt === null || typeof fireAt !== 'string' || fireAt === '') continue;
    if (fireAt < nowIso) continue;
    if (best === null || fireAt < best.fireAt) {
      best = { campaignId: window.id, name: window.name, percent: window.percent, fireAt };
    }
  }
  return best;
}

/**
 * Posledný deň, v ktorom appka naozaj niečo zapisovala.
 *
 * Počty sú `number | null`, lebo `null` je jediný spôsob, ako povedať „toto
 * pole sme neprečítali". Karta ho MUSÍ uniesť: „0 sa nepodarilo" o produkčnom
 * zápise sa smie napísať len z nuly, ktorá naozaj prišla zo servera (I11).
 */
export interface LastWrite {
  day: string;
  ok: number | null;
  failed: number | null;
  uncertain: number | null;
  skipped: number | null;
}

/** Jeden deň zápisovej aktivity z `/api/insights/activity`. */
export interface WriteActivityDayInput {
  day: string;
  ok: number | null;
  failed: number | null;
  uncertain: number | null;
  skipped: number | null;
}

/**
 * POSLEDNÝ VÝSLEDOK ZÁPISU — najnovší deň, ktorý má aspoň jednu položku.
 *
 * Deň so samými nulami sa preskočí zámerne: `writeActivity` vracia riadok pre
 * každý deň obdobia, takže „posledný deň" je takmer vždy dnešok a jeho nuly by
 * na karte vyzerali ako „naposledy sa nezapísalo nič" — čo je tvrdenie o zápise,
 * hoci je to len tvrdenie o kalendári.
 *
 * `null` = v obdobiach, ktoré appka prečítala, nie ani jeden zápis.
 *
 * PRESKOČIŤ DEŇ SMIE LEN ZMERANÁ NULA (31. 8. 2026). Deň sa vynechá iba vtedy,
 * keď sú všetky štyri počty prečítané a všetky sú nulové. Keď appka jeden
 * z nich nepozná (`null`), nemá z čoho tvrdiť „v tento deň sa nezapisovalo" —
 * deň zostáva kandidátom a medzeru prizná karta. Opačné poradie by nečitateľnú
 * odpoveď premenilo na tichý „nezapisovalo sa nič".
 */
export function lastWriteResult(days: readonly WriteActivityDayInput[]): LastWrite | null {
  let best: LastWrite | null = null;
  for (const row of days) {
    if (typeof row.day !== 'string' || row.day === '') continue;
    let measuredTotal = 0;
    let unknownFields = 0;
    for (const value of [row.ok, row.failed, row.uncertain, row.skipped]) {
      if (value === null || !Number.isFinite(value)) {
        unknownFields += 1;
        continue;
      }
      measuredTotal += value;
    }
    // Všetky štyri zmerané a všetky nulové → v tento deň sa naozaj nezapisovalo.
    if (unknownFields === 0 && measuredTotal <= 0) continue;
    if (best === null || row.day > best.day) {
      best = {
        day: row.day,
        ok: row.ok,
        failed: row.failed,
        uncertain: row.uncertain,
        skipped: row.skipped,
      };
    }
  }
  return best;
}
