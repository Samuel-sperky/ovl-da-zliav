/**
 * Aura Zľavy — STAV DÁVKY OBOHACOVANIA NA POVRCHU (D118 bod 2, D120; I11).
 *
 * PREČO TENTO MODUL VÔBEC EXISTUJE
 * --------------------------------
 * Dávka obohacovania (`runEnrichBatch`) si od migrácie 0014 zapisovala, kde
 * stojí a PREČO, do `catalog_enrich_state` — a nečítal to NIKTO. `grep -rn
 * loadEnrichState src/` vracal 28. 8. 2026 výhradne engine a repozitár: žiadny
 * endpoint, žiadny komponent. Dávka teda mohla stáť tri týždne s
 * `pause_reason = 'ip_banned'` a človek to zistil jedine `SELECT`-om do
 * databázy. To je presne stav, ktorý I11 zakazuje: appka VIE, že stojí,
 * a nepovie to.
 *
 * Modul je JEDEN zdroj pravdy pre dve veci naraz:
 *   1. TVAR odpovede `GET /api/catalog/enrich` (`EnrichStatePayload`) — tie isté
 *      typy číta route aj obrazovka, takže sa nemajú kde rozísť,
 *   2. SLOVENSKÉ VETY o dávke (`enrichNote`, `enrichCoverageSentence`).
 *
 * Vety sú tu, a nie v dvoch komponentoch, zámerne: kreslí ich Prehľad
 * (stavový pás) aj Nastavenia (sekcia „Obohacovanie katalógu"), a dve
 * formulácie toho istého dôvodu sa raz rozídu — v tomto repe to už stálo tri
 * samostatné chyby pri prekážkach.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *  1. **Žiadna červená.** `EnrichTone` úmyselne NEMÁ `critical`. Neobohatený
 *     katalóg nie je porucha: pri ~200 čítaniach na deň a 41 348 produktoch je
 *     plošný prechod ~207 dní, takže „ešte nie je hotové" je PRIEBEH. Červená
 *     je v tejto appke vyhradená pre stratu dát a zastavený zápis; keby ju
 *     dostalo obohacovanie, prestala by niečo znamenať.
 *  2. **`pausedUntil = null` pri `ip_banned` je ZÁMER, nie chýbajúci údaj.**
 *     Dôvod trvá, kým doň nezasiahne človek (odblokovanie IP je akcia
 *     používateľa, `docs/60`), takže žiadny čas ďalšieho pokusu neexistuje —
 *     a veta to musí povedať tak, aby to nevyzeralo ako chyba appky. Kto sem
 *     dopíše „skúste to o chvíľu znova", posiela človeka do nekonečnej slučky.
 *  3. **Tri stavy každého čísla** (I11). `null` znamená VÝHRADNE „nevieme"
 *     a kreslí sa ako pomlčka; nula je meraný fakt. Preto je `enrichedToday`
 *     `null`, keď dávka DNES nebežala — vtedy je počítadlo z iného dňa a
 *     vydávať ho za dnešok by bolo tvrdenie, ktoré nikto nemeral.
 *  4. **Kód chyby sa na povrch nedostane** (I1, K10). Z `last_error` ide von
 *     len `failedLastTime: boolean`; kód by bol žargón a mohol by niesť kus
 *     odpovede shopu.
 *
 * Čistý modul — žiadny React, žiadny `fetch`, žiadna databáza. Aby sa dal celý
 * dokázať testom.
 *
 * Vlastník: V4 (obohacovanie).
 */
import { formatDateTimeSk } from '@/lib/ui/format';
import { formatCountSk } from '@/lib/ui/vocabulary';

/* ═══════════════════════════ 1. Tvar odpovede ═════════════════════════════ */

/**
 * Dôvody pauzy dávky — zrkadlo `CatalogEnrichPauseReason` z repozitára.
 *
 * Kópia je tu preto, že typ z `repo/catalog.repo.ts` ťahá databázu, takže sa do
 * prehliadača doniesť nedá. Rozídeniu bráni typecheck: route priraďuje
 * `state.pauseReason` do poľa typu `EnrichPauseCode | null`, takže nový dôvod
 * v repozitári zlomí build, nie obrazovku.
 */
export const ENRICH_PAUSE_REASONS = [
  'rate_limited',
  'daily_budget',
  'ip_banned',
  'no_key',
  'error',
] as const;
export type EnrichPauseCode = (typeof ENRICH_PAUSE_REASONS)[number];

/** Kde stojí dávka. `null` v celom bloku = stav sa nedal prečítať. */
export interface EnrichBatchStateWire {
  /** `false` = dávka sa ešte ani raz nespustila. NIE JE to chyba. */
  readonly everRan: boolean;
  /** UTC deň, ku ktorému platí `enrichedToday`. `null` = dávka nikdy nebežala. */
  readonly batchDay: string | null;
  /** Koľko produktov dávka obohatila DNES. `null` = dnes nebežala (I11). */
  readonly enrichedToday: number | null;
  /** Koľko ich má obohatiť za deň (~150, D118). */
  readonly dailyTarget: number;
  readonly startedAt: string | null;
  /** Kedy sa naposledy naozaj čítalo zo shopu — meraný fakt, nie odhad. */
  readonly lastReadAt: string | null;
  readonly pauseReason: EnrichPauseCode | null;
  /** Dokedy dávka stojí. `null` pri vyplnenom dôvode = kým nezasiahne človek. */
  readonly pausedUntil: string | null;
  /** `true` = dávka je práve zastavená (dôvod ešte trvá). */
  readonly paused: boolean;
  /** `true` = pauzu neuvoľní čakanie, ale iba akcia človeka. */
  readonly waitsForHuman: boolean;
  /** `true` = posledný beh skončil chybou. KÓD sa na povrch nedostane (I1). */
  readonly failedLastTime: boolean;
  readonly updatedAt: string | null;
}

/**
 * Koľko z katalógu je obohatené.
 *
 * `catalogProducts` (riadky v zrkadle) a `shopTotalProducts` (čo hlási shop) sú
 * DVE RÔZNE ČÍSLA a nezlievajú sa: dávka vie obohatiť iba to, čo zrkadlo má,
 * kdežto shop medzitým pridáva aj maže. Percento sa preto počíta zo zrkadla.
 */
export interface EnrichCoverageWire {
  /** Koľko produktov je obohatených. `null` = stav dávky sa nedal prečítať. */
  readonly enriched: number | null;
  /** Koľko riadkov má zrkadlo katalógu. `null` = nedalo sa prečítať. */
  readonly catalogProducts: number | null;
  /** Koľko produktov hlási shop. `null` = shop to ešte nepovedal. */
  readonly shopTotalProducts: number | null;
  /** Koľko ešte nie je obohatených. `null` = nevieme z čoho odčítať. */
  readonly remaining: number | null;
  /** Percentá 0–100 s jedným desatinným miestom. `null` = nevieme. */
  readonly percent: number | null;
  /** Koľko DNÍ pri dnešnom cieli. `null` = nevieme z čoho počítať. */
  readonly estimatedDaysLeft: number | null;
}

/** Celá odpoveď `GET /api/catalog/enrich`. */
export interface EnrichStatePayload {
  /** `null` = `catalog_enrich_state` sa nedal prečítať (fail-closed, nie nula). */
  readonly state: EnrichBatchStateWire | null;
  readonly coverage: EnrichCoverageWire;
  /** Mená blokov, ktoré sa nedali prečítať. Prázdne = prečítalo sa všetko. */
  readonly unreadable: readonly string[];
  readonly at: string;
}

/* ═══════════════════════════ 2. Vety a tón ════════════════════════════════ */

/**
 * Tón vety o dávke. `critical` tu ZÁMERNE nie je — viď bod 1 hlavičky.
 *
 * Hodnoty sú podmnožina `StatusTone` (`components/ui/ToneBadge.tsx`), takže sa
 * dajú podať do `toneSigClass()` bez prevodnej tabuľky. Druhá tabuľka tónov by
 * bola presne tá chyba, ktorú opisuje hlavička `ui/blocker-look.ts`.
 */
export type EnrichTone = 'good' | 'progress' | 'attention' | 'idle';

/** Jedna veta o dávke: tón, krátke pomenovanie, čo sa deje a čo s tým. */
export interface EnrichNote {
  readonly tone: EnrichTone;
  /** Krátke pomenovanie stavu — do stavového pásu. */
  readonly label: string;
  /** ČO sa deje. Slovenská veta, bez kódov a bez žargónu. */
  readonly what: string;
  /** ČO S TÝM. `null` = netreba robiť nič a appka to nepredstiera. */
  readonly nextStep: string | null;
}

/** `10` → `"10"`, `3.4` → `"3,4"`. Desatinná čiarka, nikdy bodka. */
function percentSk(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(1).replace('.', ',');
}

/**
 * Fráza o čase ďalšieho pokusu.
 *
 * `null` (teda „dokedy nevieme") sa NEDOPLŇUJE hodinou — vráti sa „o chvíľu",
 * čo je priznanie, nie sľub. Vymyslený čas by bol tvrdenie, ktoré appka
 * nedrží.
 */
function resumePhrase(pausedUntil: string | null): string {
  if (pausedUntil === null) return 'o chvíľu';
  const at = new Date(pausedUntil);
  if (Number.isNaN(at.getTime())) return 'o chvíľu';
  return `po ${formatDateTimeSk(pausedUntil)}`;
}

/**
 * Koľko z katalógu je obohatené — jednou vetou.
 *
 * Tri stavy, nie dva (I11): neznámy čitateľ, neznámy menovateľ a hodnota. Nula
 * obohatených je MERANÝ fakt a povie sa ako nula; „nevieme" je pomlčka vo vete.
 * Odhad dní nesie `≈`, pretože odhad je (P7).
 */
export function enrichCoverageSentence(coverage: EnrichCoverageWire): string {
  const { enriched, catalogProducts, percent, estimatedDaysLeft } = coverage;

  // Explicitné porovnania: Turbopack tu už raz zahodil `if (!value)` ako
  // compile-time falsy a obrazovka potom kreslila nuly.
  if (enriched === null) {
    return 'Koľko produktov je obohatených, appka práve nevie.';
  }
  if (catalogProducts === null) {
    return `Obohatených je ${formatCountSk(enriched)} produktov. Z koľkých, appka práve nevie.`;
  }

  const head =
    percent === null
      ? `Obohatených ${formatCountSk(enriched)} z ${formatCountSk(catalogProducts)} produktov.`
      : `Obohatených ${formatCountSk(enriched)} z ${formatCountSk(catalogProducts)} produktov (${percentSk(percent)} %).`;

  if (coverage.remaining === 0) return `${head} Katalóg je obohatený celý.`;
  if (estimatedDaysLeft === null) return head;
  return `${head} Pri dnešnom dennom cieli to je ≈ ${formatCountSk(estimatedDaysLeft)} dní.`;
}

/** Veta o dávke pri KAŽDOM dôvode pauzy. Jedna tabuľka, žiadne vetvenie v JSX. */
function pauseNote(state: EnrichBatchStateWire): EnrichNote {
  switch (state.pauseReason) {
    /*
     * Dnešná realita (KONTRAKT-V4 §2b): shop odmieta našu adresu na všetko,
     * vrátane čítania bez kľúča. Čakanie to nevylieči, takže veta nesmie
     * ponúkať ďalší pokus — a musí vysvetliť, prečo tu nie je čas obnovenia.
     */
    case 'ip_banned':
      return {
        tone: 'attention',
        label: 'Dávka stojí — eshop odmieta našu adresu',
        what:
          'Eshop neprijíma čítanie z tejto adresy, takže dávka obohacovania stojí a ' +
          'katalóg zostal tam, kde bol. Čas ďalšieho pokusu preto neexistuje: dôvod ' +
          'trvá, kým adresu niekto neodblokuje, a appka ani nový kľúč s tým nič ' +
          'nezmôžu.',
        nextStep:
          'Požiadajte eshop o odblokovanie adresy — opakovaním sa to nezmení. Potom ' +
          'dávka pokračuje sama.',
      };

    case 'no_key':
      return {
        tone: 'attention',
        label: 'Dávka stojí — chýba kľúč',
        what:
          'Dávka potrebuje kľúč s oprávnením čítať produkty; bez neho nemá čím čítať. ' +
          'Čas ďalšieho pokusu preto neexistuje — čaká sa na kľúč, nie na hodinu.',
        nextStep: 'Vložte kľúč v Nastaveniach → Kľúče. Dávka pokračuje sama.',
      };

    case 'rate_limited':
      return {
        tone: 'progress',
        label: 'Dávka čaká — eshop pribrzdil čítanie',
        what: 'Eshop povedal, že sa pýtame príliš rýchlo, tak dávka na chvíľu zastavila.',
        nextStep: `Netreba robiť nič — dávka pokračuje sama ${resumePhrase(state.pausedUntil)}.`,
      };

    /*
     * Vyčerpaná denná kvóta NIE JE porucha: katalóg sa obohacuje po dieloch
     * a jeden diel je ~150 produktov za deň. Preto `progress`, nie `attention`.
     */
    case 'daily_budget':
      return {
        tone: 'progress',
        label: 'Dávka má dnešný diel hotový',
        what:
          'Denná kvóta čítaní je vyčerpaná, takže dnešný diel dávky dobehol. Katalóg ' +
          'sa obohacuje po dieloch a postupuje ďalej.',
        nextStep: `Netreba robiť nič — dávka pokračuje ${resumePhrase(state.pausedUntil)}.`,
      };

    case 'error':
      return {
        tone: 'attention',
        label: 'Posledné čítanie dávky spadlo',
        what:
          'Poslednú dávku sa nepodarilo prečítať, takže obohatenie zostalo tam, kde bolo.',
        nextStep: `Appka to skúsi sama ${resumePhrase(state.pausedUntil)}.`,
      };

    // Pauza bez dôvodu neexistuje: `paused` sa počíta z `pauseReason`. Vetva je
    // tu pre typecheck a hovorí to isté ako pokojný priebeh.
    case null:
      return runningNote(state);
  }
}

/** Dávka beží (alebo je hotová) — veta o priebehu, nikdy o poplachu. */
function runningNote(state: EnrichBatchStateWire): EnrichNote {
  /*
   * Denný cieľ sa spomína LEN keď ho naozaj poznáme. Nula by tu bola vymyslené
   * číslo v tvrdení o rýchlosti („za deň obohatí 0 produktov"), a to je presne
   * ten druh vety, ktorý I11 zakazuje.
   */
  const rate =
    state.dailyTarget > 0
      ? `Za deň obohatí ${formatCountSk(state.dailyTarget)} produktov, takže celý ` +
        'katalóg je vec mesiacov — postupuje po dieloch.'
      : 'Katalóg sa obohacuje po dieloch na pozadí.';

  return {
    tone: 'progress',
    label: 'Dávka obohacovania beží',
    what: `Dávku nič nebrzdí. ${rate}`,
    nextStep: null,
  };
}

/**
 * Stav dávky jednou vetou — pre stavový pás Prehľadu aj pre sekciu Nastavení.
 *
 * Funkcia je TOTÁLNA: vracia vetu aj pre nečitateľný stav, aj pre dávku, ktorá
 * nikdy nebežala. Mlčanie je to jediné, čo si appka pri tomto údaji dovoliť
 * nesmie — mlčanie bolo doteraz jej celé chovanie.
 *
 * ČAS SA TU NEPOČÍTA a funkcia ho ani neprijíma: či dávka stojí, rozhoduje
 * SERVER (pole `paused`), ktorý má rovnaké hodiny ako databáza. Druhé
 * rozhodovanie v prehliadači by pri rozídených hodinách povedalo niečo iné než
 * server a nedalo by sa určiť, ktoré z toho klame.
 */
export function enrichNote(payload: EnrichStatePayload | null): EnrichNote {
  // Turbopack: porovnávaj explicitne, nikdy `if (!payload)`.
  if (payload === null || payload.state === null) {
    return {
      tone: 'idle',
      label: 'Stav dávky nevieme',
      what:
        'Stav dávky obohacovania sa nepodarilo prečítať, takže appka o ňom nič ' +
        'netvrdí — ani že beží, ani že stojí.',
      nextStep: null,
    };
  }

  const state = payload.state;

  if (!state.everRan) {
    return {
      tone: 'idle',
      label: 'Dávka ešte nebežala',
      what:
        'Obohacovanie katalógu sa zatiaľ ani raz nespustilo. Dávka beží na pozadí ' +
        'a začne sama.',
      nextStep: null,
    };
  }

  if (state.paused) return pauseNote(state);

  const coverage = payload.coverage;
  if (coverage.remaining === 0 && coverage.enriched !== null) {
    return {
      tone: 'good',
      label: 'Katalóg je obohatený celý',
      what: enrichCoverageSentence(coverage),
      nextStep: null,
    };
  }

  return runningNote(state);
}
