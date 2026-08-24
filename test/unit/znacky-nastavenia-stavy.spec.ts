/**
 * Aura Zľavy — TRI KANÁLY PRI KAŽDOM STAVE NASTAVENÍ (A3, vlna 1, šprint 20).
 *
 * Pravidlo appky znie „stav nie je nikdy len farba — vždy farba + značka +
 * slovo". Tento súbor ho meria na piatich formulároch Nastavení, a to
 * **po jednotlivých výskytoch**, nie po súboroch.
 *
 * PREČO PO VÝSKYTOCH (a prečo `ikony.spec.ts` nestačí)
 * ----------------------------------------------------
 * `test/unit/ikony.spec.ts` sa pýta „kreslí tento SÚBOR aspoň jednu značku?".
 * To je správna otázka na prechod z CSS na komponenty, ale je hrubá: keď má
 * súbor tri stavy a jednému z nich značka zmizne, zvyšné dva test upokoja
 * a ostane zelený. A3 to overil mutáciou (pozri správu k vlne) — presne tak
 * to dopadlo. Tu sa preto vykreslí HTML, nájde sa v ňom KAŽDÝ uzol s tónovanou
 * triedou a pri každom sa zvlášť tvrdia všetky tri kanály:
 *
 *   1. **farba** — trieda nesie tón, ktorý má v `globals.css` vlastnú farbu
 *      zo stavovej škály (`--st-*`, pri zámku tlmená `--dim`);
 *   2. **značka** — vnútri uzla je práve jedna `<svg class="ovl-ic">`;
 *   3. **slovo** — po odstránení značiek v uzle zostane text.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 *  A. **Meria sa vykreslený výstup, nie zdroj.** Test, ktorý číta `.tsx` ako
 *     text, zakáže časom aj to, čo je napísané v komentári — a autor potom
 *     nesmie vysvetliť, prečo stará mapa zanikla. Tu sa číta len HTML, ktoré
 *     vyrobí `renderToStaticMarkup`, a `globals.css` kvôli farbe.
 *  B. **Prázdny nález je pád, nie úspech.** Pri každom vykreslení sa tvrdí,
 *     KTORÉ uzly tam majú byť, menovite cez `data-testid`. Bez toho by
 *     tvrdenie „každý uzol má tri kanály" prešlo aj nad nulou uzlov — a to
 *     je presne ten prípad, keď stav z obrazovky zmizol celý.
 *  C. **Stav za odpoveďou servera musí byť samostatný uzol.** Výsledok skúšky
 *     spojenia, hlásenie po uložení kľúča aj hlásenie o neuloženom kľúči
 *     vznikajú až po odpovedi servera; statický render celého formulára ich
 *     nevykreslí. Preto ich formuláre vystavujú ako komponenty (`VerifyState`,
 *     `NotStoredState`, `ConnectionState`) a tu sa vykresľujú priamo. Keby sa
 *     vrátili späť do tela formulára, prestali by byť merateľné.
 *
 * Vlastník: A3, vlna 1 šprintu 20 (20. 8. 2026).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ApiKeyForm, {
  NotStoredState as ApiNotStored,
  UNKNOWN_VERIFY as API_UNKNOWN,
  VERIFY_LABELS as API_VERIFY,
  VerifyState as ApiVerifyState,
} from '@/components/settings/ApiKeyForm';
import DomainForm, { ConnectionState } from '@/components/settings/DomainForm';
import OrdersKeyForm, {
  NotStoredState as OrdersNotStored,
  UNKNOWN_VERIFY as ORDERS_UNKNOWN,
  VERIFY_LABELS as ORDERS_VERIFY,
  VerifyState as OrdersVerifyState,
} from '@/components/settings/OrdersKeyForm';
import ScopeModeForm from '@/components/settings/ScopeModeForm';
import UnlockWritesForm from '@/components/settings/UnlockWritesForm';
import type { KeyMetaView, SettingsView } from '@/components/settings/api';

const noop = () => {};

const GLOBALS = readFileSync(
  fileURLToPath(new URL('../../src/app/globals.css', import.meta.url)),
  'utf8',
);

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

const KEY_META = (verifyStatus: KeyMetaView['verifyStatus']): KeyMetaView => ({
  present: true,
  last4: '2222',
  savedAt: '2026-08-10T09:12:00.000Z',
  expiresAt: '2026-08-12T09:12:00.000Z',
  secondsLeft: 40_000,
  verifyStatus,
});

/* ═════════════════════════ hľadanie stavových uzlov ═══════════════════════ */

/** Varianty rodiny `.sig`/`.flag`/`.state`, ktoré nesú farbu. */
const TONY = ['ok', 'warn', 'bad', 'progress', 'idle', 'lock', 'good', 'neutral',
  'attention', 'critical', 'live', 'done', 'pripravena', 'zapisuje', 'bezi', 'skoncila'];

interface Uzol {
  readonly trieda: string;
  readonly tony: readonly string[];
  readonly testId: string | null;
  readonly znacky: number;
  readonly slovo: string;
}

/**
 * Nájde v HTML každý uzol s triedou rodiny `.sig`/`.flag`/`.state`.
 *
 * Hľadá sa len OTVÁRACÍ tag, nie celý prvok — inak by skenovanie prehltlo
 * hostiteľa aj s telom a vnorený stavový uzol (napríklad značku overenia
 * v odstavci `set-note`) by preskočilo. Telo sa doreže až podľa nájdenej
 * pozície.
 */
function stavoveUzly(markup: string): Uzol[] {
  const out: Uzol[] = [];
  const otvarac = /<(span|p)\b[^>]*?class="((?:sig|flag|state)[^"]*)"[^>]*?>/g;
  let m: RegExpExecArray | null;
  while ((m = otvarac.exec(markup)) !== null) {
    const tag = m[1]!;
    const trieda = m[2]!;
    const zaciatok = m.index + m[0].length;
    const koniec = markup.indexOf(`</${tag}>`, zaciatok);
    const telo = koniec === -1 ? '' : markup.slice(zaciatok, koniec);
    const testId = /data-testid="([^"]*)"/.exec(m[0])?.[1] ?? null;
    out.push({
      trieda,
      tony: trieda.split(/\s+/).filter((c) => TONY.includes(c)),
      testId,
      znacky: (telo.match(/<svg\b[^>]*class="[^"]*\bovl-ic\b/g) ?? []).length,
      slovo: telo.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    });
  }
  return out;
}

/** Má tón v `globals.css` vlastnú farbu? Bez toho je „farba" prázdny sľub. */
function maFarbu(ton: string): boolean {
  const re = new RegExp(`\\.(?:sig|flag|state)\\.${ton}\\s*\\{[^}]*color:\\s*var\\(--`, 'm');
  return re.test(GLOBALS);
}

/**
 * Overí tri kanály pri KAŽDOM uzle a zároveň to, že sú tam očakávané uzly.
 *
 * `ocakavane` sú `data-testid` uzlov, ktoré na obrazovke musia byť. Je to
 * poistka podľa bodu B hlavičky: bez nej by tvrdenie o troch kanáloch prešlo
 * aj nad prázdnym zoznamom, teda nad obrazovkou, z ktorej stav zmizol.
 */
function overTriKanaly(markup: string, ocakavane: readonly string[], kde: string) {
  const uzly = stavoveUzly(markup);
  expect(
    uzly.map((u) => u.testId).filter((t): t is string => t !== null).sort(),
    `${kde}: chýba stavový uzol`,
  ).toEqual([...ocakavane].sort());
  expect(uzly.length, `${kde}: nenašiel sa ani jeden stavový uzol`).toBe(ocakavane.length);
  for (const u of uzly) {
    const meno = `${kde} → ${u.testId ?? u.trieda}`;
    expect(u.tony.length, `${meno}: trieda "${u.trieda}" nenesie tón, teda ani farbu`).toBe(1);
    expect(maFarbu(u.tony[0]!), `${meno}: tón ${u.tony[0]} nemá v globals.css farbu`).toBe(true);
    expect(u.znacky, `${meno}: značka nie je práve jedna (stav je len farba a slovo)`).toBe(1);
    expect(u.slovo.length, `${meno}: pri značke nestojí slovo`).toBeGreaterThan(3);
  }
}

/* ═════════ 1. Kľúče — výsledok overenia na oboch miestach obrazovky ═══════ */

describe('Kľúče — stav overenia má tri kanály pri každom kóde', () => {
  const kody = [...Object.keys(API_VERIFY), 'nieco_co_appka_nepozna'];

  it('zápisový kľúč: každý kód overenia nesie farbu, značku aj slovo', () => {
    for (const kod of kody) {
      const look = API_VERIFY[kod] ?? API_UNKNOWN;
      const markup = renderToStaticMarkup(
        createElement(ApiVerifyState, { look, testId: 'api-key-verify' }),
      );
      overTriKanaly(markup, ['api-key-verify'], `zápisový kľúč / ${kod}`);
    }
  });

  it('objednávkový kľúč: to isté pre jeho vlastné kódy', () => {
    for (const kod of [...Object.keys(ORDERS_VERIFY), 'nieco_co_appka_nepozna']) {
      const look = ORDERS_VERIFY[kod] ?? ORDERS_UNKNOWN;
      const markup = renderToStaticMarkup(
        createElement(OrdersVerifyState, { look, testId: 'orders-key-verify' }),
      );
      overTriKanaly(markup, ['orders-key-verify'], `objednávkový kľúč / ${kod}`);
    }
  });

  it('neznámy kód sa prizná, nezmizne — jantár, nie zelená a nie červená', () => {
    for (const unknown of [API_UNKNOWN, ORDERS_UNKNOWN]) {
      expect(unknown.tone).toBe('warn');
      expect(unknown.label.length).toBeGreaterThan(5);
    }
  });

  it('hlásenie o NEULOŽENOM kľúči je stav, nie veta — má všetky tri kanály', () => {
    overTriKanaly(
      renderToStaticMarkup(createElement(ApiNotStored)),
      ['api-key-not-stored'],
      'zápisový kľúč / neuložený',
    );
    overTriKanaly(
      renderToStaticMarkup(createElement(OrdersNotStored)),
      ['orders-key-not-stored'],
      'objednávkový kľúč / neuložený',
    );
  });

  it('vo formulári stojí stav overenia tam, kde je uložený kľúč', () => {
    for (const kod of ['valid', 'unverified', 'invalid', 'forbidden'] as const) {
      overTriKanaly(
        renderToStaticMarkup(
          createElement(ApiKeyForm, { keyMeta: KEY_META(kod), onStored: noop }),
        ),
        ['api-key-verify'],
        `ApiKeyForm / ${kod}`,
      );
      overTriKanaly(
        renderToStaticMarkup(
          createElement(OrdersKeyForm, { keyMeta: KEY_META(kod), onStored: noop }),
        ),
        ['orders-key-verify'],
        `OrdersKeyForm / ${kod}`,
      );
    }
  });

  it('keď kľúč chýba, appka netvrdí stav overenia — a povie to vetou', () => {
    const markup = renderToStaticMarkup(
      createElement(ApiKeyForm, { keyMeta: null, onStored: noop }),
    );
    expect(stavoveUzly(markup)).toEqual([]);
    expect(markup).toContain('data-testid="api-key-missing"');
  });

  it('keď sonda ešte nebežala, stav overenia sa nedomýšľa', () => {
    const markup = renderToStaticMarkup(
      createElement(ApiKeyForm, { keyMeta: KEY_META(null), onStored: noop }),
    );
    expect(stavoveUzly(markup)).toEqual([]);
    expect(markup).toContain('data-testid="api-key-meta"');
  });
});

/* ═════════════════════ 2. Pripojenie — skúška spojenia ═══════════════════ */

describe('Pripojenie — výsledok skúšky spojenia', () => {
  it('oba výsledky nesú farbu, značku aj slovo', () => {
    overTriKanaly(
      renderToStaticMarkup(createElement(ConnectionState, { ok: true })),
      ['domain-connection'],
      'DomainForm / spojenie funguje',
    );
    overTriKanaly(
      renderToStaticMarkup(createElement(ConnectionState, { ok: false })),
      ['domain-connection'],
      'DomainForm / eshop neodpovedal',
    );
  });

  it('kým skúška nebežala, obrazovka o spojení netvrdí nič', () => {
    const markup = renderToStaticMarkup(
      createElement(DomainForm, {
        shopDomain: 'https://sperky-eshop.sk',
        domainConfirmedAt: '2026-08-10T09:12:00.000Z',
        onSaved: noop,
      }),
    );
    expect(stavoveUzly(markup)).toEqual([]);
    expect(markup).not.toContain('data-testid="domain-connection"');
  });
});

/* ═══════════════════════════ 3. Rozsah zliav ═════════════════════════════ */

describe('Rozsah zliav — ktorý rozsah platí', () => {
  it('v pilotnom rozsahu majú oba stavy tri kanály', () => {
    overTriKanaly(
      renderToStaticMarkup(createElement(ScopeModeForm, { settings: SETTINGS, onChanged: noop })),
      ['scope-mode-current', 'scope-row-pilot'],
      'ScopeModeForm / pilot',
    );
  });

  it('v plnom rozsahu tiež — a značku má aj riadok tabuľky', () => {
    overTriKanaly(
      renderToStaticMarkup(
        createElement(ScopeModeForm, {
          settings: { ...SETTINGS, scopeMode: 'plny', maxProducts: 10000 },
          onChanged: noop,
        }),
      ),
      ['scope-mode-current', 'scope-row-full'],
      'ScopeModeForm / plný',
    );
  });

  it('nečitateľná hodnota nemení počet stavov ani im nezoberie značku', () => {
    overTriKanaly(
      renderToStaticMarkup(
        createElement(ScopeModeForm, {
          settings: { ...SETTINGS, scopeFailClosed: true },
          onChanged: noop,
        }),
      ),
      ['scope-mode-current', 'scope-row-pilot'],
      'ScopeModeForm / fail-closed',
    );
  });
});

/* ════════════════════════ 4. Zámok zápisov ═══════════════════════════════ */

describe('Zámok zápisov — pokojný aj zamknutý stav', () => {
  it('zamknuté má farbu, značku aj slovo', () => {
    overTriKanaly(
      renderToStaticMarkup(
        createElement(UnlockWritesForm, {
          writesLocked: true,
          writesLockedReason: 'appka zapisovala rýchlejšie, než je bezpečné',
          onUnlocked: noop,
        }),
      ),
      ['unlock-writes-state'],
      'UnlockWritesForm / zamknuté',
    );
  });

  it('pokojný stav nie je holá veta — nesie tie isté tri kanály', () => {
    overTriKanaly(
      renderToStaticMarkup(
        createElement(UnlockWritesForm, {
          writesLocked: false,
          writesLockedReason: null,
          onUnlocked: noop,
        }),
      ),
      ['unlock-writes-state'],
      'UnlockWritesForm / odomknuté',
    );
  });

  it('oba stavy sa od seba líšia slovom, nielen farbou', () => {
    const slovo = (locked: boolean) =>
      stavoveUzly(
        renderToStaticMarkup(
          createElement(UnlockWritesForm, {
            writesLocked: locked,
            writesLockedReason: null,
            onUnlocked: noop,
          }),
        ),
      )[0]!.slovo;
    expect(slovo(true)).not.toBe(slovo(false));
  });
});

/* ═══════════ 5. Poistka na poistku — hľadač uzlov naozaj hľadá ═══════════ */

describe('hľadač stavových uzlov nie je slepý', () => {
  it('nájde uzol vnorený v odstavci, nie len samostatný', () => {
    // Presne tvar hlásenia po uložení kľúča: `.sig` vnútri `<p class="set-note">`.
    const markup =
      '<p class="set-note" data-testid="obal">Kľúč je uložený (' +
      '<span class="sig ok" data-testid="vnoreny"><svg class="ovl-ic"></svg>overený</span>).</p>';
    const uzly = stavoveUzly(markup);
    expect(uzly.map((u) => u.testId)).toEqual(['vnoreny']);
    expect(uzly[0]!.znacky).toBe(1);
    expect(uzly[0]!.slovo).toBe('overený');
  });

  it('uzol bez značky sa naozaj rozpozná ako uzol bez značky', () => {
    const uzly = stavoveUzly('<span class="sig bad" data-testid="nemy">Eshop neodpovedal</span>');
    expect(uzly).toHaveLength(1);
    expect(uzly[0]!.znacky).toBe(0);
  });

  it('tón bez farby v globals.css sa rozpozná', () => {
    expect(maFarbu('ok')).toBe(true);
    expect(maFarbu('vymysleny')).toBe(false);
  });
});
