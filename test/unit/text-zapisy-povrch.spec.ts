/**
 * Aura Zľavy — DĹŽKA TEXTU NA POVRCHU ZÁPISOV A ROZPOČTOV (B1, vlna 2, šprint 20).
 *
 * Vlna 2 sťahuje vysvetľujúce odstavce Nastavení pod rozklik (P6). Tento súbor
 * stráži výsledok v tých dvoch sekciách, ktoré niesli najdlhší text v celej
 * appke: `settings/WritesSection.tsx` a `settings/BudgetSection.tsx`.
 *
 * PREČO NAD VYKRESLENÝM MARKUPOM, A NIE GREPOM NA ZDROJ
 * ------------------------------------------------------
 * Grep na zdroj by meral zle v oboch smeroch. Veta poskladaná z dvoch riadkov
 * JSX (`'…' + '…'`) by sa v zdroji javila ako dve krátke, hoci používateľ vidí
 * jednu dlhú; a naopak — odstavec presunutý pod `<details>` by v zdroji zostal
 * rovnako dlhý, hoci na povrchu už nie je. Meria sa preto to, čo vidí človek:
 * vykreslené HTML, z ktorého sa najprv vyreže celý obsah `<details>`.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 *  A. **P2 — 90 znakov na jeden blok povrchu.** Blok je text jedného
 *     blokového uzla; `<b>`, `<a>` a spol. sú vnútri vety a vetu nedelia,
 *     lebo ju nedelia ani na obrazovke.
 *  B. **Text sa presunul, nezahodil.** Každý dôvod, ktorý zmizol z povrchu, sa
 *     musí dať nájsť pod rozklikom. Skrátenie, ktoré vysvetlenie zmaže, je
 *     horšie než dlhý odstavec — appka potom mlčí o tom, prečo nezapisuje.
 *  C. **Cudzie vety sa nemerajú.** Vety prekážok píše `lib/status/blockers.ts`
 *     a vetu o domnienke `settings/blockers-view.ts`; ani jeden z tých súborov
 *     B1 nevlastní. Zoznam výnimiek sa preto NEOPISUJE ručne — číta sa
 *     z toho istého kódu, ktorý vety vyrobil. Keď ich niekto skráti, test to
 *     ticho prijme; keď sa dlhá veta objaví v súbore B1, test padne.
 *  D. **Veta o vypnutých zápisoch zostáva celá.** Má 96 znakov, je to zapísaná
 *     výnimka z P2 (`design/v3/ARCHITEKTURA.md`) a jej koniec „nech je vo
 *     výbere čokoľvek" je dôvod, prečo veta existuje.
 *  E. **Po skrátení zostalo SLOVO.** Pravidlo vlny 2: v každom uzle `.sig`,
 *     `.flag`, `.state` a v každej dlaždici musí zostať text, nie len farba.
 *  F. **Poistka na poistku.** Keby sa vyrezávanie rozbilo a nenašlo NIČ,
 *     tvrdenie „všetko je pod 90" by svietilo zeleno nad prázdnym zoznamom.
 *     Počet blokov sa preto najprv tvrdí zdola.
 *
 * Renderuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna databáza,
 * žiadna sieť.
 *
 * Vlastník: B1, vlna 2 šprintu 20 (20. 8. 2026).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import BudgetSection from '@/components/settings/BudgetSection';
import WritesSection from '@/components/settings/WritesSection';
import { ASSUMED_NOTE } from '@/components/settings/blockers-view';
import {
  toStatusPayload,
  type StatusPayload,
  type StatusReading,
} from '@/lib/status/snapshot';
import type { StatusSnapshot } from '@/lib/status/blockers';
import type { CatalogView, QueueView, SettingsView } from '@/components/settings/api';

/** Strop P2 — `design/v3/ARCHITEKTURA.md`, riadok P2. */
const P2_LIMIT = 90;

/* ═══════════════════════════ vzorka ═══════════════════════════════════════ */

const NOW = new Date('2026-08-12T09:00:00.000Z');

const SETTINGS: SettingsView = {
  shopDomain: 'https://sperky-eshop.sk',
  domainConfirmedAt: '2026-08-10T09:12:00.000Z',
  eagerWriteDefault: true,
  writesLocked: false,
  writesLockedReason: null,
  onboardingDoneAt: null,
  scopeMode: 'pilot',
  maxProducts: 10,
  maxProductsPerCampaign: 10000,
  pilotMaxProducts: 10,
  scopeFailClosed: false,
  dailyWriteBudget: 200,
};

function statusFor(
  snapshot: Omit<StatusSnapshot, 'now'>,
  writeLock: StatusReading['writeLock'] = {
    writesLocked: false,
    writesLockedReason: null,
    writesLockedAt: null,
  },
): StatusPayload {
  return toStatusPayload({
    now: NOW,
    snapshot: { now: NOW, ...snapshot },
    unreadable: [],
    writeLock,
    effectiveMaxProducts: 10,
    catalogLastFetchedAt: null,
  });
}

/** Zápisy vypnuté — stav, v ktorom sa appka dodáva. */
const STATUS_OFF = statusFor({
  writes: { enabled: false },
  apiKey: { present: true, expiresAt: new Date('2026-08-13T09:12:00.000Z') },
  writeBudget: { budget: 200, spent: 120, day: '2026-08-12' },
  scope: { mode: 'pilot', maxProducts: 10000, failClosed: false },
});

/** Všetko pripravené — na povrchu je najkratšia možná podoba sekcie. */
const STATUS_READY = statusFor({
  writes: { enabled: true },
  apiKey: { present: true, expiresAt: new Date('2026-08-13T09:12:00.000Z') },
  writeBudget: { budget: 200, spent: 120, day: '2026-08-12' },
  scope: { mode: 'pilot', maxProducts: 10000, failClosed: false },
});

/** Poistka zasiahla — najdlhšie vety sekcie sú práve v tomto stave. */
const STATUS_LOCKED = statusFor(
  {
    writes: { enabled: true },
    apiKey: { present: false, expiresAt: null },
    writeBudget: { budget: 200, spent: 200, day: '2026-08-12' },
    scope: { mode: 'pilot', maxProducts: 10000, failClosed: false },
  },
  {
    writesLocked: true,
    writesLockedReason: 'appka zapisovala rýchlejšie, než je bezpečné',
    writesLockedAt: new Date('2026-08-12T08:00:00.000Z'),
  },
);

function queue(over: Partial<QueueView> = {}): QueueView {
  return {
    budget: { day: '2026-08-12', budget: 200, spent: 120, remaining: 80, exhausted: false },
    queue: { pending: 30, total: 150, done: 120, campaigns: 1 },
    estimate: { pending: 30, perDay: 200, days: 1, date: '2026-08-13' },
    heartbeat: { lastTickAt: '2026-08-12T08:59:00.000Z', staleMs: 60000, stale: true },
    limits: {
      shopPerUtcDay: 200,
      shopPerMinute: 20,
      configuredPerDay: 200,
      nextResetAt: '2026-08-13T00:00:00.000Z',
    },
    ...over,
  };
}

function catalog(over: Partial<CatalogView> = {}): CatalogView {
  return {
    loadedProducts: 2900,
    shopTotalProducts: 41082,
    percent: 7,
    complete: false,
    lastFetchedAt: '2026-08-12T08:00:00.000Z',
    nextBatchAt: '2026-08-12T09:30:00.000Z',
    estimatedDaysLeft: 2,
    estimatedFinishAt: '2026-08-14T00:00:00.000Z',
    reads: {
      day: '2026-08-12',
      limit: 240,
      used: 96,
      remaining: 144,
      exhausted: false,
      resetAt: '2026-08-13T00:00:00.000Z',
      minuteLimit: 24,
      usedThisMinute: 3,
      known: true,
    },
    ...over,
  };
}

/* ═════════════════════ vyrezávanie povrchu ════════════════════════════════ */

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
};

/**
 * Značky, ktoré stoja VNÚTRI vety a nedelia ju.
 *
 * `<span>` medzi nimi zámerne NIE JE: v tejto appke ho nesú bunky mriežky
 * `.kv` a druhé číslo dlaždice, čiže samostatné riadky obrazovky. Keby sa
 * `<span>` bral ako vnútrovetný, tri riadky mriežky by sa zliali do jedného
 * bloku s 200 znakmi a test by hlásil porušenie, ktoré na obrazovke nie je.
 */
const INLINE = /<\/?(?:b|strong|i|em|a|code|small|abbr|u|mark)\b[^>]*>/g;

/** Text jedného rozkliku a všetkého v ňom — to, čo P2 nemeria. */
const DETAILS = /<details\b[\s\S]*?<\/details>/g;

function decode(text: string): string {
  return text.replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? e);
}

/**
 * Texty blokových uzlov POVRCHU — bez obsahu rozkliku a bez vnútra ikon.
 *
 * `<svg>` sa vyrezáva celý: cesty ikon nie sú text, ale `<path d="…">` by po
 * rozdelení podľa značiek zostal ako niekoľkostoznakový „blok".
 */
export function surfaceBlocks(markup: string): readonly string[] {
  return markup
    .replace(DETAILS, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/g, ' ')
    .replace(INLINE, '')
    .split(/<[^>]+>/)
    .map((s) => decode(s).replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0);
}

/** Text VNÚTRI rozkliku — tam sa dôvody sťahujú a tam musia zostať. */
function detailsText(markup: string): string {
  const found = markup.match(DETAILS) ?? [];
  return found
    .join(' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/g, ' ')
    .split(/<[^>]+>/)
    .map((s) => decode(s).replace(/\s+/g, ' ').trim())
    .join(' ');
}

/**
 * Vety, ktoré tieto dve sekcie iba zobrazujú, ale nepíšu.
 *
 * Zoznam sa skladá z toho istého kódu, ktorý vety vyrobil (`blockers.ts` cez
 * stavovú odpoveď, `blockers-view.ts` cez `ASSUMED_NOTE`), nie ručným
 * odpísaním. Keď ich vlastník skráti, test to prijme bez úpravy; keď dlhú
 * vetu napíše niekto do súboru B1, výnimka ju nekryje.
 */
function foreignSentences(...payloads: readonly (StatusPayload | null)[]): ReadonlySet<string> {
  const out = new Set<string>([ASSUMED_NOTE]);
  for (const payload of payloads) {
    for (const blocker of payload?.blockers ?? []) {
      out.add(blocker.what);
      out.add(blocker.nextStep);
    }
  }
  return out;
}

/** Jedno vykreslenie sekcie aj s menom, ktoré sa objaví v hlásení o páde. */
interface Screen {
  readonly name: string;
  readonly markup: string;
}

const WRITES: readonly Screen[] = [
  {
    name: 'Zápisy — vypnuté',
    markup: renderToStaticMarkup(
      createElement(WritesSection, { status: STATUS_OFF, settings: SETTINGS }),
    ),
  },
  {
    name: 'Zápisy — pripravené',
    markup: renderToStaticMarkup(
      createElement(WritesSection, { status: STATUS_READY, settings: SETTINGS }),
    ),
  },
  {
    name: 'Zápisy — zamknuté a bez kľúča',
    markup: renderToStaticMarkup(
      createElement(WritesSection, { status: STATUS_LOCKED, settings: SETTINGS }),
    ),
  },
  {
    name: 'Zápisy — stav sa nedá prečítať',
    markup: renderToStaticMarkup(
      createElement(WritesSection, { status: null, settings: SETTINGS }),
    ),
  },
];

const BUDGETS: readonly Screen[] = [
  {
    name: 'Rozpočty — všetko známe',
    markup: renderToStaticMarkup(
      createElement(BudgetSection, { settings: SETTINGS, queue: queue(), catalog: catalog() }),
    ),
  },
  {
    name: 'Rozpočty — nič sa nedá prečítať',
    markup: renderToStaticMarkup(
      createElement(BudgetSection, {
        settings: SETTINGS,
        queue: queue({ budget: null }),
        catalog: null,
      }),
    ),
  },
  {
    name: 'Rozpočty — vyčerpané',
    markup: renderToStaticMarkup(
      createElement(BudgetSection, {
        settings: SETTINGS,
        queue: queue({
          budget: { day: '2026-08-12', budget: 200, spent: 200, remaining: 0, exhausted: true },
          heartbeat: { lastTickAt: '2026-08-12T08:59:00.000Z', staleMs: 1000, stale: false },
        }),
        catalog: catalog(),
      }),
    ),
  },
];

const SCREENS = [...WRITES, ...BUDGETS];

const FOREIGN = foreignSentences(STATUS_OFF, STATUS_READY, STATUS_LOCKED);

/* ══════════════ F. Poistka na poistku ═════════════════════════════════════ */

describe('Meranie povrchu vôbec niečo našlo', () => {
  it('každá obrazovka dala aspoň desať blokov textu', () => {
    for (const screen of SCREENS) {
      expect(surfaceBlocks(screen.markup).length, `${screen.name} — prázdny povrch`).toBeGreaterThan(
        9,
      );
    }
  });

  it('vyrezávanie rozkliku naozaj vyrezáva', () => {
    const [writes] = WRITES;
    // Riadok tabuľky rozkliku je v markupe, ale na povrchu byť nesmie.
    expect(writes!.markup).toContain('WRITES_ENABLED=true');
    expect(surfaceBlocks(writes!.markup).join(' ')).not.toContain('WRITES_ENABLED');
  });
});

/* ══════════════ A. P2 — 90 znakov na blok povrchu ═════════════════════════ */

describe('P2 — na povrchu nie je blok dlhší než 90 znakov', () => {
  for (const screen of SCREENS) {
    it(`${screen.name}`, () => {
      const tooLong = surfaceBlocks(screen.markup)
        .filter((block) => block.length > P2_LIMIT)
        .filter((block) => !FOREIGN.has(block));
      expect(
        tooLong,
        `${screen.name}: ${tooLong.length} blokov nad ${P2_LIMIT} znakov —\n` +
          tooLong.map((b) => `  ${b.length}: ${b}`).join('\n'),
      ).toEqual([]);
    });
  }

  it('výnimky sú len tie cudzie vety, ktoré tieto sekcie nepíšu', () => {
    const over = SCREENS.flatMap((s) => surfaceBlocks(s.markup)).filter(
      (b) => b.length > P2_LIMIT,
    );
    // Aspoň jedna dlhá veta na povrchu byť MUSÍ — je to veta prekážky
    // `writes_disabled` so zapísanou výnimkou z P2. Keby ich bolo nula,
    // znamenalo by to, že sa vyrezávanie rozbilo, nie že je povrch krátky.
    expect(over.length, 'žiadna dlhá veta — meranie je podozrivo prázdne').toBeGreaterThan(0);
    for (const block of over) expect(FOREIGN.has(block), `nekrytá veta: ${block}`).toBe(true);
  });
});

/* ══════════════ B. Dôvod sa presunul, nezahodil ═══════════════════════════ */

describe('Vysvetlenie sa presunulo pod rozklik, nezmizlo', () => {
  it('zápisy: dôvod vypnutia, osud fronty aj expirácia sú pod rozklikom', () => {
    const off = detailsText(WRITES[0]!.markup);
    expect(off).toContain('zámerne');
    expect(off).toContain('konfigurácii appky na počítači');
    expect(off).toContain('nič sa nestratí');
    expect(off).toContain('zapíšu hneď, ako podmienka začne platiť');
    expect(off).toContain('vyprší sama v deň, ktorý má nastavený');
  });

  it('zápisy: dôvod vypnutia sa nevysvetľuje vtedy, keď zápis beží', () => {
    const ready = WRITES[1]!.markup;
    expect(ready).toContain('data-testid="writes-why-queue"');
    expect(ready).not.toContain('data-testid="writes-why-disabled"');
  });

  it('rozpočty: dve kvóty aj prísnejšia možnosť sú pod rozklikom', () => {
    const text = detailsText(BUDGETS[0]!.markup);
    expect(text).toContain('vlastnú kvótu na kľúč');
    expect(text).toContain('adresu počítača');
    expect(text).toContain('neuberá zo zliav a naopak');
    expect(text).toContain('akoby bol rozpočet minutý');
    expect(text).toContain('načítavanie radšej počká');
    expect(text).toContain('neozvala dosť dlho');
  });

  it('presunutý text NIE JE zároveň na povrchu — inak sa nič neušetrilo', () => {
    for (const screen of SCREENS) {
      const povrch = surfaceBlocks(screen.markup).join(' ');
      for (const veta of [
        'zapíšu hneď, ako podmienka začne platiť',
        'vlastnú kvótu na kľúč',
        'neozvala dosť dlho',
      ]) {
        expect(povrch, `${screen.name} — „${veta}" je späť na povrchu`).not.toContain(veta);
      }
    }
  });
});

/* ══════════════ C. + D. Čo skrátenie nesmie zobrať ════════════════════════ */

describe('Vety, bez ktorých by appka prestala byť pravdivá', () => {
  it('vypnuté zápisy nesú celú vetu aj s koncom „nech je vo výbere čokoľvek"', () => {
    const povrch = surfaceBlocks(WRITES[0]!.markup).join(' ');
    expect(povrch).toContain('nech je vo výbere čokoľvek');
    // Zapísaná výnimka z P2 má strop: `design/v3/ARCHITEKTURA.md` hovorí, že
    // keby veta prerástla 96 znakov, výnimka padá a veta ide pod rozklik.
    // Skrátiť ju vlastník `blockers.ts` smie — predĺžiť nie.
    const veta = surfaceBlocks(WRITES[0]!.markup).find((b) => b.includes('nech je vo výbere'));
    expect(veta?.length ?? 0).toBeGreaterThan(0);
    expect(veta?.length ?? 0).toBeLessThanOrEqual(96);
  });

  it('vypnutý zápis zostáva na povrchu vysvetlený ako zámer, nie ako porucha', () => {
    const povrch = surfaceBlocks(WRITES[0]!.markup).join(' ');
    expect(povrch).toContain('Nie je to chyba');
    expect(povrch).toContain('zámer');
  });

  it('appka aj po skrátení povie, že zľavu nikdy nezruší', () => {
    for (const screen of WRITES) {
      expect(surfaceBlocks(screen.markup).join(' '), screen.name).toContain(
        'Appka zľavu nikdy nezruší',
      );
    }
  });

  it('neznáme číslo sa priznáva na POVRCHU, nie až pod rozklikom', () => {
    const povrch = surfaceBlocks(BUDGETS[1]!.markup).join(' ');
    expect(povrch).toContain('Koľko zápisov dnes odišlo');
    expect(povrch).toContain('Koľko čítaní katalógu dnes odišlo');
    expect(povrch).toContain('zatiaľ neviem');
  });
});

/* ══════════════ E. Po skrátení zostalo SLOVO ══════════════════════════════ */

describe('Pravidlo vlny 2 — v uzle stavu a v dlaždici zostalo slovo', () => {
  /** Uzly rodiny `.sig`, `.flag`, `.state` aj s ich obsahom. */
  const STATE_NODE = /<(\w+)[^>]*class="[^"]*\b(?:sig|flag|state)\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/g;

  it('každý uzol .sig/.flag/.state nesie text, nie len farbu a značku', () => {
    for (const screen of WRITES) {
      const found = [...screen.markup.matchAll(STATE_NODE)];
      expect(found.length, `${screen.name} — žiadny stavový uzol`).toBeGreaterThan(2);
      for (const [, , inner] of found) {
        const word = decode((inner ?? '').replace(/<svg\b[\s\S]*?<\/svg>/g, ' '))
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        expect(word.length, `${screen.name} — stavový uzol bez slova`).toBeGreaterThan(2);
      }
    }
  });

  it('každá dlaždica rozpočtov má popis aj hodnotu', () => {
    for (const id of ['budget-spent', 'budget-queue', 'budget-finish', 'budget-catalog']) {
      for (const screen of BUDGETS) {
        const at = screen.markup.indexOf(`data-testid="${id}"`);
        expect(at, `${screen.name} — dlaždica ${id} chýba`).toBeGreaterThan(-1);
        const tile = screen.markup.slice(at, at + 900);
        const text = decode(tile.replace(/<svg\b[\s\S]*?<\/svg>/g, ' '))
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        expect(/\p{L}/u.test(text), `${screen.name} — dlaždica ${id} bez slova`).toBe(true);
      }
    }
  });
});
