/**
 * Aura Zľavy — SLOVNÍK POVRCHU (V3; kontrakt K10, architektúra §4).
 *
 * JEDINÉ miesto, ktoré prekladá vnútorné kódy na slovenské vety. Obrazovka
 * nikdy nepíše stav ani kód vlastnými slovami — vždy sa pýta tohto modulu.
 * Dôvod je testovateľný, nie estetický: keď je preklad na jednom mieste,
 * `test/unit/vocabulary.spec.ts` dokáže naraz overiť, že sa žargón nevrátil.
 *
 * Čo je na povrchu povolené (architektúra §4):
 *
 *   Stav zľavy má PRESNE štyri slová — `pripravená`, `zapisuje sa`, `beží`,
 *   `skončila`. Všetko ostatné (chýbajúci kľúč, zlyhania, pozastavenie,
 *   vyčerpaný rozpočet, meškanie) je **príznak za bodkou**, nie stav:
 *
 *       zapisuje sa · 12 sa nepodarilo
 *       zapisuje sa · chýba kľúč na zápis
 *       beží · zmenené v admine?
 *
 *   Príznak NIKDY nemení stav ani jeho farbu a NIKDY nie je červený — červená
 *   je vyhradená pre stratu dát a zastavený zápis (`critical`).
 *
 * Čo je zakázané (K10, P3): `needs_key`, dry-run, allowlist, `setReduction`,
 * HTTP kódy, názvy tabuliek, kódy invariantov (I3, D28, K10), camelCase a
 * snake_case kódy. Tento modul je jediný v `src/`, ktorý vnútorné kódy pozná
 * ako KĽÚČE — na výstupe z neho nesmie ostať ani jeden.
 *
 * Modul je čistý: žiadna DB, žiadna sieť, žiadne `process.env`, žiadne
 * vyhodnocovanie na module scope. Bezpečný pre server aj client komponenty.
 *
 * Vlastník: V3.
 */
import type { CampaignMode, CampaignStatus, DateOnly, ItemStatus } from '@/contracts';
import { LOGIC_TIME_ZONE, isAfter, isBefore, isDateOnly, todayInZone } from '@/lib/domain/dates';
import { formatDateSk } from '@/lib/ui/format';

/* ════════════════════════ 1. Slová, ktoré smieme povedať ═══════════════════ */

/** Presne štyri stavové slová povrchu (§4). Piate neexistuje. */
export const SURFACE_STATES = ['pripravená', 'zapisuje sa', 'beží', 'skončila'] as const;

export type SurfaceState = (typeof SURFACE_STATES)[number];

/** Tón stavu — sivá / teal / zlatá / prázdna bodka (§4). */
export type StateTone = 'idle' | 'progress' | 'live' | 'done';

/**
 * Tón príznaku. `critical` je vyhradený pre stratu dát a zastavený zápis;
 * bežné zlyhanie položiek je `attention` (jantárová), vyčerpaný rozpočet je
 * `neutral` — je to informácia, nie chyba (K2, odpoveď 59).
 */
export type FlagTone = 'good' | 'neutral' | 'attention' | 'critical';

export const STATE_TONES: Readonly<Record<SurfaceState, StateTone>> = {
  'pripravená': 'idle',
  'zapisuje sa': 'progress',
  'beží': 'live',
  'skončila': 'done',
};

/**
 * Preklad pojmov z tabuľky K10. Slúži aj ako slovník pre texty, ktoré nie sú
 * stavom (nadpisy, tlačidlá, vysvetlivky) — obrazovka si ich nevymýšľa.
 */
export const SURFACE_TERMS = {
  campaign: 'zľava',
  campaignPlural: 'zľavy',
  allowlist: 'povolené produkty',
  dryRun: 'skúška naprázdno',
  keyMissing: 'chýba kľúč na zápis',
  modeEager: 'zapisuje sa hneď',
  modeScheduled: 'zapisuje sa dopredu',
  itemFailed: 'nepodarilo sa',
  queue: 'fronta',
  writeBudget: 'rozpočet zápisov',
  catalog: 'katalóg',
  technicalDetail: 'Technický detail',
  lockedFeature: 'Čaká na dáta zo shopu',
} as const satisfies Readonly<Record<string, string>>;

/* ═════════════════════════ 2. Slovenské tvary čísel ═══════════════════════ */

/**
 * Slovenská zhoda po číslovke (CLDR `sk`): 1 → `one`, presne 2–4 → `few`,
 * všetko ostatné vrátane 0 a 22 → `many`. („22 produktov", nie „22 produkty".)
 */
export function pluralSk(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one;
  if (count >= 2 && count <= 4) return few;
  return many;
}

/** `3420` → `3 420`. Tisícky oddelené medzerou, nikdy bodkou ani čiarkou. */
export function formatCountSk(count: number): string {
  if (!Number.isFinite(count)) return '—';
  return Math.trunc(count)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}


/* ═══════════════════════ 3. Stavy zľavy (kampane) ═════════════════════════ */

/**
 * Vnútorné kódy stavu zľavy. `queued` je nový stav fronty (K2); zvyšok je
 * pôvodný životný cyklus. Tento modul ich pozná, obrazovka nie.
 */
export const CAMPAIGN_STATUS_CODES = [
  'draft',
  'scheduled',
  'queued',
  'needs_key',
  'running',
  'done',
  'partial',
  'failed',
  'missed',
  'cancelled',
  'lapsed',
] as const satisfies readonly CampaignStatusCode[];

export type CampaignStatusCode = CampaignStatus | 'queued';

/** Pozná slovník tento kód? Jediná otázka, na ktorú sa dá odpovedať bez hádania. */
export function isCampaignStatusCode(status: string): status is CampaignStatusCode {
  return (CAMPAIGN_STATUS_CODES as readonly string[]).includes(status);
}

/**
 * Kód stavu odkiaľkoľvek (API, databáza, shop) → kód, ktorý slovník pozná.
 *
 * ŽIJE TU, A NIE NA OBRAZOVKE. Do 24. 8. 2026 stála táto funkcia v modeli
 * Prehľadu a zoznam zliav si ju odtiaľ importoval — krížny import medzi dvomi
 * obrazovkami len preto, aby nevznikla druhá kópia. Kód stavu prekladá slovník;
 * on jediný vie, ktoré kódy pozná, takže jedine tu sa dá zaručiť, že sa zoznam
 * povolených kódov a prevod nikdy nerozídu.
 *
 * Fail-closed náhrada je `draft`, teda najpasívnejšie možné tvrdenie
 * („pripravená") — appka radšej podcení, čo sa deje, než aby tvrdila, že sa
 * niekde zapisuje. Náhrada NIE JE tichá: `campaignSentence()` ju priznáva
 * príznakom `UNKNOWN_STATUS_FLAG`.
 */
export function toStatusCode(status: string): CampaignStatusCode {
  return isCampaignStatusCode(status) ? status : 'draft';
}

/** Príznak = text za bodkou. Nikdy nestojí sám, vždy až za stavom (§4). */
export interface SurfaceFlag {
  readonly text: string;
  readonly tone: FlagTone;
}

/**
 * Príznak pre kód stavu, ktorý appka nepozná.
 *
 * Slovník preň vetu nemá a nemôže mať — nepozná ho ani on. Namiesto mlčania
 * povie, že sa treba pozrieť: tón je jantárový, nie červený (netvrdíme poruchu)
 * a nie sivý (netvrdíme pokoj). Vnútorný kód sa do textu NEDÁVA (K10).
 */
export const UNKNOWN_STATUS_FLAG: SurfaceFlag = {
  text: 'tento stav nepoznáme',
  tone: 'attention',
};

export interface CampaignSentence {
  readonly state: SurfaceState;
  readonly tone: StateTone;
  readonly flags: readonly SurfaceFlag[];
  /** Celá veta v gramatike `stav · príznak · príznak`. */
  readonly text: string;
}

/**
 * Stav → slovo, keď o zľave nevieme nič iné než kód.
 *
 * `needs_key` je zámerne `pripravená`, nie `zapisuje sa`: keď appka nemá kľúč,
 * nič sa nezapisuje a tvrdiť opak by bolo klamstvo. Ak už fronta časť zapísala,
 * `campaignSentence()` slovo povýši na `zapisuje sa` podľa `itemsWritten`.
 *
 * `done`/`partial` bez dátumov vracia `beží`; skutočné slovo určí až okno
 * platnosti — preto `campaignSentence()` dátumy pýta.
 */
export const CAMPAIGN_STATE: Readonly<Record<CampaignStatusCode, SurfaceState>> = {
  draft: 'pripravená',
  scheduled: 'pripravená',
  queued: 'zapisuje sa',
  needs_key: 'pripravená',
  running: 'zapisuje sa',
  done: 'beží',
  partial: 'beží',
  failed: 'skončila',
  missed: 'pripravená',
  cancelled: 'skončila',
  lapsed: 'skončila',
};

/** Príznak, ktorý k stavu patrí vždy (§4). Stavy bez príznaku tu nie sú. */
export const CAMPAIGN_STATUS_FLAG: Readonly<Partial<Record<CampaignStatusCode, SurfaceFlag>>> = {
  needs_key: { text: SURFACE_TERMS.keyMissing, tone: 'attention' },
  missed: { text: 'zmeškaný štart', tone: 'attention' },
  failed: { text: 'nepodarilo sa zapísať nič', tone: 'attention' },
  cancelled: { text: 'zrušená', tone: 'neutral' },
  lapsed: { text: 'okno uplynulo, nezapísalo sa nič', tone: 'attention' },
};

/**
 * Všetko, čo o zľave vieme v momente vykreslenia. Voliteľné polia sú naozaj
 * voliteľné — obrazovka nikdy nemá dopočítavať, čo nemá.
 */
export interface CampaignVocabInput {
  /**
   * Kód stavu tak, ako prišiel — volajúci ho NEMUSÍ overovať a nemá.
   *
   * Typ je zámerne `string`, nie `CampaignStatusCode`: kód prichádza z databázy
   * a z odpovedí servera, kde ho typ nechráni, a `as CampaignStatusCode` na
   * strane volajúceho bola presne tá diera, ktorou sa `writing` dostal do
   * `CAMPAIGN_STATE` a zhodil obrazovku. Prevod robí slovník sám.
   */
  readonly status: string;
  /** Okno platnosti zľavy. Bez neho sa `done`/`partial` nedá rozlíšiť. */
  readonly dateFrom?: DateOnly | null;
  readonly dateTo?: DateOnly | null;
  /** Dnešok v Europe/Bratislava; default sa dopočíta cez zónu, nikdy v UTC. */
  readonly today?: DateOnly;
  /** Koľko položiek už fronta spracovala — rozhoduje o slove pri `needs_key`. */
  readonly itemsWritten?: number;
  /**
   * Koľko sa NEPODARILO. Volajúci sem dáva len položky po TREŤOM neúspešnom
   * pokuse (§4) — do tej doby sa príznak nezobrazuje.
   */
  readonly failedCount?: number;
  /** Fronta čaká na potvrdenie po odstávke počítača (odpoveď 46). */
  readonly paused?: boolean;
  /** Dnešný rozpočet zápisov je vyčerpaný — informácia, nie chyba (K2). */
  readonly budgetExhausted?: boolean;
  /** Časť produktov nabehla po štarte okna (K5). */
  readonly lateCount?: number | null;
  /** Automatický posun štartu pri sklze (odpoveď 63). */
  readonly startShiftedTo?: DateOnly | null;
  /** Appka nevie zistiť cudziu zmenu v administrácii shopu (odpoveď 81). */
  readonly adminChanged?: boolean;
  /** Zápis je zastavený (jediný dôvod na červenú okrem straty dát). */
  readonly writesStopped?: boolean;
}

/** Dnešok v doménovej zóne (Europe/Bratislava) — nikdy v UTC. */
export function todayHere(now: Date = new Date()): DateOnly {
  return todayInZone(now, LOGIC_TIME_ZONE);
}

function stateFromWindow(
  dateFrom: DateOnly | null | undefined,
  dateTo: DateOnly | null | undefined,
  today: DateOnly,
): SurfaceState {
  if (isDateOnly(dateFrom) && isBefore(today, dateFrom)) return 'pripravená';
  if (isDateOnly(dateTo) && isAfter(today, dateTo)) return 'skončila';
  return 'beží';
}

/**
 * Zľava → jedna veta pre povrch. Toto je funkcia, ktorú obrazovky volajú;
 * `CAMPAIGN_STATE` je len jej surová tabuľka.
 *
 * NEZNÁMY KÓD RIEŠI SLOVNÍK, NIE VOLAJÚCI. `CAMPAIGN_STATE[neznámy]` je
 * `undefined` a odtiaľ vedie priama cesta k prázdnej obrazovke (tón `undefined`
 * → značka `undefined` → pád vykresľovača). Kód sa preto najprv prevedie
 * (`toStatusCode()`) a náhrada sa PRIZNÁ príznakom za bodkou:
 * `pripravená · tento stav nepoznáme`. Tichá náhrada by predstierala jeden zo
 * známych stavov.
 */
export function campaignSentence(input: CampaignVocabInput): CampaignSentence {
  const today = input.today !== undefined ? input.today : todayHere();

  const status = toStatusCode(input.status);
  const unknownStatus = status !== input.status;

  let state = CAMPAIGN_STATE[status];

  // Okno platnosti rozhoduje o slove len tam, kde je zľava dopísaná.
  if (status === 'done' || status === 'partial') {
    state = stateFromWindow(input.dateFrom, input.dateTo, today);
  }

  // Fronta, ktorá už niečo zapísala, sa NEVOLÁ „pripravená" ani keď stojí.
  const written = input.itemsWritten !== undefined ? input.itemsWritten : 0;
  if ((status === 'needs_key' || status === 'queued') && written > 0) {
    state = 'zapisuje sa';
  }

  const flags: SurfaceFlag[] = [];

  const statusFlag = CAMPAIGN_STATUS_FLAG[status];
  if (statusFlag !== undefined) flags.push(statusFlag);

  const failed = input.failedCount !== undefined && input.failedCount !== null ? input.failedCount : 0;
  if (failed > 0) {
    // Presné znenie z §4: `zapisuje sa · 12 sa nepodarilo` (bez slova „produktov" —
    // číslo a sloveso stačia a vyhnú sa zhode pádu).
    flags.push({ text: `${formatCountSk(failed)} sa nepodarilo`, tone: 'attention' });
  }

  if (input.writesStopped === true) flags.push({ text: 'zápis zastavený', tone: 'critical' });
  if (input.paused === true) flags.push({ text: 'pozastavené', tone: 'attention' });
  if (input.budgetExhausted === true) flags.push({ text: 'pokračujem zajtra', tone: 'neutral' });

  if (input.startShiftedTo !== undefined && input.startShiftedTo !== null) {
    flags.push({ text: `štart posunutý na ${formatDateSk(input.startShiftedTo)}`, tone: 'attention' });
  }

  const late = input.lateCount !== undefined && input.lateCount !== null ? input.lateCount : 0;
  if (late > 0) {
    flags.push({
      text: `${formatCountSk(late)} ${pluralSk(late, 'zlacnel', 'zlacneli', 'zlacnelo')} neskoro`,
      tone: 'attention',
    });
  }

  if (input.adminChanged === true) flags.push({ text: 'zmenené v admine?', tone: 'attention' });

  // Až celkom na konci: náhrada kódu je fakt o dátach, nie o zľave, a stojí
  // teda za všetkým, čo o zľave naozaj vieme.
  if (unknownStatus) flags.push(UNKNOWN_STATUS_FLAG);

  return {
    state,
    tone: STATE_TONES[state],
    flags,
    text: [state, ...flags.map((f) => f.text)].join(' · '),
  };
}

/** `eager`/`scheduled` → veta pre povrch (K10). */
export function campaignModeSentence(mode: CampaignMode): string {
  return mode === 'eager' ? SURFACE_TERMS.modeEager : SURFACE_TERMS.modeScheduled;
}

/* ═══════════════════════════ 4. Stavy položiek ════════════════════════════ */

export interface ItemSentence {
  /** Krátky tvar do stĺpca tabuľky. */
  readonly label: string;
  /** Celá veta s ľudským dôvodom — do rozkliku (§4, P6). */
  readonly reason: string;
  readonly tone: FlagTone;
}

/**
 * Stav položky → veta. Kód shopu ani HTTP status sem nepatria; tie žijú
 * o úroveň nižšie, v „Technickom detaile" (P6).
 */
export const ITEM_SENTENCES: Readonly<Record<ItemStatus, ItemSentence>> = {
  pending: {
    label: 'ešte sa nezapisovalo',
    reason: 'Fronta na tento produkt zatiaľ nedošla.',
    tone: 'neutral',
  },
  ok: {
    label: 'zlacnené',
    reason: 'Zľavu sme na produkt zapísali.',
    tone: 'good',
  },
  failed: {
    label: SURFACE_TERMS.itemFailed,
    reason: 'Shop neodpovedal ani po treťom pokuse.',
    tone: 'attention',
  },
  uncertain: {
    label: 'nevieme, či sa zapísalo',
    reason: 'Shop odpovedal inak, než sme čakali — nevieme potvrdiť, že zľava naozaj platí.',
    tone: 'attention',
  },
  not_found: {
    label: 'shop produkt nenašiel',
    reason: 'Shop produkt nenašiel — možno bol medzitým zmazaný.',
    tone: 'attention',
  },
  blocked: {
    label: 'appka zápis nepustila',
    reason: 'Produkt nie je medzi povolenými produktmi, tak sme doň nezapisovali.',
    tone: 'attention',
  },
  interrupted: {
    label: 'prerušené',
    reason: 'Zápis sa prerušil uprostred fronty. Produkt zostáva nezlacnený.',
    tone: 'attention',
  },
  skipped: {
    label: 'preskočené',
    reason: 'Rovnaká zľava tam už bola zapísaná, tak sme ju nepísali druhýkrát.',
    tone: 'neutral',
  },
};

/** Stav položky → veta; neznámy kód nikdy neprebliká na povrch surový. */
export function itemSentence(status: string): ItemSentence {
  const known = Object.prototype.hasOwnProperty.call(ITEM_SENTENCES, status)
    ? ITEM_SENTENCES[status as ItemStatus]
    : undefined;
  if (known !== undefined) return known;
  return {
    label: 'nevieme, či sa zapísalo',
    reason: 'Appka si nie je istá, ako tento produkt dopadol. Podrobnosti sú v Technickom detaile.',
    tone: 'attention',
  };
}

/* ═════════════════════════════ 5. Kódy guardov ════════════════════════════ */

/**
 * Kódy brány pred zápisom. Zoznam je zámerne SUPERMNOŽINA toho, čo dnes vracia
 * `src/lib/engine/guards.ts` — slovník nesmie prestať prekladať len preto, že
 * sa engine posunul o krok dopredu. Neznámy kód dostane neutrálnu vetu, NIKDY
 * sa nezobrazí surový (K10).
 */
export const GUARD_CODES_KNOWN = [
  'writes_disabled',
  'writes_locked',
  'runaway_limit',
  'budget_exhausted',
  'no_products',
  'too_many_products',
  'not_in_allowlist',
  'not_in_scope',
  'not_in_catalog',
  'percent_invalid',
  'invalid_dates',
  'range_too_long',
  'to_in_past',
  'midnight_freeze',
  'key_missing',
] as const;

export type GuardSentenceCode = (typeof GUARD_CODES_KNOWN)[number];

export interface GuardSentence {
  /** Čo sa stalo, jednou vetou. */
  readonly text: string;
  /** Čo s tým môže používateľ urobiť; `null`, keď nemá čo. */
  readonly hint: string | null;
  readonly tone: FlagTone;
}

export const GUARD_SENTENCES: Readonly<Record<GuardSentenceCode, GuardSentence>> = {
  writes_disabled: {
    text: 'Ostrý zápis je vypnutý — appka teraz do shopu nič nezapíše.',
    hint: 'Zapnúť ho môže len správca počítača.',
    tone: 'neutral',
  },
  writes_locked: {
    text: 'Zápisy sú zastavené.',
    hint: 'Odomknúť ich musíte ručne heslom v Nastaveniach.',
    tone: 'critical',
  },
  runaway_limit: {
    text: 'Appka zapisovala rýchlejšie, než je bezpečné, a sama sa zastavila.',
    hint: 'Skontrolujte, či nebežia dve zľavy naraz, a zápisy odomknite heslom.',
    tone: 'critical',
  },
  budget_exhausted: {
    text: 'Dnešný rozpočet zápisov je vyčerpaný.',
    hint: 'Fronta pokračuje sama zajtra ráno, nemusíte nič robiť.',
    tone: 'neutral',
  },
  no_products: {
    text: 'Nie je vybraný žiadny produkt.',
    hint: 'Vyberte aspoň jeden produkt.',
    tone: 'attention',
  },
  too_many_products: {
    text: 'Vybraných je viac produktov, než dovoľuje strop na jednu zľavu.',
    hint: 'Zúžte výber alebo strop zmeňte v Nastaveniach.',
    tone: 'attention',
  },
  not_in_allowlist: {
    text: 'Aspoň jeden produkt nie je medzi povolenými produktmi.',
    hint: 'Doplňte ho medzi povolené produkty alebo ho z výberu odoberte.',
    tone: 'attention',
  },
  not_in_scope: {
    text: 'Aspoň jeden produkt je mimo povoleného rozsahu.',
    hint: 'Zúžte výber alebo rozsah zmeňte v Nastaveniach.',
    tone: 'attention',
  },
  not_in_catalog: {
    text: 'Aspoň jeden produkt appka v katalógu nevidí.',
    hint: 'Načítajte katalóg znova a výber zopakujte.',
    tone: 'attention',
  },
  percent_invalid: {
    text: 'Zľava musí byť celé číslo od 1 do 30 percent.',
    hint: 'Opravte percento a skúste to znova.',
    tone: 'attention',
  },
  invalid_dates: {
    text: 'Okno zľavy nedáva zmysel — koniec nesmie byť pred začiatkom.',
    hint: 'Opravte dátumy.',
    tone: 'attention',
  },
  range_too_long: {
    text: 'Zľava môže trvať najviac tri mesiace.',
    hint: 'Skráťte okno alebo založte druhú zľavu.',
    tone: 'attention',
  },
  to_in_past: {
    text: 'Koniec zľavy je v minulosti.',
    hint: 'Posuňte koniec na dnešok alebo neskôr.',
    tone: 'attention',
  },
  midnight_freeze: {
    text: 'Je tesne po polnoci — appka chvíľu nezapisuje, aby si nepomýlila dni.',
    hint: 'Skúste to o minútu.',
    tone: 'neutral',
  },
  key_missing: {
    text: SURFACE_TERMS.keyMissing,
    hint: 'Vložte platný kľúč v Nastaveniach; fronta plynulo pokračuje.',
    tone: 'attention',
  },
};

/** Kód guardu → veta. Neznámy kód sa NIKDY nezobrazí surový (K10). */
export function guardSentence(code: string): GuardSentence {
  const known = Object.prototype.hasOwnProperty.call(GUARD_SENTENCES, code)
    ? GUARD_SENTENCES[code as GuardSentenceCode]
    : undefined;
  if (known !== undefined) return known;
  return {
    text: 'Appka zápis nepustila.',
    hint: 'Dôvod nájdete v Technickom detaile.',
    tone: 'attention',
  };
}

/* ════════════════════ 6. Fronta a rozpočet v hlavičke ═════════════════════ */

/**
 * `Zápisy 100/200 dnes`, po vyčerpaní `Zápisy 200/200 · pokračujem o 02:00`.
 * Vyčerpaný rozpočet je informácia, nie chyba — tón je `neutral` (K2).
 */
export function writeBudgetSentence(
  spent: number,
  budget: number,
  resumeAtLocalTime = '02:00',
): { readonly text: string; readonly tone: FlagTone } {
  const exhausted = spent >= budget;
  return {
    text: exhausted
      ? `Zápisy ${formatCountSk(spent)}/${formatCountSk(budget)} · pokračujem o ${resumeAtLocalTime}`
      : `Zápisy ${formatCountSk(spent)}/${formatCountSk(budget)} dnes`,
    tone: 'neutral',
  };
}

/** `Fronta 3 420/8 000`, prázdna fronta `Fronta prázdna`. */
export function queueSentence(done: number, total: number): string {
  if (total <= 0) return 'Fronta prázdna';
  return `Fronta ${formatCountSk(done)}/${formatCountSk(total)}`;
}

/**
 * Odhad dokončenia fronty. Odhad MUSÍ byť označený `≈` (P7) — meraný fakt
 * (napr. „Dáta k 10. 8. 03:00") značku NEMÁ.
 */
export function estimateSentence(finishDay: DateOnly): string {
  return `Hotové ≈ ${formatDateSk(finishDay)}`;
}
