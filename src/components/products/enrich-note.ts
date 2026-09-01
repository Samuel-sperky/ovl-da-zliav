/**
 * Aura Zľavy — ČO POVIE OBRAZOVKA PRODUKTOV O OBOHATENÍ STRANY (D123, R2).
 *
 * PREČO TENTO MODUL EXISTUJE
 * ──────────────────────────
 * Kvóta kľúča dovolí obohatiť ~600 produktov denne, teda **šesť strán po sto**
 * (kontrakt V5 §2). Kto preklikne desiatu stranu, dostane pomlčky — a to je
 * aritmetika kvóty, nie chyba. R2 kontraktu preto žiada, aby to obrazovka
 * POVEDALA ČÍSLOM, nie zamlčala: prázdna tabuľka bez vysvetlenia je presne
 * ten stav, po ktorom si človek myslí, že appka je pokazená.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * ───────────────────────
 *
 * 1. **Číslo, ktoré appka nemá, je POMLČKA, nie nula** (I11). `day.*` polia
 *    prichádzajú trojstavovo: `null` znamená „stav dávky sa nedal prečítať"
 *    alebo „dnes dávka nebežala". Nula by tvrdila, že dnes sa neobohatilo nič.
 *
 * 2. **Veta MLČÍ, keď niet čo povedať.** Strana, ktorej riadky boli svieže,
 *    nepotrebuje hlásenie — trvalá vysvetlivka sa po týždni prestane čítať
 *    a odnesie si aj tie prípady, keď platí. `null` = nekreslí sa nič.
 *
 * 3. **Odmietnutie shopu a naplnený cieľ sú DVE RÔZNE veci.** „Dnes už nie"
 *    je plán, „shop nás odmietol" je porucha. Zliať ich by znamenalo, že
 *    človek čaká do polnoci na niečo, čo treba odblokovať.
 *
 * 4. **Kód chyby sa nevypisuje na povrch surový** — je to `error` z routy
 *    (I1: kód, nikdy telo odpovede shopu) a patrí do `title`, nie do vety.
 *
 * Modul je ČISTÝ (žiadny React, žiadny `fetch`), aby sa dal overiť bez
 * prehliadača — `test/unit/obohatenie-strany-na-obrazovke.spec.ts`.
 *
 * Vlastník: V5 (obohatenie strany na obrazovke).
 */
import { formatCountSk } from '@/lib/ui/vocabulary';
import { NEVIEME } from '@/lib/ui/product-label';

/** Výsledok obohatenia strany tak, ako ho povedala routa. */
export type EnrichPageOutcomeKind =
  | 'done'
  | 'fresh_only'
  | 'no_ids'
  | 'busy'
  | 'target_reached'
  | 'paused'
  | 'deadline'
  | 'locked'
  | 'unknown_scope'
  | 'no_key'
  | 'budget_day'
  | 'budget_minute'
  | 'budget_unknown'
  | 'ip_banned'
  | 'rate_limited'
  | 'failed';

/** Dnešné počty. Každé `null` je „nevieme", NIKDY nula (I11). */
export interface EnrichDayNumbers {
  readonly enrichedTodayByBatch: number | null;
  readonly dailyTarget: number | null;
  readonly targetLeft: number | null;
  readonly readsUsedToday: number | null;
  readonly readsLeftToday: number | null;
  readonly readsLimitToday: number | null;
}

/** Odpoveď `POST /api/catalog/enrich` s `{ productIds }`, prečítaná klientom. */
export interface EnrichPageView {
  readonly outcome: EnrichPageOutcomeKind;
  /** Koľko ID sa naozaj posudzovalo (po očistení). */
  readonly requested: number;
  /** Koľko riadkov bolo dosť svieže — `getFull` sa pre ne nevolal. */
  readonly fresh: number;
  readonly stale: number;
  readonly attempted: number;
  readonly enriched: number;
  /** Koľko nesviežich riadkov zostalo NEDOTKNUTÝCH (čas, kvóta, cieľ, pauza). */
  readonly skipped: number;
  readonly day: EnrichDayNumbers;
  readonly resumeAt: string | null;
  /** KÓD, nikdy telo odpovede shopu (I1). */
  readonly error: string | null;
}

/** Jedna veta pod tabuľkou. `tone` rozhoduje o stlmení, nie o farbe samotnej. */
export interface EnrichNoteView {
  readonly text: string;
  readonly tone: 'quiet' | 'attention';
  /** Podrobnosť do `title` — kód chyby, čas ďalšieho pokusu. `null` = nič. */
  readonly title: string | null;
}

/** Číslo, alebo priznanie. Nula sa píše ako nula — je to meraný fakt. */
function count(value: number | null): string {
  return value === null ? NEVIEME : formatCountSk(value);
}

/**
 * Veta o dnešnom cieli. Vždy nesie OBE čísla (koľko dávka stihla, aký je cieľ),
 * lebo „cieľ je naplnený" bez čísel je tvrdenie, ktoré sa nedá overiť.
 */
function dayLine(day: EnrichDayNumbers): string {
  return (
    `Dnešný cieľ obohacovania: ${count(day.enrichedTodayByBatch)} ` +
    `z ${count(day.dailyTarget)}, zostáva ${count(day.targetLeft)}.`
  );
}

/** Kedy sa smie skúsiť znova — do `title`, nie do vety. */
function resumeTitle(view: EnrichPageView): string | null {
  const parts = [
    view.error === null ? null : `Kód: ${view.error}.`,
    view.resumeAt === null ? null : `Ďalší pokus najskôr ${view.resumeAt}.`,
  ].filter((part) => part !== null);
  return parts.length === 0 ? null : parts.join(' ');
}

/**
 * Čo obrazovka povie o obohatení práve zobrazenej strany.
 *
 * `null` = mlčí. Mlčí PRÁVE VTEDY, keď sa nič nestalo a ani nemalo (strana bola
 * svieža, alebo nebolo čo obohacovať) — v každom inom prípade padne číslo.
 */
export function enrichPageNote(view: EnrichPageView | null): EnrichNoteView | null {
  if (view === null) return null;
  const zostava = formatCountSk(view.skipped);
  const title = resumeTitle(view);

  switch (view.outcome) {
    /* Nič sa nedialo a ani nemalo — obrazovka mlčí. */
    case 'fresh_only':
    case 'no_ids':
      return null;

    case 'done':
      /* Bez jediného obohateného riadku nie je čo hlásiť: strana bola svieža
         alebo v zrkadle nebola. Číslo padne len vtedy, keď sa naozaj niečo
         zmenilo — inak by veta stála pod tabuľkou navždy. */
      if (view.enriched === 0) return null;
      return {
        text: `Obohatených na tejto strane: ${formatCountSk(view.enriched)}. ${dayLine(view.day)}`,
        tone: 'quiet',
        title,
      };

    case 'target_reached':
      /* R2 — TOTO je veta, kvôli ktorej modul vznikol. */
      return {
        text:
          `${dayLine(view.day)} Zvyšné riadky tejto strany (${zostava}) preto ` +
          'zostávajú s pomlčkami — nie je to chyba, je to strop dennej kvóty kľúča.',
        tone: 'attention',
        title,
      };

    case 'no_key':
      return {
        text:
          'Obohacovanie nebeží: appka nemá zapísaný kľúč do shopu, a bez neho sa ' +
          `na podrobnosti produktov nedá spýtať. Riadkov čakajúcich na obohatenie: ${zostava}.`,
        tone: 'attention',
        title,
      };

    case 'locked':
    case 'unknown_scope':
      return {
        text:
          view.outcome === 'locked'
            ? 'Obohacovanie nebeží: kľúč nemá oprávnenie čítať podrobnosti produktov. ' +
              `Riadkov čakajúcich na obohatenie: ${zostava}.`
            : 'Obohacovanie nebeží: o oprávneniach kľúča appka zatiaľ nevie — ' +
              `neoverila ich, takže netvrdí ani že chýbajú. Čakajúcich riadkov: ${zostava}.`,
        tone: 'attention',
        title,
      };

    case 'budget_day':
      return {
        text:
          `Denný rozpočet čítaní je vyčerpaný: ${count(view.day.readsUsedToday)} ` +
          `z ${count(view.day.readsLimitToday)}. Zvyšné riadky strany (${zostava}) ` +
          'zostávajú s pomlčkami do ďalšieho dňa.',
        tone: 'attention',
        title,
      };

    case 'budget_minute':
      return {
        text: `Minútový strop čítaní je vyčerpaný; ${zostava} riadkov sa doplní o chvíľu.`,
        tone: 'quiet',
        title,
      };

    case 'budget_unknown':
      return {
        text:
          'Koľko čítaní dnes zostáva, sa nepodarilo zistiť, takže sa nezačalo — ' +
          `appka radšej neminie kvótu naslepo. Čakajúcich riadkov: ${zostava}.`,
        tone: 'attention',
        title,
      };

    case 'ip_banned':
      return {
        text:
          'Shop odmieta volania z tejto adresy, takže sa neobohatil ani jeden riadok. ' +
          'Pauza čaká na človeka — sama nevyprší.',
        tone: 'attention',
        title,
      };

    case 'rate_limited':
    case 'paused':
      return {
        text:
          `Obohacovanie má pauzu, ktorú si vyžiadal shop; ${zostava} riadkov ` +
          'tejto strany zostáva zatiaľ s pomlčkami.',
        tone: 'attention',
        title,
      };

    case 'deadline':
      return {
        text:
          `Strana sa nestihla celá: obohatených ${formatCountSk(view.enriched)}, ` +
          `zostáva ${zostava}. Otvorením strany znova sa bude pokračovať.`,
        tone: 'quiet',
        title,
      };

    case 'busy':
      return {
        text: 'Obohacuje sa iná strana; táto príde na rad hneď po nej.',
        tone: 'quiet',
        title,
      };

    case 'failed':
      return {
        text:
          `Obohatenie strany sa nepodarilo dokončiť: obohatených ` +
          `${formatCountSk(view.enriched)}, zostáva ${zostava}.`,
        tone: 'attention',
        title,
      };
  }
}
