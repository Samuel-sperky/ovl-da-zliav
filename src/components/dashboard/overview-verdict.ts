/**
 * Aura Zľavy — ODPOVEĎ NA OTÁZKU „JE VŠETKO V PORIADKU?" (V9; kontrakt UI
 * 13. 8. 2026, body 3–7).
 *
 * Prehľad má na túto jedinú otázku odpovedať do troch sekúnd. Doteraz na ňu
 * neodpovedal vôbec: dominantou bolo číslo fronty `3 420 / 8 000`, čo je
 * odpoveď na inú otázku („aké mám čísla"), a či je niečo v neporiadku, sa
 * dalo zistiť až prečítaním piatich sekcií. Tento modul preto z faktov, ktoré
 * appka MERIA, skladá jednu vetu — dominantu obrazovky — a k nej krátky riadok
 * kontrol.
 *
 * ROZHODUJE SA TU, NEKRESLÍ SA. Rovnako ako `overview-model.ts`: veta
 * „Všetko v poriadku" je tvrdenie o produkčnom eshope a musí sa dať overiť
 * bez prehliadača.
 *
 * ČO SA V TOMTO MODULE NESMIE POKAZIŤ
 * -----------------------------------
 *
 * 1. **„Všetko v poriadku" je najsilnejšie tvrdenie appky.** Padne LEN vtedy,
 *    keď sa stav dal prečítať CELÝ (`unreadable` je prázdne), nič nezastavuje,
 *    nič nebrzdí, zápisy nie sú zamknuté poistkou a fronta nestojí. Chýbajúci
 *    údaj sa nikdy nepočíta ako dobrý — je to `unknown`, nie `ok` (P7).
 * 2. **Farbu volí SPÔSOB RIEŠENIA, nie závažnosť** (kontrakt, bod 7). Keď
 *    zápis zastavil vyčerpaný denný rozpočet, verdikt je pokojný a sivý —
 *    zastavuje, ale nikto s tým nič robiť nemá. Jantár patrí tomu, čo čaká na
 *    človeka.
 * 3. **Verdikt nehovorí PREČO.** Dôvody sú vety zo servera a vypisuje ich
 *    sekcia prekážok pod dominantou. Tu je len počet, aby sa dalo poznať, či
 *    ide o jednu vec alebo o päť. Druhá kópia dôvodu by sa s tou prvou raz
 *    rozišla.
 * 4. **Riadok kontrol nesmie opakovať stavový pruh.** Pruh (chróm) nesie
 *    ostrý zápis, kľúč, rozpočet zápisov a počty katalógu. Kontroly preto
 *    nesú len to, čo v pruhu NIE JE: posledný krok fronty, spojenie so shopom,
 *    strop rozsahu a to, čo katalóg práve robí (nie koľko ho je).
 * 5. **Žiadne čísla v kontrolách okrem stropu rozsahu.** Kontrola je značka
 *    a fráza, nie ďalšia dlaždica. Čísla katalógu a rozpočtu sú v pruhu.
 *
 * Vlastník: V9.
 */
import type {
  CatalogCountsView,
  CatalogSyncView,
  ScopeView,
  StatusView,
} from '@/components/dashboard/status-api';
import type { QueueProgress } from '@/components/dashboard/overview-model';
import {
  heartbeatSummary,
  screenBlockers,
  shopPill,
  unreadableSentence,
  type HeartbeatView,
  type SigTone,
} from '@/components/dashboard/live-status-model';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';
import { formatDateTimeSk } from '@/lib/ui/format';

/* ═══════════════════════ 1. Riadok kontrol pri dominante ══════════════════ */

/**
 * Jedna kontrola — značka, krátka fráza a cesta, kde sa s tým dá niečo robiť.
 *
 * Fráza je fráza, nie veta: bez bodky, bez „appka", bez čísel. Celý riadok sa
 * má dať prebehnúť očami za sekundu, inak by to bola šiesta sekcia.
 */
export interface CheckMark {
  readonly id: 'fronta' | 'shop' | 'katalog' | 'rozsah';
  readonly tone: SigTone;
  readonly text: string;
  readonly path: string | null;
}

/** Kontroluje appka frontu? Bez údaja platí to horšie (fail-closed). */
export function queueCheck(heartbeat: HeartbeatView | null): CheckMark {
  const beat = heartbeatSummary(heartbeat);
  return {
    id: 'fronta',
    tone: beat.tone,
    text: beat.tone === 'ok' ? 'Fronta sa kontroluje' : 'Fronta sa nekontroluje',
    path: '/zlavy',
  };
}

/**
 * Spojenie so shopom — meraný fakt z posledného úspešného čítania katalógu.
 * Tón `StatusPill` sa prekladá na tón značky; nový slovník tu nevzniká.
 */
export function shopCheck(sync: CatalogSyncView | null): CheckMark {
  const pill = shopPill(sync);
  const tone: SigTone = pill.tone === 'good' ? 'ok' : pill.tone === 'idle' ? 'idle' : 'warn';
  return { id: 'shop', tone, text: pill.label, path: '/produkty' };
}

/**
 * Čo katalóg práve robí. NIE koľko ho je — to je v stavovom pruhu.
 *
 * PRÁZDNY KATALÓG NIE JE DOKONČENÝ KATALÓG. Kým sa nič neprečítalo, je
 * `loaded` aj `total` nula a holé `loaded >= total` z toho spraví „načítaný
 * celý": appka by tvrdila, že má všetkých 41 082 produktov, a pritom nemá ani
 * jeden. Odvodený záver preto vyžaduje, aby sa naozaj niečo načítalo — a ani
 * meraný príznak `complete` neplatí nad prázdnou tabuľkou.
 *
 * Obnova sa priznáva: po každom dokončenom prechode beží nový a ten začína od
 * stránky 0. Kým to kontrola nepovedala, javilo sa čítanie shopu pri „hotovom"
 * katalógu ako záhada.
 */
export function catalogCheck(
  sync: CatalogSyncView | null,
  counts: CatalogCountsView | null,
): CheckMark {
  const base = { id: 'katalog', path: '/produkty' } as const;
  const loaded = sync?.loadedProducts ?? counts?.loadedProducts ?? null;
  const total = sync?.shopTotalProducts ?? counts?.shopTotalProducts ?? null;

  if (sync === null && loaded === null) {
    return { ...base, tone: 'idle', text: 'Stav katalógu nevieme' };
  }

  const somethingLoaded = loaded !== null && loaded > 0;
  const complete =
    somethingLoaded &&
    (sync?.complete === true || (total !== null && total > 0 && loaded >= total));

  if (complete) {
    return {
      ...base,
      tone: 'ok',
      text: sync?.refreshing === true ? 'Katalóg načítaný celý, obnovuje sa' : 'Katalóg načítaný celý',
    };
  }
  if (loaded === 0) return { ...base, tone: 'warn', text: 'Katalóg prázdny' };
  if (sync?.waiting === 'error') return { ...base, tone: 'warn', text: 'Katalóg — čítanie neprešlo' };
  if (sync?.waiting === 'daily_budget') {
    return { ...base, tone: 'idle', text: 'Katalóg čaká na rozpočet čítaní' };
  }
  if (sync?.waiting === 'rate_limited') {
    return { ...base, tone: 'idle', text: 'Katalóg má prestávku od shopu' };
  }
  return { ...base, tone: 'ok', text: 'Katalóg sa dočítava' };
}

/**
 * Strop jednej zľavy (K1).
 *
 * Jediná kontrola, ktorá nesie číslo — bez neho je „pilotný" prázdne slovo
 * a v pruhu strop nie je. Zámok hovorí, že cesta k vyššiemu stropu existuje
 * a čo si vyžiada.
 */
export function scopeCheck(scope: ScopeView): CheckMark {
  const base = { id: 'rozsah', path: '/nastavenia' } as const;
  const cap =
    scope.maxProducts === null
      ? null
      : `${formatCountSk(scope.maxProducts)} ${pluralSk(scope.maxProducts, 'produkt', 'produkty', 'produktov')}`;

  if (scope.pilot === null) return { ...base, tone: 'idle', text: 'Rozsah zľavy nevieme' };
  const word = scope.pilot ? 'Rozsah pilotný' : 'Rozsah plný';
  return {
    ...base,
    tone: scope.pilot ? 'lock' : 'ok',
    text: cap === null ? word : `${word} · ${cap} na zľavu`,
  };
}

export interface VerdictInput {
  readonly status: StatusView | null;
  readonly sync: CatalogSyncView | null;
  readonly heartbeat: HeartbeatView | null;
  readonly progress: QueueProgress;
}

/**
 * Štyri kontroly v pevnom poradí: najprv to, čo sa mení každú minútu, potom
 * to, čo stojí týždne. Poradie je súčasťou čitateľnosti — preskladanie riadku
 * medzi načítaniami by z neho spravilo blikajúcu ozdobu.
 */
export function overviewChecks(input: VerdictInput): readonly CheckMark[] {
  return [
    queueCheck(input.heartbeat),
    shopCheck(input.sync),
    catalogCheck(input.sync, input.status?.catalog ?? null),
    scopeCheck(input.status?.scope ?? { pilot: null, maxProducts: null }),
  ];
}

/* ═══════════════════════════════ 2. Verdikt ═══════════════════════════════ */

/**
 * Štyri možné odpovede. `unknown` NIE JE porucha — je to priznanie, že appka
 * na verdikt nemá podklad, a je prísnejšie než `ok`.
 */
export type VerdictKind = 'ok' | 'slowed' | 'stopped' | 'unknown';

export interface Verdict {
  readonly kind: VerdictKind;
  readonly tone: SigTone;
  /** Slovo do hlavičky sekcie, vedľa glyfu. */
  readonly word: string;
  /** DOMINANTA obrazovky — jedna veta, 44 px, bez bodky. */
  readonly headline: string;
  /** Riadok pod dominantou. Čo to znamená, nikdy prečo. */
  readonly detail: string;
}

/** `1 prekážka zastavuje zápis.` — číslo aj sloveso sa skloňujú spolu. */
function countSentence(count: number, verb: 'zastavuje' | 'spomaľuje'): string {
  const tail =
    verb === 'zastavuje'
      ? pluralSk(count, 'prekážka zastavuje', 'prekážky zastavujú', 'prekážok zastavuje')
      : pluralSk(count, 'prekážka spomaľuje', 'prekážky spomaľujú', 'prekážok spomaľuje');
  return `${formatCountSk(count)} ${tail} zápis.`;
}

/**
 * Celá odpoveď na „je všetko v poriadku?" jedným výpočtom.
 *
 * Poradie vetiev je poradie naliehavosti a je záväzné:
 *
 *   1. stav sa nedá prečítať vôbec → nevieme,
 *   2. poistka zámku alebo prekážka, ktorá zastavuje → stojí,
 *   3. fronta stojí po odstávke → stojí (heartbeat je fakt z databázy),
 *   4. prekážka, ktorá brzdí → pomalšie,
 *   5. stav fronty sa nedá prečítať → nevieme,
 *   6. časť stavu sa nedá prečítať → nevieme,
 *   7. inak v poriadku.
 *
 * Vetvy 5 a 6 stoja ZA prekážkami zámerne: keď appka vie povedať konkrétny
 * dôvod, je to užitočnejšie než priznanie medzery. Ale stoja PRED „v poriadku",
 * lebo nedočítaný stav sa nesmie vydávať za dobrú správu.
 */
export function overviewVerdict(input: VerdictInput): Verdict {
  const { status, progress } = input;

  if (status === null) {
    return {
      kind: 'unknown',
      tone: 'idle',
      word: 'nevieme',
      headline: 'Stav appky nevieme',
      detail: 'Appka neodpovedala na otázku, v akom je stave.',
    };
  }

  const rows = screenBlockers(status.blockers);
  const stopping = rows.filter((row) => row.severity === 'blokuje');
  const slowing = rows.filter((row) => row.severity === 'obmedzuje');
  const locked = status.writes.locked === true;

  if (locked) {
    // Runaway zámok je jediný stav Prehľadu, ktorý si červenú naozaj zaslúži:
    // zápis sa zastavil UPROSTRED behu a sám sa nerozbehne (architektúra §4).
    return {
      kind: 'stopped',
      tone: 'bad',
      word: 'zamknuté poistkou',
      headline: 'Zápisy zastavila poistka',
      detail: 'Appka nezapíše nič, kým je zámok v Nastaveniach zapnutý.',
    };
  }

  if (stopping.length > 0) {
    // Bod 7 kontraktu: keď sa na všetko len čaká, verdikt je pokojný, hoci
    // zastavuje. Vyčerpaný denný rozpočet je presne taký prípad (K2).
    const waitingOnly = stopping.every((row) => row.resolution === 'cakanie');
    return {
      kind: 'stopped',
      tone: waitingOnly ? 'idle' : 'warn',
      word: waitingOnly ? 'čaká sa' : 'zápis neprejde',
      headline: waitingOnly ? 'Zápis čaká' : 'Zápis stojí',
      detail: countSentence(stopping.length, 'zastavuje'),
    };
  }

  if (progress.mode === 'paused') {
    return {
      kind: 'stopped',
      tone: 'warn',
      word: 'fronta stojí',
      headline: 'Fronta stojí',
      detail:
        progress.pausedSince === null
          ? 'Zápis sa sám nerozbehne, čaká na potvrdenie.'
          : `Zastavené ${formatDateTimeSk(progress.pausedSince)}, sama sa nerozbehne.`,
    };
  }

  if (slowing.length > 0) {
    const waitingOnly = slowing.every((row) => row.resolution === 'cakanie');
    return {
      kind: 'slowed',
      tone: waitingOnly ? 'idle' : 'warn',
      word: waitingOnly ? 'čaká sa' : 'zapisuje sa pomalšie',
      headline: 'Zapisuje sa pomalšie',
      detail: countSentence(slowing.length, 'spomaľuje'),
    };
  }

  if (progress.mode === 'unknown') {
    return {
      kind: 'unknown',
      tone: 'idle',
      word: 'nevieme',
      headline: 'Stav fronty nevieme',
      detail: 'Appka neodpovedala na otázku, čo sa práve zapisuje.',
    };
  }

  if (unreadableSentence(status.unreadable) !== null) {
    return {
      kind: 'unknown',
      tone: 'idle',
      word: 'nevieme celý stav',
      headline: 'Časť stavu nevieme',
      detail: 'Kým sa nedá prečítať všetko, appka netvrdí, že je všetko v poriadku.',
    };
  }

  return {
    kind: 'ok',
    tone: 'ok',
    word: 'v poriadku',
    headline: 'Všetko v poriadku',
    detail: 'Nič nezastavuje ani nebrzdí zápis.',
  };
}
