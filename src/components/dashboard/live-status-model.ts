/**
 * Aura Zľavy — ČISTÉ ROZHODOVANIE ŽIVÉHO STAVU (V9; kontrakt dokončenia C1–C3).
 *
 * Prehľad má odpovedať na otázku „je všetko v poriadku?" do troch sekúnd a na
 * otázku „prečo sa nič nedeje?" bez otvorenia logu. Obe odpovede sú TVRDENIA
 * o produkčnom eshope, takže sa musia dať overiť bez prehliadača — presne ako
 * `overview-model.ts` pri fronte. Tento modul preto berie surové pohľady zo
 * `status-api.ts` a vracia hotové rozhodnutie; komponenty ho už len kreslia.
 *
 * ČO SA V TOMTO MODULE NESMIE POKAZIŤ
 * -----------------------------------
 *
 * 1. **Stav nikdy nie je len farba.** Každý riadok aj každá pilulka nesú tón,
 *    GLYF a SLOVO. Glyf a slovo pridáva `globals.css` (`.sig`) alebo primitív
 *    (`StatusPill`, `BudgetMeter`); tento modul dodáva tón a slovo naraz, aby
 *    sa nemohli rozísť.
 * 2. **Farbu prekážky volí `resolution`, nie `severity`.** Je to pravidlo
 *    z hlavičky `lib/status/blockers.ts`: závažnosť hovorí, čo cez prekážku
 *    neprejde, ale používateľ sa pýta inú vec — či s tým má niečo robiť.
 *    Jantár preto znamená „je to na vás", sivá „čaká sa a netreba nič".
 *    Vyčerpaný denný rozpočet je `blokuje`, a napriek tomu je sivý (K2).
 * 3. **Vety prekážok sa tu NEPREPISUJÚ.** `what` a `nextStep` skladá server;
 *    tento modul im dáva len poradie, tón a slovo o spôsobe riešenia.
 * 4. **Neznáme sa priznáva.** Chýbajúci údaj nikdy nevedie k upokojujúcej
 *    vete: buď je tón `idle` so slovom „nevieme", alebo sa riadok nekreslí.
 *    Nula ani „asi je to v poriadku" sa nedopĺňajú (P7).
 * 5. **Vnútorný kód sa nikdy nedostane na povrch** (K10). Kódy nečitateľných
 *    sekcií prekladá `SECTION_WORD`; keby pribudla siedma sekcia bez prekladu,
 *    riadok o nej radšej vypadne, než by sa vypísal surový.
 *
 * Vlastník: V9.
 */
import type {
  BlockerResolutionCode,
  BlockerRow,
  CatalogCountsView,
  CatalogSyncView,
  KeyView,
  ScopeView,
  StatusSectionCode,
  StatusView,
  WritesView,
} from '@/components/dashboard/status-api';
import type { StatusTone } from '@/components/ui/ToneBadge';
import { formatResumeTime } from '@/components/layout/queue';
import { nextUtcDayReset } from '@/lib/shop/rate-limits';
import { formatDateTimeSk } from '@/lib/ui/format';
import { dayMonthSk, formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

/* ═══════════════════════ 1. Signálne značky (.sig) ════════════════════════ */

/**
 * Tón signálnej značky. Mená sú zhodné s triedami `.sig.*` v `globals.css`,
 * ktoré nesú aj glyf (`✓ ▲ ✕ ○ –`) — nová sada tried by znamenala druhý
 * slovník stavov na tej istej obrazovke.
 */
export type SigTone = 'ok' | 'warn' | 'bad' | 'idle' | 'lock';

/** Trieda značky pre `className`. Jediné miesto, kde sa `.sig` skladá. */
export function sigClass(tone: SigTone): string {
  return `sig ${tone}`;
}

/* ═══════════════════════ 2. Malé formátovacie pomôcky ═════════════════════ */

/**
 * `HH:MM` v miestnom čase, alebo `null`.
 *
 * `formatResumeTime()` z hlavičky vracia pri nečitateľnom vstupe náhradné
 * „02:00" — pre hlavičku je to prijateľné, pre prístrojovú dosku nie: vymyslený
 * čas je tvrdenie. Preto sa vstup najprv overí a až potom formátuje tou istou
 * funkciou, aby appka nemala dva rôzne tvary hodiny.
 */
export function clockSk(iso: string | null): string | null {
  if (iso === null) return null;
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return null;
  return formatResumeTime(iso);
}

/** ISO čas → `6. 9.`, alebo `null`. Odhad si značku `≈` pridáva až obrazovka. */
export function dayMonthOf(iso: string | null): string | null {
  if (iso === null || iso.length < 10) return null;
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return null;
  const label = dayMonthSk(iso.slice(0, 10));
  return label === '—' ? null : label;
}

/** `1` → „1 hodinu", `3` → „3 hodiny", `12` → „12 hodín" (akuzatív). */
export function hoursAccusativeSk(hours: number): string {
  return `${formatCountSk(hours)} ${pluralSk(hours, 'hodinu', 'hodiny', 'hodín')}`;
}

/**
 * Kedy sa obnoví denný rozpočet zápisov — HOTOVÁ fráza aj s predložkou, presne
 * ako ju čaká `BudgetMeter`.
 *
 * Hranicou je polnoc UTC (`nextUtcDayReset`, ten istý zdroj, z ktorého počíta
 * `blockers.ts`), ale hodina sa ukazuje v miestnom čase — v ňom žije používateľ
 * a v lete je to 02:00, v zime 01:00. Natvrdo napísané „o 02:00" by pol roka
 * klamalo o hodinu.
 */
export function budgetResetPhrase(now: Date): string | null {
  const clock = clockSk(nextUtcDayReset(now).toISOString());
  return clock === null ? null : `o ${clock}`;
}

/** Koľko celých hodín ešte platí kľúč. Záporné = už neplatí, `null` = nevieme. */
export function hoursLeft(expiresAt: string | null, now: Date): number | null {
  if (expiresAt === null) return null;
  const at = new Date(expiresAt);
  if (!Number.isFinite(at.getTime())) return null;
  return Math.floor((at.getTime() - now.getTime()) / 3_600_000);
}

/* ═══════════════════════ 3. Stavové pilulky (StatusPill) ══════════════════ */

export interface PillView {
  readonly tone: StatusTone;
  /** Názov stavu po slovensky. */
  readonly label: string;
  /** Doplnok pod stavom (čas). Nikdy nie kľúč ani jeho časť. */
  readonly detail: string | null;
}

/**
 * Od koľkých zostávajúcich hodín sa o platnosti kľúča hovorí nahlas. Zhoda
 * s `KEY_WARNING_HOURS` v `lib/status/blockers.ts` — pod pol dňa má zmysel kľúč
 * vymeniť skôr, než sa fronta zastaví uprostred noci.
 */
export const KEY_WARNING_HOURS = 12;

/**
 * Platnosť kľúča na zápis.
 *
 * Chýbajúci kľúč NIE JE červený: appka bez kľúča nezapisuje, čo je bezpečný
 * stav, nie porucha. Červená je v tejto appke vyhradená pre stratu dát
 * a zastavený zápis uprostred behu.
 */
export function keyPill(apiKey: KeyView, now: Date): PillView {
  if (apiKey.present === null) {
    return { tone: 'idle', label: 'Kľúč na zápis nevieme', detail: null };
  }
  if (!apiKey.present) {
    return { tone: 'attention', label: 'Kľúč na zápis chýba', detail: null };
  }

  const left = hoursLeft(apiKey.expiresAt, now);
  if (left === null) {
    return { tone: 'attention', label: 'Kľúč je vložený, platnosť nevieme', detail: null };
  }

  const stamp = formatDateTimeSk(apiKey.expiresAt);
  if (left < 0) return { tone: 'attention', label: 'Kľúč na zápis skončil', detail: stamp };
  return {
    tone: left < KEY_WARNING_HOURS ? 'attention' : 'good',
    label: `Kľúč platí ešte ${hoursAccusativeSk(left)}`,
    detail: stamp,
  };
}

/**
 * Spojenie so shopom.
 *
 * Dôkazom spojenia je posledné ÚSPEŠNÉ čítanie katalógu — appka si kvôli
 * prístrojovej doske do shopu nevolá (to by míňalo rozpočet čítaní), takže
 * hovorí len to, čo naozaj vie. Doména sa tu zámerne NEOPAKUJE: je nad každou
 * obrazovkou v trvalom pruhu „PRODUKCIA — doména" a druhá kópia by bola len
 * ďalšie miesto, ktoré sa môže rozísť.
 */
export function shopPill(sync: CatalogSyncView | null): PillView {
  if (sync === null) {
    return { tone: 'idle', label: 'Spojenie so shopom nevieme', detail: null };
  }
  if (sync.failedLastTime || sync.waiting === 'error') {
    return {
      tone: 'attention',
      label: 'Shop naposledy neodpovedal',
      detail: sync.lastReadAt === null ? null : formatDateTimeSk(sync.lastReadAt),
    };
  }
  if (sync.lastReadAt === null) {
    return { tone: 'idle', label: 'Zo shopu sme ešte nečítali', detail: null };
  }
  return {
    tone: 'good',
    label: 'Spojené so shopom',
    detail: formatDateTimeSk(sync.lastReadAt),
  };
}

/* ═══════════════════════ 4. Meracie prúžky (BudgetMeter) ══════════════════ */

export interface MeterView {
  readonly spent: number;
  readonly limit: number;
}

/**
 * Prúžok naplnenia katalógu — `null`, keď sa kresliť nemá.
 *
 * Nekreslí sa v dvoch prípadoch a oba sú vedomé: keď čísla nepoznáme (prúžok by
 * musel niečo tvrdiť) a keď je katalóg NAČÍTANÝ CELÝ. Pri plnom katalógu by
 * `BudgetMeter` napísal „strop vyčerpaný" — čo je pri rozpočte pravda, ale pri
 * katalógu presný opak toho, čo sa stalo. Hotový katalóg preto hlási riadok
 * `catalogActivity()` slovom, nie prúžkom.
 */
export function catalogMeter(
  sync: CatalogSyncView | null,
  counts: CatalogCountsView | null,
): MeterView | null {
  const loaded = sync?.loadedProducts ?? counts?.loadedProducts ?? null;
  const total = sync?.shopTotalProducts ?? counts?.shopTotalProducts ?? null;
  if (loaded === null || total === null || total <= 0) return null;
  if (sync?.complete === true || loaded >= total) return null;
  return { spent: loaded, limit: total };
}

/* ═══════════════════════ 5. Riadky „čo appka práve robí" ══════════════════ */

/** Jeden riadok živého stavu: značka, veta a prípadná cesta ďalej. */
export interface ActivityLine {
  /** Stabilný kľúč riadku — na povrch sa nikdy nevypisuje. */
  readonly id: 'zapisy' | 'rozsah' | 'katalog';
  /** Čo sa popisuje — jedno slovo v ľavom stĺpci. */
  readonly label: string;
  readonly tone: SigTone;
  /** Stav jedným slovom, vedľa glyfu. */
  readonly word: string;
  /** Veta s číslami. Krátka — riadok nie je odstavec. */
  readonly text: string;
  /** Kam to vedie; `null` = riadok nemá čo ponúknuť. */
  readonly path: string | null;
}

/** Poistky zápisu (I13 + runaway zámok). Prvý riadok — bez nich sa nezapíše nič. */
export function writesActivity(writes: WritesView): ActivityLine {
  const base = { id: 'zapisy', label: 'Ostré zápisy' } as const;

  // Runaway zámok je zastavený zápis uprostred behu — jediný stav tejto sekcie,
  // ktorý si červenú naozaj zaslúži (architektúra §4).
  if (writes.locked === true) {
    return {
      ...base,
      tone: 'bad',
      word: 'zamknuté poistkou',
      text: 'Appka nezapíše nič, kým zámok neuvoľníte v Nastaveniach.',
      path: '/nastavenia',
    };
  }
  if (writes.enabled === null) {
    return {
      ...base,
      tone: 'idle',
      word: 'nevieme',
      text: 'Či má appka ostrý zápis zapnutý, sa nepodarilo zistiť.',
      path: null,
    };
  }
  if (!writes.enabled) {
    return {
      ...base,
      tone: 'idle',
      word: 'vypnuté',
      text: 'Zľavy sa pripravia, ale do shopu z nich neodíde ani jedna.',
      path: null,
    };
  }
  return {
    ...base,
    tone: 'ok',
    word: 'zapnuté',
    text: 'Potvrdená zľava ide do shopu naostro.',
    path: null,
  };
}

/**
 * Režim rozsahu (K1).
 *
 * Riadok stojí na obrazovke aj vtedy, keď nič nebrzdí — je to funkcia, ktorú
 * používateľ podľa vlastných slov nevie nájsť, a strop desiatich produktov je
 * pritom len prepínač v Nastaveniach. Zámok pri pilotnom režime hovorí, že cesta
 * existuje a čo si vyžiada.
 */
export function scopeActivity(scope: ScopeView): ActivityLine {
  const base = { id: 'rozsah', label: 'Rozsah zľavy' } as const;
  const cap =
    scope.maxProducts === null
      ? null
      : `${formatCountSk(scope.maxProducts)} ${pluralSk(scope.maxProducts, 'produkt', 'produkty', 'produktov')}`;

  if (scope.pilot === null) {
    return {
      ...base,
      tone: 'idle',
      word: 'nevieme',
      text: 'Nastavenie sa nepodarilo prečítať, platí najprísnejší pilotný strop.',
      path: '/nastavenia',
    };
  }
  if (scope.pilot) {
    return {
      ...base,
      tone: 'lock',
      word: 'pilotný',
      text:
        cap === null
          ? 'Pilotný strop platí; zdvihnúť ho môžete v Nastaveniach heslom.'
          : `Na jednu zľavu prejde ${cap}. Vyšší strop sa odomyká heslom.`,
      path: '/nastavenia',
    };
  }
  return {
    ...base,
    tone: 'ok',
    word: 'plný',
    text: cap === null ? 'Strop jednej zľavy platí podľa Nastavení.' : `Na jednu zľavu prejde ${cap}.`,
    path: '/nastavenia',
  };
}

/**
 * Synchronizácia katalógu (A5).
 *
 * Katalóg je jediná vec, ktorá v tejto appke beží dni — a jediná, o ktorej
 * používateľ doteraz nevedel, či sa vôbec hýbe. Riadok preto vždy povie tri
 * veci: kde je, prečo prípadne stojí a dokedy to potrvá.
 */
export function catalogActivity(
  sync: CatalogSyncView | null,
  counts: CatalogCountsView | null,
): ActivityLine {
  const base = { id: 'katalog', label: 'Katalóg' } as const;
  const loaded = sync?.loadedProducts ?? counts?.loadedProducts ?? null;
  const total = sync?.shopTotalProducts ?? counts?.shopTotalProducts ?? null;

  if (sync === null && loaded === null) {
    return {
      ...base,
      tone: 'idle',
      word: 'nevieme',
      text: 'Stav katalógu sa nepodarilo prečítať.',
      path: '/produkty',
    };
  }

  const done = loaded === null ? null : formatCountSk(loaded);
  const all = total === null ? null : formatCountSk(total);
  /**
   * PRÁZDNY KATALÓG NIE JE DOKONČENÝ KATALÓG. Kým sa nič neprečítalo, je
   * `loaded` aj `total` nula a holé `loaded >= total` z toho spraví „načítaný
   * celý" — appka by tvrdila, že má všetkých 41 082 produktov, a pritom nemá
   * ani jeden. Odvodený záver preto vyžaduje, aby sa naozaj niečo načítalo;
   * `sync.complete` je meraný fakt zo `catalog_sync_state`, ale ani ten
   * neplatí nad prázdnou tabuľkou.
   */
  const somethingLoaded = loaded !== null && loaded > 0;
  const complete =
    somethingLoaded &&
    (sync?.complete === true || (total !== null && total > 0 && loaded >= total));

  if (complete) {
    // OBNOVA SA MUSÍ PRIZNAŤ. Po každom dokončenom prechode beží nový a ten
    // začína od stránky 0 — appka teda číta shop pri „hotovom" katalógu. Kým to
    // riadok nepovedal, javilo sa to ako záhada a karta v Produktoch to vedľa
    // toho vydávala za „382 stránok ostáva, ešte 2 dni" (pokrok prechodu nie je
    // chýbajúci katalóg).
    const refreshing = sync?.refreshing === true;
    const whole = done === null ? 'Katalóg je načítaný celý.' : `Načítaných je všetkých ${done}.`;
    return {
      ...base,
      tone: 'ok',
      word: 'načítaný celý',
      text: refreshing ? `${whole} Appka ho na pozadí obnovuje, aby ceny boli čerstvé.` : whole,
      path: '/produkty',
    };
  }

  const where = done === null ? '' : all === null ? `Načítaných ${done}. ` : `Načítaných ${done} z ${all}. `;
  const finish = dayMonthOf(sync?.estimatedFinishAt ?? null);
  const nextBatch = clockSk(sync?.nextBatchAt ?? null);

  // Nula načítaných je vlastný stav, nie „dočítava sa" s tónom v poriadku:
  // z prázdneho katalógu sa nedá vybrať ani jeden produkt, takže to nie je
  // pokoj. Zhoduje sa to aj s pruhom nad obrazovkou, ktorý hlási „Katalóg
  // prázdny" — dve miesta nesmú o tom istom hovoriť rozdielne.
  if (loaded === 0) {
    return {
      ...base,
      tone: 'warn',
      word: 'prázdny',
      text:
        nextBatch === null
          ? 'Zatiaľ nie je načítaný ani jeden produkt. Bez katalógu sa nedá vybrať, čo zlacniť.'
          : `Zatiaľ nie je načítaný ani jeden produkt. Prvá dávka o ${nextBatch}.`,
      path: '/produkty',
    };
  }

  if (sync?.waiting === 'error') {
    return {
      ...base,
      tone: 'warn',
      word: 'čítanie neprešlo',
      text: `${where}Appka to skúsi znova sama.`,
      path: '/produkty',
    };
  }
  if (sync?.waiting === 'daily_budget') {
    return {
      ...base,
      tone: 'idle',
      word: 'čaká na rozpočet',
      text: `${where}Dnešný rozpočet čítaní je vyčerpaný, pokračuje po polnoci.`,
      path: '/produkty',
    };
  }
  if (sync?.waiting === 'rate_limited') {
    return {
      ...base,
      tone: 'idle',
      word: 'prestávka od shopu',
      text: nextBatch === null ? `${where}Appka počká a pokračuje sama.` : `${where}Pokračuje o ${nextBatch}.`,
      path: '/produkty',
    };
  }

  const tail =
    finish !== null
      ? `Hotové ≈ ${finish}.`
      : nextBatch !== null
        ? `Ďalšia dávka o ${nextBatch}.`
        : 'Dočítava sa po dávkach.';
  return { ...base, tone: 'ok', word: 'dočítava sa', text: `${where}${tail}`, path: '/produkty' };
}

/* ═══════════════════════ 6. Posledný krok fronty ══════════════════════════ */

export interface HeartbeatView {
  readonly lastTickAt: string | null;
  readonly stale: boolean;
}

export interface HeartbeatSummary {
  readonly tone: SigTone;
  readonly word: string;
  /** Meraný fakt, nikdy odhad. */
  readonly detail: string;
}

/**
 * Či appka frontu vôbec kontroluje.
 *
 * `stale` je FAKT z databázy (posledný krok fronty chýba dlhšie než povolené
 * okno) a je to jediná vec, ktorá odlíši „nič sa nezapisuje, lebo netreba" od
 * „nič sa nezapisuje, lebo appka nežije". Fail-closed: bez údaja platí to horšie.
 */
export function heartbeatSummary(heartbeat: HeartbeatView | null): HeartbeatSummary {
  const stale = heartbeat === null ? true : heartbeat.stale;
  const at = heartbeat?.lastTickAt ?? null;
  const detail = at === null ? 'posledný krok fronty nepoznáme' : `posledný krok ${formatDateTimeSk(at)}`;
  return {
    tone: stale ? 'warn' : 'ok',
    word: stale ? 'appka frontu nekontroluje' : 'appka kontroluje frontu',
    detail,
  };
}

/* ═══════════════════════ 7. Prekážky na obrazovke ═════════════════════════ */

export interface ResolutionLook {
  readonly tone: SigTone;
  /** Slovo o tom, kto to vyrieši. Stojí vedľa glyfu, nikdy namiesto neho. */
  readonly word: string;
}

/**
 * Farba a slovo podľa SPÔSOBU RIEŠENIA, nie podľa závažnosti.
 *
 * Používateľ sa nepýta „aké je to vážne", ale „mám s tým niečo robiť". Jantár
 * preto znamená „je to na vás", sivá „čaká sa a netreba nič" a zámok „cesta
 * existuje, ale vypýta si heslo".
 */
export const RESOLUTION_LOOK: Readonly<Record<BlockerResolutionCode, ResolutionLook>> = {
  sam: { tone: 'warn', word: 'vyriešite v appke' },
  sudo: { tone: 'lock', word: 'vyžiada si heslo' },
  cakanie: { tone: 'idle', word: 'čaká sa, netreba nič' },
  mimo_appky: { tone: 'warn', word: 'rieši sa mimo appky' },
};

/** Prekážka, ktorej spôsob riešenia appka nepozná — nič si o ňom nedomýšľa. */
export const UNKNOWN_RESOLUTION_LOOK: ResolutionLook = {
  tone: 'warn',
  word: 'treba sa na to pozrieť',
};

export function resolutionLook(resolution: BlockerResolutionCode | null): ResolutionLook {
  return resolution === null ? UNKNOWN_RESOLUTION_LOOK : RESOLUTION_LOOK[resolution];
}

/**
 * Prekážky, ktoré patria na Prehľad.
 *
 * `informuje` sa zo zoznamu vynecháva: trvalé pravidlá appky (napr. platný
 * strop rozsahu) majú svoje miesto v živom stave, nie v zozname dôvodov, prečo
 * sa nič nedeje. Poradie zo servera sa NEMENÍ — je súčasťou správania
 * `blockers.ts` a má vlastný test.
 */
export function screenBlockers(blockers: readonly BlockerRow[]): readonly BlockerRow[] {
  return blockers.filter((row) => row.severity !== 'informuje');
}

/** Popis cesty, kam prekážka vedie. Neznáma cesta dostane neutrálne sloveso. */
export function pathLabel(path: string): string {
  if (path === '/nastavenia') return 'Nastavenia';
  if (path === '/produkty') return 'Produkty';
  if (path === '/zlavy') return 'Zľavy';
  if (path === '/zlavy/nova') return 'Nová zľava';
  return 'Otvoriť';
}

/* ═══════════════════════ 8. Priznané medzery ══════════════════════════════ */

/** Kód sekcie stavu → slovenské pomenovanie. Bez neho by na povrch šiel kód. */
export const SECTION_WORD: Readonly<Record<StatusSectionCode, string>> = {
  writes: 'poistky zápisu',
  apiKey: 'kľúč na zápis',
  writeBudget: 'rozpočet zápisov',
  scope: 'rozsah zľavy',
  catalog: 'katalóg',
  catalogReads: 'rozpočet čítaní',
};

/**
 * Veta o tom, čo sa nepodarilo prečítať — alebo `null`, keď sedí všetko.
 *
 * Appka radšej prizná medzeru, než by o nej mlčala: práve pri chybe databázy
 * vyzerá prístrojová doska najpokojnejšie a to je presne ten moment, keď klame.
 */
export function unreadableSentence(sections: readonly StatusSectionCode[]): string | null {
  const words = sections.map((code) => SECTION_WORD[code]).filter((word) => word !== undefined);
  if (words.length === 0) return null;
  return `Toto sa teraz nedá prečítať: ${words.join(', ')}. Čísla o tom appka nedopĺňa.`;
}

/* ═══════════════════════ 9. Zhrnutie pre hlavičku sekcie ══════════════════ */

export interface LiveStatusView {
  readonly shop: PillView;
  readonly key: PillView;
  readonly writeBudget: MeterView | null;
  /** Kedy sa denný rozpočet obnoví — hotová fráza pre prúžok. */
  readonly budgetResetsAt: string | null;
  readonly catalogFill: MeterView | null;
  readonly lines: readonly ActivityLine[];
  readonly heartbeat: HeartbeatSummary;
  /** Veta o nečitateľných sekciách; `null` = všetko sa prečítalo. */
  readonly gap: string | null;
}

/**
 * Celý živý stav jedným výpočtom. Komponent potom nerozhoduje o ničom — len
 * kreslí, čo mu tu vyšlo.
 */
export function liveStatusView(input: {
  status: StatusView | null;
  sync: CatalogSyncView | null;
  heartbeat: HeartbeatView | null;
  now: Date;
}): LiveStatusView {
  const { status, sync, heartbeat, now } = input;

  return {
    shop: shopPill(sync),
    key: keyPill(status?.apiKey ?? { present: null, expiresAt: null }, now),
    writeBudget:
      status === null || status.writeBudget === null
        ? null
        : { spent: status.writeBudget.spent, limit: status.writeBudget.budget },
    budgetResetsAt: budgetResetPhrase(now),
    catalogFill: catalogMeter(sync, status?.catalog ?? null),
    lines: [
      writesActivity(status?.writes ?? { enabled: null, locked: null }),
      scopeActivity(status?.scope ?? { pilot: null, maxProducts: null }),
      catalogActivity(sync, status?.catalog ?? null),
    ],
    heartbeat: heartbeatSummary(heartbeat),
    gap:
      status === null
        ? 'Stav appky sa nepodarilo prečítať. Čísla preto nedopĺňame.'
        : unreadableSentence(status.unreadable),
  };
}
