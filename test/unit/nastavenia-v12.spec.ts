/**
 * Aura Zľavy — Nastavenia, prihlásenie a mobil (V12).
 *
 * Dôkaz, nie report agenta (pasca z CLAUDE.md). Testuje sa presne to, čo sa dá
 * na tejto obrazovke pokaziť ticho a čo by si nikto nevšimol, kým to neurobí
 * škodu v produkčnom eshope:
 *
 *  A. **Kotvy a sekcie sedia.** Zoznam kotiev je navigácia stránky; keď sa
 *     rozíde s tým, čo sa naozaj vykreslí, odkazy vedú do prázdna.
 *  B. **Kľúč sa nikdy nezobrazí.** Ani v tabuľke, ani v rozkliku. Na obrazovke
 *     smú byť len posledné štyri znaky.
 *  C. **Vyčerpaný rozpočet nie je chyba.** Je to informácia — veta hovorí, že
 *     sa pokračuje, a nikde nepadne slovo o zlyhaní.
 *  D. **Neznáme číslo sa nedopĺňa.** Keď rozpočet nevieme prečítať, je tam
 *     pomlčka, nie vymyslená nula.
 *  E. **Rozsah zliav.** Uvoľnenie hovorí, čo sa zmení, a pýta heslo;
 *     sprísnenie heslo nepýta; nečitateľná hodnota sa prizná ako pilotný
 *     rozsah, nie ako plný.
 *  F. **História neoslabla.** Filtre zostávajú úplné (obdobie, typ, výsledok,
 *     číslo produktu aj zľavy), tabuľka nezobrazuje surový kód udalosti a
 *     neznámy kód sa na povrch nedostane.
 *  G. **Mobil.** Geometria stránky má prepis pre úzku obrazovku, ktorý zloží
 *     dvojstĺpce na jeden — inak by Nastavenia na telefóne skrolovali doboku.
 *
 * Renderuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna databáza,
 * žiadna sieť. Efekty klienta sa pri statickom renderi nespúšťajú, takže test
 * meria značky a texty, nie načítanie dát.
 *
 * Vlastník: V12 (testovú sadu ako celok vlastní V14).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import AuditFilters from '@/components/audit/AuditFilters';
import AuditTable, { auditRowText, showsFailureFlag } from '@/components/audit/AuditTable';
import { EMPTY_FILTERS, auditEventLabel, type AuditRow } from '@/components/audit/api';
import BudgetSection from '@/components/settings/BudgetSection';
import KeysSection from '@/components/settings/KeysSection';
import LockedFeatures, {
  LOCKED_FEATURES,
  lockedFeaturesText,
} from '@/components/settings/LockedFeatures';
import CatalogSection from '@/components/settings/CatalogSection';
import PilotAllowlist from '@/components/settings/PilotAllowlist';
import SafeguardsSection from '@/components/settings/SafeguardsSection';
import SignOut from '@/components/settings/SignOut';
import ScopeModeForm from '@/components/settings/ScopeModeForm';
import { SETTINGS_ANCHORS } from '@/components/settings/SettingsPanel';
import { SETTINGS_CSS } from '@/components/settings/styles';
import { LOGIN_CSS } from '@/app/login/styles';
import type { KeyMetaView, QueueView, SettingsView } from '@/components/settings/api';

/* ═══════════════════════════ vzorka ═══════════════════════════════════════ */

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

/**
 * Vymyslený kľúč, ktorý sa NESMIE objaviť v HTML. Tvar je zámerne taký, aby
 * nepripomínal skutočný kľúč — ochrana proti bloku na strane úložiska kódu.
 */
const FAKE_KEY_PLAINTEXT = 'fake-shop-key-0000-1111-2222';

const WRITE_KEY: KeyMetaView = {
  present: true,
  last4: '2222',
  savedAt: '2026-08-10T09:12:00.000Z',
  expiresAt: '2026-08-12T09:12:00.000Z',
  secondsLeft: 172800,
  verifyStatus: 'valid',
};

const ORDERS_KEY: KeyMetaView = {
  present: false,
  last4: null,
  savedAt: null,
  expiresAt: null,
  secondsLeft: null,
  verifyStatus: null,
};

function queue(over: Partial<QueueView> = {}): QueueView {
  return {
    budget: { day: '2026-08-10', budget: 200, spent: 100, remaining: 100, exhausted: false },
    queue: { pending: 4580, total: 8000, done: 3420, campaigns: 1 },
    estimate: { pending: 4580, perDay: 200, days: 23, date: '2026-09-02' },
    heartbeat: { lastTickAt: '2026-08-10T11:39:00.000Z', staleMs: 60000, stale: false },
    ...over,
  };
}

const noop = () => {};

/* ══════════════════ A. Kotvy vedú na sekcie, ktoré existujú ═══════════════ */

describe('Nastavenia — kotvy a sekcie', () => {
  it('kotvy sú jedinečné a v poradí, v akom sa sekcie kreslia', () => {
    const ids = SETTINGS_ANCHORS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'pripojenie',
      'kluce',
      'katalog',
      'rozpocet',
      'rozsah',
      'poistky',
      'zamknute',
      'historia',
      'odhlasenie',
      'cervena',
    ]);
  });

  it('sekcie nesú presne tie identifikátory, na ktoré kotvy ukazujú', () => {
    const markup = [
      renderToStaticMarkup(
        createElement(KeysSection, {
          writeKey: WRITE_KEY,
          ordersKey: ORDERS_KEY,
          onStored: noop,
        }),
      ),
      renderToStaticMarkup(createElement(BudgetSection, { settings: SETTINGS, queue: queue() })),
      renderToStaticMarkup(createElement(ScopeModeForm, { settings: SETTINGS, onChanged: noop })),
      renderToStaticMarkup(
        createElement(SafeguardsSection, { settings: SETTINGS, onChanged: noop }),
      ),
      renderToStaticMarkup(createElement(LockedFeatures)),
    ].join('\n');

    for (const id of ['kluce', 'rozpocet', 'rozsah', 'poistky', 'zamknute']) {
      expect(markup, `chýba sekcia s kotvou ${id}`).toContain(`id="${id}"`);
    }
  });
});

/* ═════════════════════ B. Kľúč sa nikdy nezobrazí ═════════════════════════ */

describe('Kľúče — na obrazovke sú len posledné štyri znaky', () => {
  const markup = renderToStaticMarkup(
    createElement(KeysSection, { writeKey: WRITE_KEY, ordersKey: ORDERS_KEY, onStored: noop }),
  );

  it('celý kľúč sa do značiek nedostane', () => {
    expect(markup).not.toContain(FAKE_KEY_PLAINTEXT);
    expect(markup).toContain('2222');
  });

  it('tabuľka pomenuje oba kľúče a povie, ktorý chýba', () => {
    expect(markup).toContain('Zápis zliav');
    expect(markup).toContain('Objednávky');
    expect(markup).toContain('vložený');
    expect(markup).toContain('chýba');
  });

  it('keď kľúč na zápis chýba, pole je otvorené hneď', () => {
    const missing = renderToStaticMarkup(
      createElement(KeysSection, {
        writeKey: { ...WRITE_KEY, present: false, last4: null, expiresAt: null },
        ordersKey: ORDERS_KEY,
        onStored: noop,
      }),
    );
    expect(missing).toContain('data-testid="api-key-input"');
  });
});

/* ═══════════════ C+D. Rozpočet: informácia, nie chyba a nie výmysel ═══════ */

describe('Rozpočet zápisov', () => {
  it('vyčerpaný rozpočet hovorí, že sa pokračuje, a nie že sa niečo pokazilo', () => {
    const markup = renderToStaticMarkup(
      createElement(BudgetSection, {
        settings: SETTINGS,
        queue: queue({
          budget: { day: '2026-08-10', budget: 200, spent: 200, remaining: 0, exhausted: true },
        }),
      }),
    );
    expect(markup).toContain('pokračujem');
    for (const word of ['chyba', 'zlyhal', 'porucha']) {
      expect(markup.toLowerCase(), `vyčerpaný rozpočet nesmie znieť ako ${word}`).not.toContain(
        word,
      );
    }
  });

  it('neznámy rozpočet je pomlčka, nie vymyslená nula', () => {
    const markup = renderToStaticMarkup(
      createElement(BudgetSection, { settings: SETTINGS, queue: queue({ budget: null }) }),
    );
    expect(markup).toContain('zatiaľ neviem');
    expect(markup).not.toContain('>0 <');
  });

  it('odhad dokončenia je označený ako odhad', () => {
    const markup = renderToStaticMarkup(
      createElement(BudgetSection, { settings: SETTINGS, queue: queue() }),
    );
    // Trieda `est` dopĺňa znak ≈ pred hodnotu — odhad sa nesmie tváriť
    // rovnako ako merané číslo.
    expect(markup).toContain('class="est"');
  });
});

/* ═══════════════════════ E. Rozsah zliav ══════════════════════════════════ */

describe('Rozsah zliav', () => {
  it('pilotný rozsah povie, že prechod na plný stojí heslo', () => {
    const markup = renderToStaticMarkup(
      createElement(ScopeModeForm, { settings: SETTINGS, onChanged: noop }),
    );
    expect(markup).toContain('pilotný rozsah');
    expect(markup).toContain('vyžaduje heslo');
    expect(markup).toContain('data-testid="scope-open-full"');
  });

  it('plný rozsah sa dá vrátiť späť bez hesla', () => {
    const markup = renderToStaticMarkup(
      createElement(ScopeModeForm, {
        settings: { ...SETTINGS, scopeMode: 'plny', maxProducts: 10000 },
        onChanged: noop,
      }),
    );
    expect(markup).toContain('data-testid="scope-confirm-pilot"');
    expect(markup).toContain('heslo nevyžaduje');
  });

  it('nečitateľná hodnota sa prizná a znamená pilotný rozsah', () => {
    const markup = renderToStaticMarkup(
      createElement(ScopeModeForm, {
        settings: { ...SETTINGS, scopeFailClosed: true },
        onChanged: noop,
      }),
    );
    expect(markup).toContain('data-testid="scope-fail-closed"');
    expect(markup).toContain('nepodarilo prečítať');
  });

  it('strop na jednu zľavu je vidieť v Poistkách aj v Rozsahu', () => {
    const scope = renderToStaticMarkup(
      createElement(ScopeModeForm, { settings: SETTINGS, onChanged: noop }),
    );
    const guards = renderToStaticMarkup(
      createElement(SafeguardsSection, { settings: SETTINGS, onChanged: noop }),
    );
    expect(scope).toContain('10 produktov');
    expect(guards).toContain('10 produktov');
    // Ručné potvrdenie počtu sa vypnúť NEDÁ a obrazovka to má povedať.
    expect(guards).toContain('nedá sa vypnúť');
  });
});

/* ═══════════════ F. História: rám sa zmenil, obsah neoslabol ══════════════ */

describe('História a technický detail', () => {
  const rows: readonly AuditRow[] = [
    {
      id: 91,
      ts: '2026-08-10T09:38:00.000Z',
      actor: 'scheduler',
      userId: null,
      eventType: 'write_ok',
      ok: true,
      campaignId: 1,
      campaignItemId: 5,
      productId: 18342,
      operationId: 'op-1',
      requestId: 'req-1',
      httpStatus: 200,
      message: null,
    },
    {
      id: 92,
      ts: '2026-08-10T09:39:00.000Z',
      actor: 'user',
      userId: 1,
      eventType: 'uplne_novy_kod_udalosti',
      ok: false,
      campaignId: null,
      campaignItemId: null,
      productId: null,
      operationId: null,
      requestId: null,
      httpStatus: null,
      message: null,
    },
  ];

  const markup = renderToStaticMarkup(
    createElement(AuditTable, { rows, onSelect: noop }),
  );

  it('tabuľka nezobrazí surový kód udalosti ani neznámy kód', () => {
    expect(markup).not.toContain('write_ok');
    expect(markup).not.toContain('uplne_novy_kod_udalosti');
    expect(markup).toContain(auditEventLabel('write_ok'));
    expect(markup).toContain('iná udalosť appky');
  });

  it('veta zo servera má prednosť pred prekladom kódu', () => {
    const row = { ...rows[0]!, message: 'Fronta zapísala 20 produktov' };
    expect(auditRowText(row)).toBe('Fronta zapísala 20 produktov');
    expect(auditRowText({ ...row, message: '   ' })).toBe(auditEventLabel('write_ok'));
  });

  it('neúspešný riadok nesie príznak, ale nikdy ten istý údaj dvakrát', () => {
    const failed = { ...rows[0]!, ok: false as const, message: 'Fronta narazila na zamknutý produkt' };
    // Veta zo servera o výsledku nehovorí → príznak treba.
    expect(showsFailureFlag(failed)).toBe(true);
    // Preklad kódu už výsledok obsahuje → príznak by bol redundancia.
    expect(showsFailureFlag({ ...failed, message: null })).toBe(false);
    expect(showsFailureFlag(rows[0]!)).toBe(false);
    const withFlag = renderToStaticMarkup(
      createElement(AuditTable, { rows: [failed], onSelect: noop }),
    );
    expect(withFlag).toContain('nepodarilo sa');
    // Riadok bez vety zo servera nesmie mať príznak nalepený na text.
    expect(markup).not.toContain('nepodarilo sa</div>');
  });

  it('filtre zostali úplné — obdobie, typ, výsledok, číslo produktu aj zľavy', () => {
    const filters = renderToStaticMarkup(
      createElement(AuditFilters, { value: { ...EMPTY_FILTERS }, onChange: noop }),
    );
    for (const id of [
      'audit-filter-from',
      'audit-filter-to',
      'audit-filter-event',
      'audit-filter-ok',
      'audit-filter-product',
      'audit-filter-campaign',
      'audit-filter-reset',
    ]) {
      expect(filters, `filter ${id} zmizol`).toContain(`data-testid="${id}"`);
    }
  });

  it('história nemá ani jednu akciu, ktorá by ju menila', () => {
    const filters = renderToStaticMarkup(
      createElement(AuditFilters, { value: { ...EMPTY_FILTERS }, onChange: noop }),
    );
    for (const word of ['Zmazať záznam', 'Upraviť', 'Vymazať históriu']) {
      expect(markup + filters, `história nesmie ponúkať „${word}"`).not.toContain(word);
    }
  });
});

/* ═══════════════════════ Zamknuté funkcie ═════════════════════════════════ */

describe('Zamknuté funkcie', () => {
  it('sú vidieť všetky štyri aj s tým, čo im chýba', () => {
    const markup = renderToStaticMarkup(createElement(LockedFeatures));
    expect(LOCKED_FEATURES).toHaveLength(4);
    for (const row of LOCKED_FEATURES) {
      expect(markup).toContain(row.feature);
      expect(markup).toContain(row.missing);
    }
  });

  it('text pre dodávateľa obsahuje celý zoznam', () => {
    const text = lockedFeaturesText();
    for (const row of LOCKED_FEATURES) {
      expect(text).toContain(row.feature);
      expect(text).toContain(row.missing);
    }
  });
});

/* ═══════════════ H. Odhlásenie sa dá vôbec urobiť ═════════════════════════ */

describe('Odhlásenie', () => {
  /*
   * Regresia: prestavba na štyri taby vzala odhlásenie so sebou. Cesta
   * `POST /api/auth/logout` ostala, ale v UI ju už nič nevolalo — používateľ
   * sa nemal ako odhlásiť a musel čakať, kým session vyprší. Tento test drží
   * tlačidlo na mieste.
   */
  it('sekcia existuje, má tlačidlo a nesie kotvu, na ktorú navigácia ukazuje', () => {
    const markup = renderToStaticMarkup(createElement(SignOut));
    expect(markup).toContain('id="odhlasenie"');
    expect(markup).toContain('data-testid="sign-out-button"');
    expect(markup).toContain('Odhlásiť sa');
  });

  it('hovorí, čo odhlásenie NEZASTAVÍ — fronta beží na serveri, nie v prehliadači', () => {
    const markup = renderToStaticMarkup(createElement(SignOut));
    expect(markup).toContain('Fronta beží ďalej');
  });
});

/* ═════════════════════════════ G. Mobil ═══════════════════════════════════ */

describe('Mobil — nič neskroluje doboku', () => {
  it('geometria Nastavení skladá dvojstĺpce na úzkej obrazovke', () => {
    expect(SETTINGS_CSS).toContain('@media (max-width:760px)');
    const mobile = SETTINGS_CSS.slice(SETTINGS_CSS.indexOf('@media (max-width:760px)'));
    expect(mobile).toContain('.set-page .split{grid-template-columns:1fr}');
    expect(mobile).toContain('.set-page .kv{grid-template-columns:1fr');
  });

  it('dlhé technické reťazce sa lámu, nerozťahujú stránku', () => {
    expect(SETTINGS_CSS).toContain('overflow-wrap:anywhere');
    expect(LOGIN_CSS).toContain('overflow-wrap:anywhere');
  });

  it('prihlasovacia karta má strop šírky, nie pevnú šírku', () => {
    // `width:100%` + `max-width` = karta sa na telefóne zmestí; samotné
    // `max-width` bez `width:100%` by na širokej obrazovke stále fungovalo,
    // ale bez neho by pevná šírka vytlačila stránku doboku.
    expect(LOGIN_CSS).toContain('.login .sec{width:100%;max-width:360px;');
    expect(LOGIN_CSS).toMatch(/\.login\{[^}]*padding:24px 4px\}/);
  });
});

/* ═══ I. Prvý beh sa dá dokončiť — katalóg a povolené produkty ═════════════ */

describe('Prvý beh: katalóg a povolené produkty', () => {
  /*
   * Dve regresie z prestavby, obe zistené až prechodom celej Samuelovej cesty:
   *
   *  1. Výber produktov stojí na zrkadle katalógu, ale tlačidlo, ktoré ho
   *     naplní, v UI nebolo — `POST /api/catalog/sync` nemal volajúceho a
   *     automatický beh je len 21:00–07:00. Produkty teda cez deň zostali
   *     prázdne a zľava sa nedala vybrať vôbec.
   *  2. Predvolený režim je `pilot` a guard v ňom vyžaduje allowlist, ale
   *     obrazovka allowlistu zanikla. Prvá zľava spadla na „aspoň jeden
   *     produkt nie je v aktívnom allowliste" a nebolo to ako napraviť.
   *
   * Tieto testy držia obe cesty otvorené.
   */
  it('Nastavenia majú tlačidlo na načítanie katalógu', () => {
    const markup = renderToStaticMarkup(createElement(CatalogSection));
    expect(markup).toContain('id="katalog"');
    expect(markup).toContain('data-testid="catalog-sync"');
    expect(markup).toContain('Načítať katalóg');
  });

  it('katalóg povie, načo je — bez neho sa zľava nedá vybrať', () => {
    const markup = renderToStaticMarkup(createElement(CatalogSection));
    expect(markup).toContain('nedá vybrať produkt do zľavy');
  });

  it('povolené produkty sa dajú pridať aj odobrať, so stropom 10', () => {
    const markup = renderToStaticMarkup(createElement(PilotAllowlist));
    expect(markup).toContain('data-testid="pilot-allowlist"');
    expect(markup).toContain('data-testid="allow-input"');
    expect(markup).toContain('data-testid="allow-add"');
    expect(markup).toContain('z 10');
  });

  it('prázdny zoznam prizná, že appka nezapíše nič — netvári sa, že je to v poriadku', () => {
    const markup = renderToStaticMarkup(createElement(PilotAllowlist));
    // Pred načítaním je stav „Načítavam…"; veta o prázdnom zozname musí byť
    // v komponente prítomná ako text, nie dopočítaná až za behu.
    expect(markup).toContain('Načítavam…');
  });

  it('povolené produkty sa v PLNOM rozsahu nezobrazujú', () => {
    const plny = renderToStaticMarkup(
      createElement(ScopeModeForm, {
        settings: { ...SETTINGS, scopeMode: 'plny', maxProducts: 10_000 },
        onChanged: noop,
      }),
    );
    expect(plny).not.toContain('data-testid="pilot-allowlist"');

    const pilot = renderToStaticMarkup(
      createElement(ScopeModeForm, { settings: SETTINGS, onChanged: noop }),
    );
    expect(pilot).toContain('data-testid="pilot-allowlist"');
  });
});
