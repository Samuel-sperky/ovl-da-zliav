'use client';

/**
 * Aura Zľavy — sekcia „Výkon výberu" v detaile zľavy
 * (architektúra §1 TAB 3 bod 3, odpoveď 86; od 1. 9. 2026 D127 bod 4).
 *
 * Tri uhly vedľa seba, ako žiada návrh. Rozdiel oproti mockupu
 * `design/v3/zlava-detail.html` je vedomý a je to oprava, nie ústupok:
 *
 *   · mockup ukazuje TRŽBY v eurách — appka ich nemá. Zo shopu prichádzajú
 *     iba počty predaných kusov; cenu, za ktorú sa produkt naozaj predal,
 *     nikdy nevidela. Číslo v eurách by sa dalo „dopočítať" ako kusy krát
 *     dnešná cenníková cena, ale to by nebola tržba, len presvedčivo
 *     vyzerajúci výmysel (K8).
 *   · mockup ukazuje porovnanie s vlaňajškom — synchronizácia predajov si
 *     okno dopĺňa postupne a rok dozadu nesiaha.
 *
 * Oba uhly sú preto ZAMKNUTÉ a povedia prečo — rovnako ako zamknuté filtre
 * v Produktoch. Tretí ukazuje to, čo appka naozaj vie: predané kusy.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ODKIAĽ SÚ ČÍSLA A PREČO SA ZDROJ 1. 9. 2026 ZMENIL (D127 bod 4)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ZAPÍSANÁ PASCA, commit `d00e081` (26. 8. 2026): táto sekcia porovnávala DVE
 * OKNÁ, KTORÉ ZĽAVE OBE PREDCHÁDZALI, a nazývala to jej výkonom. Obe končili
 * dneškom a `date_from` zľavy do výpočtu vôbec nevstupoval; kým je zápis
 * fronta, normálny stav zľavy je „zapisuje sa" a jej okno je v BUDÚCNOSTI —
 * graf teda kreslil dva stĺpce pred zľavou a jeden z nich bol „silnejší".
 * Nález U5 (25. 8.) zalepil najhlbšiu dieru tým, že nezačatá zľava čísla
 * nedostane, ale definícia okien zostala tá istá.
 *
 * Sekcia preto odteraz číta `GET /api/insights/campaign/[id]/effectiveness`,
 * kde okná definuje `upliftFor()` v `_shared.ts` — RAZ, testovateľne, bez HTTP:
 *
 *   · okno **PRED ZĽAVOU** končí DEŇ PRED jej začiatkom a je rovnako dlhé,
 *   · okno **POČAS ZĽAVY** beží od jej `date_from` po dnešok (deň, ktorý sa
 *     ešte nestal, sa doň nedostane).
 *
 * A OBE SÚ NA OBRAZOVKE POMENOVANÉ AJ S DÁTUMAMI (`WINDOW_RULE`, popisky
 * riadkov). To je celá oprava: keby stĺpce nemali mená, `d00e081` by sa dal
 * zopakovať bez toho, aby si to niekto všimol — dva stĺpce vyzerajú správne
 * vždy.
 *
 * TRI STAVY, A ANI JEDEN Z NICH NIE JE NULA (I11, K8 kontraktu V5)
 * ───────────────────────────────────────────────────────────────
 *   · **hodnota** (`measured`) — obe okná stoja na dočítaných dňoch,
 *   · **„okno nemá stiahnuté dni"** (`coverage_gap`) — ŽIADNE číslo, ale okná
 *     sa aj tak pomenujú a vypíšu sa dni, ktoré chýbajú,
 *   · **„zľava je príliš mladá"** (`too_young`) — nezačala, alebo beží kratšie
 *     než tri dni. Dva dni proti dvom je šum, nie účinnosť.
 *
 * Objednávky dnes stiahnuté NIE SÚ (`orders_read` je neoverený kľúč, P1
 * kontraktu V5), takže `coverage_gap` je BEŽNÝ priebeh, nie porucha appky —
 * a tak aj vyzerá: tichá veta v tom istom tóne ako ostatné poznámky, žiadny
 * výstražný tón.
 *
 * ČO SA TU NEDOPOČÍTAVA
 * ─────────────────────
 *  1. **Nikdy rozdiel dvoch čísel.** Server posiela aj `deltaPercent`; táto
 *     sekcia ho VEDOME nekreslí. Dve merania vedľa seba sú fakt, jedno
 *     odvodené percento už je záver — a záver o príčine appka urobiť nevie
 *     (P8): sezónu, sklad a ostatné kampane od vplyvu zľavy oddeliť nedokáže.
 *     Pri JEDNOM produkte to rozhodnutie padlo opačne (`UpliftBlock` v paneli
 *     kusu rozdiel ukazuje) — tam je otázka o jednom kuse a číslo je vidno aj
 *     v krivke pod ním. Tu ide o výber desiatok produktov naraz.
 *  2. **Nikdy eurá.** `product_sales_daily` drží VÝHRADNE kusy (D117).
 *  3. **Nikdy „príliš mladá zľava" ako číslo.** Keď sa spočítať nedá, je tam
 *     slovo a dôvod, a ani jeden stĺpec.
 */
import { useEffect, useState } from 'react';

import styles from '@/components/campaigns/zlavy.module.css';
import { asRecord, readCount, readText } from '@/components/dashboard/json';
import { formatCountSk } from '@/lib/ui/vocabulary';
import { formatDateSk } from '@/lib/ui/format';

/* ═══════════════════ 1. Odpoveď servera, prečítaná a overená ══════════════ */

/** Stavy, ktoré vracia `GET …/effectiveness`. Iný reťazec je neprečítateľný. */
export const EFFECTIVENESS_STATES = [
  'measured',
  'coverage_gap',
  'too_young',
  'baseline_overlaps',
  'invalid_window',
  'unknown_campaign',
] as const;

export type EffectivenessStateKind = (typeof EFFECTIVENESS_STATES)[number];

/** Dôvody z `upliftFor()`. Rozlišujú vetu vnútri jedného stavu. */
export const EFFECTIVENESS_REASONS = [
  'no_discount_window',
  'not_started',
  'window_too_short',
  'baseline_overlaps_discount',
  'coverage_gap',
  'unknown_campaign',
] as const;

export type EffectivenessReasonKind = (typeof EFFECTIVENESS_REASONS)[number];

export interface EffectivenessWindow {
  readonly from: string;
  readonly to: string;
  /** Kusy za okno. `null` = okno nie je celé dočítané, teda NEVIEME (I11). */
  readonly units: number | null;
}

export interface EffectivenessView {
  readonly state: EffectivenessStateKind;
  readonly reason: EffectivenessReasonKind | null;
  /** Dĺžka OBOCH okien v dňoch — sú rovnako dlhé zámerne. */
  readonly spanDays: number | null;
  /** Odkedy zľava platí, aby veta povedala KEDY, nie len „ešte nie". */
  readonly startsOn: string | null;
  /** `true` = zľava ešte beží, takže „počas" je len po dnešok. */
  readonly duringTruncated: boolean;
  readonly before: EffectivenessWindow | null;
  readonly during: EffectivenessWindow | null;
  readonly missingBefore: readonly string[];
  readonly missingDuring: readonly string[];
  /** Panel, ktorý appka naplniť NEVIE — zamkne sa, nedopočíta. */
  readonly locked: { readonly revenue: string };
}

function parseWindow(raw: unknown): EffectivenessWindow | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const from = readText(record, 'from');
  const to = readText(record, 'to');
  if (from === null || to === null) return null;
  // `units: null` je PRIZNANIE, nie chýbajúce pole — preto `readCount`, ktorý
  // z nečísla urobí `null`, a nikdy dosadená nula.
  return { from, to, units: readCount(record, 'units') };
}

/** Zoznam dní `YYYY-MM-DD`; čokoľvek iné sa zahodí, nikdy nedopĺňa. */
function parseDays(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((day: unknown): day is string => typeof day === 'string' && day !== '');
}

function parseCode<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== 'string') return null;
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/**
 * Telo odpovede → overený pohľad, alebo `null`.
 *
 * NEZNÁMY STAV JE NEPREČÍTATEĽNÁ ODPOVEĎ, nie „measured". Keby sa neznámy kód
 * ticho preložil na hodnotu, siedmy stav z budúcej zmeny servera by tu vyrobil
 * dva stĺpce z prázdnych okien — presne `d00e081` znova.
 */
export function parseEffectiveness(raw: unknown): EffectivenessView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const state = parseCode(record['state'], EFFECTIVENESS_STATES);
  if (state === null) return null;
  const locked = asRecord(record['locked']);
  return {
    state,
    reason: parseCode(record['reason'], EFFECTIVENESS_REASONS),
    spanDays: readCount(record, 'spanDays'),
    startsOn: readText(record, 'startsOn'),
    duringTruncated: record['duringTruncated'] === true,
    before: parseWindow(record['before']),
    during: parseWindow(record['during']),
    missingBefore: parseDays(record['missingBefore']),
    missingDuring: parseDays(record['missingDuring']),
    locked: {
      revenue: locked === null ? '' : (readText(locked, 'revenue') ?? ''),
    },
  };
}

export interface EffectivenessResult {
  readonly ok: boolean;
  readonly data: EffectivenessView | null;
}

/**
 * Účinnosť zľavy v kusoch. Čisto čítacie, z lokálnej DB (K8).
 *
 * Nečitateľné telo NIKDY nekončí ako prázdny pohľad: prázdna sekcia je
 * tvrdenie („nemáme čo porovnať") a to sa z neznalosti povedať nesmie (P7).
 */
export async function discountEffectiveness(
  id: number,
  signal?: AbortSignal,
): Promise<EffectivenessResult> {
  let body: unknown;
  try {
    const res = await fetch(`/api/insights/campaign/${encodeURIComponent(String(id))}/effectiveness`, {
      headers: { Accept: 'application/json' },
      signal,
    });
    try {
      body = (await res.json()) as unknown;
    } catch {
      body = undefined;
    }
  } catch {
    return { ok: false, data: null };
  }
  const envelope = asRecord(body);
  if (envelope === null || envelope['ok'] !== true) return { ok: false, data: null };
  const data = parseEffectiveness(envelope['data']);
  return data === null ? { ok: false, data: null } : { ok: true, data };
}

/* ═══════════════ 2. Slová — priznania, nikdy čísla ════════════════════════ */

/**
 * DEFINÍCIA OKIEN NA OBRAZOVKE. Bez nej sa nedá overiť, čo sa s čím porovnáva
 * — a presne to umožnilo `d00e081` prežiť do produkcie.
 */
export const WINDOW_RULE =
  'Porovnávajú sa dva rovnako dlhé úseky: úsek pred zľavou končí deň pred jej začiatkom, úsek počas zľavy beží od jej začiatku.';

/** Priznanie, ktoré sekcia vypíše, keď sa účinnosť spočítať nedá. */
export const EFFECTIVENESS_UNAVAILABLE_WORD = 'nedá sa spočítať';

const WHY: Readonly<Record<EffectivenessReasonKind, string>> = {
  no_discount_window: 'Táto zľava nemá platné okno, takže niet čo s čím porovnať.',
  not_started: 'Zľava sa ešte nezačala, takže o jej účinnosti sa nedá povedať nič.',
  window_too_short: 'Zľava beží zatiaľ kratšie než tri dni — porovnanie by bolo šum.',
  baseline_overlaps_discount:
    'Do porovnávanej základne zasahuje iná zľava tých istých produktov; zľava sa so zľavou porovnávať nesmie.',
  coverage_gap:
    'Niektoré dni porovnávaných okien nie sú stiahnuté, takže rozdiel by meral výpadok sťahovania, nie zľavu.',
  unknown_campaign: 'Takú zľavu appka nepozná.',
};

/** Koľko chýbajúcich dní sa vymenuje, kým sa zvyšok zhrnie počtom. */
const MISSING_SHOWN = 5;

/**
 * Chýbajúce dni ako VÝPOČET, nie ako rozsah.
 *
 * „1. 8. – 5. 8." by tvrdilo, že chýba celý súvislý úsek; medzery zo
 * synchronizácie súvislé nebývajú. Preto sa dni menujú a zvyšok sa spočíta.
 */
export function missingDaysText(days: readonly string[]): string | null {
  if (days.length === 0) return null;
  const shown = days.slice(0, MISSING_SHOWN).map((day) => formatDateSk(day));
  const rest = days.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} a ďalších ${formatCountSk(rest)}` : shown.join(', ');
}

/** `Pred zľavou · 1. 8. 2026 – 14. 8. 2026`. Meno okna a jeho dátumy spolu. */
export function windowLabel(name: string, window: EffectivenessWindow | null): string {
  if (window === null) return name;
  return `${name} · ${formatDateSk(window.from)} – ${formatDateSk(window.to)}`;
}

/* ═══════════════════════════ 3. Vykreslenie ═══════════════════════════════ */

/** Pruh, ktorého dĺžka je pomer k väčšiemu z dvoch čísel. */
function Bar({ units, max, strong }: { units: number; max: number; strong?: boolean }) {
  const width = max <= 0 ? 0 : Math.round((units / max) * 100);
  return (
    <span className={strong === true ? `${styles.perfTrack} ${styles.perfStrong}` : styles.perfTrack}>
      <i style={{ width: `${width}%` }} />
    </span>
  );
}

/**
 * Uhol, ktorý appka nemá — jeden riadok: názov a dôvod. Nie karta: karta
 * sľubuje čísla a tu žiadne nie sú a ani nebudú, kým shop nedá viac (D17).
 */
function LockedAngle({ name, reason }: { name: string; reason: string }) {
  return (
    <div className={styles.perfLockedRow} data-testid="performance-locked">
      <span className={styles.perfLockedName}>{name}</span>
      <span className="lockline">{reason}</span>
    </div>
  );
}

/**
 * PRIZNANIE — slovo, dôvod a POMENOVANÉ okná, ktoré by sa porovnávali.
 *
 * ANI JEDNO ČÍSLO. Server pri `available: false` posiela `units: null`, ale
 * keby ich niekedy poslal, sekcia ich vypísať NESMIE: bolo by to číslo vydávané
 * za účinnosť zľavy, teda presne `d00e081`.
 */
function Unavailable({ view }: { view: EffectivenessView }) {
  const why = ((): string => {
    if (view.reason === null) return 'Server porovnanie nespočítal a dôvod nepovedal.';
    if (view.reason === 'not_started' && view.startsOn !== null) {
      return `${WHY.not_started} Platí od ${formatDateSk(view.startsOn)}.`;
    }
    return WHY[view.reason];
  })();
  const named = view.before !== null && view.during !== null;
  const missingBefore = missingDaysText(view.missingBefore);
  const missingDuring = missingDaysText(view.missingDuring);

  return (
    <div data-testid="performance-unavailable" data-state={view.state}>
      {/*
       * Nezačatá zľava má vlastnú kotvu: je to najčastejší stav v detaile
       * (zápis je fronta) a nález U5 stojí presne na nej.
       */}
      <p
        className="lvl-3"
        data-testid={view.reason === 'not_started' ? 'performance-not-started' : undefined}
      >
        Účinnosť — <b>{EFFECTIVENESS_UNAVAILABLE_WORD}</b>. {why}
      </p>

      {named ? (
        <p className="lvl-3" data-testid="performance-ranges">
          Porovnávalo by sa {windowLabel('pred zľavou', view.before)} s{' '}
          {windowLabel('počas zľavy', view.during)}.
        </p>
      ) : null}

      {missingBefore === null ? null : (
        <p className="lvl-3" data-testid="performance-missing-before">
          Z okna pred zľavou nemáme stiahnuté: {missingBefore}.
        </p>
      )}
      {missingDuring === null ? null : (
        <p className="lvl-3" data-testid="performance-missing-during">
          Z okna počas zľavy nemáme stiahnuté: {missingDuring}.
        </p>
      )}

      <p className="lvl-3" data-testid="performance-window-rule">
        {WINDOW_RULE}
      </p>
    </div>
  );
}

/** Dve merania vedľa seba — a appka ich za nikoho neodčíta (P8). */
function Measured({ view }: { view: EffectivenessView }) {
  const before = view.before?.units ?? null;
  const during = view.during?.units ?? null;
  const max = Math.max(before ?? 0, during ?? 0);

  return (
    <div data-testid="performance-measured">
      <div className={styles.perfPair}>
        <span>{windowLabel('Pred zľavou', view.before)}</span>
        {before === null ? <span /> : <Bar units={before} max={max} strong />}
        <span className={styles.perfValue}>
          {before === null ? '—' : `${formatCountSk(before)} ks`}
        </span>

        <span>{windowLabel('Počas zľavy', view.during)}</span>
        {during === null ? <span /> : <Bar units={during} max={max} />}
        <span className={styles.perfValue}>
          {during === null ? '—' : `${formatCountSk(during)} ks`}
        </span>
      </div>

      {view.duringTruncated ? (
        <p className="lvl-3" data-testid="performance-truncated">
          Zľava ešte beží, takže úsek počas zľavy je zatiaľ len po dnešok.
        </p>
      ) : null}
      <p className="lvl-3" data-testid="performance-window-rule">
        {WINDOW_RULE}
      </p>
      <p className="lvl-3" data-testid="performance-caveat">
        Sú to dve merania vedľa seba, nie príčina: appka nevie oddeliť vplyv zľavy od sezóny a
        skladu.
      </p>
    </div>
  );
}

export interface PerformanceCardProps {
  /** Načítané čísla; `null` = ešte sa načítavajú. */
  view: EffectivenessView | null;
  /** Načítanie zlyhalo — vtedy sa nepredstiera ani pomlčka, povie sa to vetou. */
  failed: boolean;
}

/**
 * Sekcia bez načítavania — všetko, čo sa naozaj vykreslí.
 *
 * Oddelené od `DiscountPerformance` zámerne a kvôli testom (19. 8. 2026):
 * dovtedy sa sekcia testovala cez `renderToStaticMarkup(<DiscountPerformance/>)`,
 * lenže `renderToStaticMarkup` efekty nespúšťa, takže `view` ostávalo `null`
 * a všetky tvrdenia — „appka nikde nepredstiera eurá", „žiadny záver o príčine"
 * — merali stav „Načítavam…". Práve preto v nich prežil nález, že
 * `.perfStrong i` mal `background: var(--ink3)`, čiže neexistujúci token, a
 * porovnávací pruh sa kreslil ako prázdny žľab. Nad touto funkciou sa dá
 * vykresliť KTORÝKOĽVEK stav bez prehliadača a bez siete.
 */
export function PerformanceCard({ view, failed }: PerformanceCardProps) {
  return (
    <section className="sec" data-testid="detail-performance">
      <div className="sec-h">
        <h2>Výkon výberu</h2>
        <div className="act lvl-3">
          {view === null || view.spanDays === null
            ? 'predané kusy'
            : `predané kusy za ${view.spanDays} dní`}
        </div>
      </div>

      {/* Čísla, ktoré appka naozaj má. Nadpis sekcie ich už pomenoval, takže
          vlastný nadpis ani rám nepotrebujú. */}
      <div data-testid="performance-units">
        {failed ? (
          <p className="lvl-3">Čísla sa nepodarilo načítať.</p>
        ) : view === null ? (
          <p className="lvl-3">Načítavam…</p>
        ) : view.state === 'measured' ? (
          <Measured view={view} />
        ) : (
          /* Priznanie, nie číslo — a je to BEŽNÝ priebeh, kým nie sú stiahnuté
             objednávky (P1 kontraktu V5), nie porucha appky. */
          <Unavailable view={view} />
        )}
      </div>

      {/* Čo appka nemá — dva tiché riadky, nie dve prázdne karty (D17). */}
      <div className={styles.perfLocked}>
        <LockedAngle name="Tržby" reason={view?.locked.revenue ?? 'shop ich cez API nevracia'} />
        {/* D18 — „Vlani rovnaké obdobie" bola príslovka nalepená na podstatné
            meno. Po slovensky sa to povie opačne. Dôvod nesie UI: odpoveď
            účinnosti o vlaňajšku nehovorí, lebo sa jej netýka. */}
        <LockedAngle name="Rovnaké obdobie vlani" reason="dáta zatiaľ tak ďaleko nesiahajú" />
      </div>
    </section>
  );
}

/** Sekcia aj s načítaním — to, čo do detailu zľavy naozaj vstupuje. */
export function DiscountPerformance({ id }: { id: number }) {
  const [view, setView] = useState<EffectivenessView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setView(null);
    setFailed(false);

    void (async () => {
      const res = await discountEffectiveness(id, controller.signal);
      if (!live) return;
      if (res.ok && res.data !== null) setView(res.data);
      else setFailed(true);
    })();

    return () => {
      live = false;
      controller.abort();
    };
  }, [id]);

  return <PerformanceCard view={view} failed={failed} />;
}

export default DiscountPerformance;
