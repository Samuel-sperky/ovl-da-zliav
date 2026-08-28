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
import DiagnosticsSection from '@/components/settings/DiagnosticsSection';
import KeysSection from '@/components/settings/KeysSection';
import LockedFeatures, {
  LOCKED_FEATURES,
  lockedFeaturesText,
} from '@/components/settings/LockedFeatures';
import SafeguardsSection from '@/components/settings/SafeguardsSection';
import ScopeModeForm from '@/components/settings/ScopeModeForm';
import { SETTINGS_ANCHORS } from '@/components/settings/sub-pages';
import { SETTINGS_CSS } from '@/components/settings/styles';
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
    // Poradie zoskupuje sekcie podľa OTÁZKY, na ktorú odpovedajú
    // (KONTRAKT-DOKONCENIE-2026-08-12, body C3 a C5), nie podľa toho,
    // v akom poradí historicky vznikali:
    //   čo appka vie      → covie
    //   na čo je napojená → pripojenie, kluce
    //   čo smie robiť     → rozsah, zapisy
    //   koľko toho smie   → rozpocet
    //   čo už spravila    → historia, diagnostika, zamknute
    //   núdzové brzdy     → poistky, cervena
    //
    // `covie` je navrchu zámerne: používateľ mesiace netušil, že strop
    // desiatich produktov je iba prepínač, takže rozcestník „čo appka vie"
    // nesmie byť schovaný až pod formulármi.
    expect(ids).toEqual([
      'covie',
      'pripojenie',
      'kluce',
      'rozsah',
      'zapisy',
      'rozpocet',
      'historia',
      'diagnostika',
      'zamknute',
      'poistky',
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
      renderToStaticMarkup(createElement(DiagnosticsSection)),
    ].join('\n');

    // Podmnožina kotiev — tie ostatné (`pripojenie`, `historia`, `cervena`)
    // patria komponentám, ktoré si bez fetchu a props nezrenderujú.
    //
    // POZOR NA TÚTO VÝNIMKU (28. 8. 2026): do dnes tu bola vyňatá aj kotva
    // `odhlasenie` s tým, že „kryje ju e2e". Nekryla — a keď D99 zmazalo
    // `SignOut.tsx`, rozcestník ponúkal odkaz na sekciu, ktorá neexistuje,
    // a našel to až preklik v prehliadači. Čo je vyňaté tu, nestráži NIKTO;
    // kto pridá kotvu do `SETTINGS_ANCHORS`, nech ju pridá aj sem.
    for (const id of ['kluce', 'rozpocet', 'rozsah', 'poistky', 'zamknute', 'diagnostika']) {
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
  it('pilotný rozsah povie, že prechod na plný stojí potvrdenie', () => {
    const markup = renderToStaticMarkup(
      createElement(ScopeModeForm, { settings: SETTINGS, onChanged: noop }),
    );
    expect(markup).toContain('pilotný rozsah');
    // D105 (27. 8. 2026): „heslo" → „potvrdenie", brána zostala.
    expect(markup).toContain('vyžaduje potvrdenie');
    expect(markup).toContain('data-testid="scope-open-full"');
  });

  it('plný rozsah sa dá vrátiť späť bez potvrdenia', () => {
    const markup = renderToStaticMarkup(
      createElement(ScopeModeForm, {
        settings: { ...SETTINGS, scopeMode: 'plny', maxProducts: 10000 },
        onChanged: noop,
      }),
    );
    expect(markup).toContain('data-testid="scope-confirm-pilot"');
    expect(markup).toContain('potvrdenie nevyžaduje');
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

/*
 * ODDIEL H (Odhlásenie sa dá vôbec urobiť) TU BOL DO 27. 8. 2026.
 *
 * Vznikol z regresie: prestavba na štyri taby vzala odhlásenie so sebou a
 * používateľ musel čakať, kým session vyprší. Prihlásenie zmizlo celé (D99),
 * takže sa nie je z čoho odhlasovať a sekcia `SignOut` je zmazaná.
 */

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
  });

});
