/**
 * Aura Zľavy — PRVÝ BEH APPKY (users=0) a ľudská hláška pri chýbajúcej session.
 *
 * Reprodukovaný stav (6.8.2026): po čerstvej inštalácii je `users=0`. Appka o
 * tom nepovedala ani slovo — používateľ videl prihlasovací formulár, do ktorého
 * sa nedalo zadať nič platné, a namiesto vysvetlenia dostával červené chyby.
 * Keď potom vložil API kľúč do produkčného shopu, POST spadol na 401 (chýbala
 * session), pole sa vyprázdnilo a on nadobudol dojem, že kľúč je uložený —
 * v skutočnosti `api_key=0`.
 *
 * Tento test stráži tri veci:
 *   1. čistú logiku stavu prvého behu (fail-closed pri neznámom počte),
 *   2. že hláška pri chýbajúcej session VÝSLOVNE hovorí, že sa nič neuložilo,
 *      a nasmeruje na prihlásenie — a že `sudo_required` sa s ňou nezamieňa,
 *   3. že `/login` a `ApiKeyForm` to naozaj KRESLIA — meria sa vykreslený
 *      strom (`renderToStaticMarkup`), nie text zdrojáku.
 *
 * Hranica, ktorú test drží tiež: stav sa odvodzuje z POČTU účtov, nikdy
 * z ich údajov (I1), a hlášky NEúspešného prihlásenia zostávajú generické.
 *
 * ČO SA TU ZMENILO 24. 8. 2026 (audit kvality testov)
 * ---------------------------------------------------
 *  - `read()` prehĺtalo chýbajúci súbor a vracalo `''`. Nad prázdnym reťazcom
 *    prejde KAŽDÉ negatívne tvrdenie, takže premenovanie komponentu by tieto
 *    testy nechalo zelené. Teraz chýbajúci alebo prázdny súbor PADNE.
 *  - Zmizol describe „bootstrap endpoint je read-only…". Bol to blocklist troch
 *    mien (`getByUsername`, `getById`, `passwordHash`), teda nie invariant:
 *    keby endpoint začal vracať `usernames: await users.listUsers()`, všetkých
 *    päť tvrdení by ostalo zelených a verejný endpoint s `auth: 'none'` by
 *    enumeroval účty. To isté sa MERIA v `test/integration/routes-bootstrap.spec.ts`
 *    (`expect(Object.keys(res.body.data)).toEqual(['needsAdmin'])`), takže tu
 *    ostal len duplikát v textovej podobe, ktorý vedel byť falošne zelený.
 *  - Grepy nad `/login/page.tsx` a `ApiKeyForm.tsx` (vrátane porovnania
 *    `setupIndex < formIndex`, čo meralo poradie ZNAKOV v súbore, nie strom)
 *    nahradilo skutočné vykreslenie.
 *
 * ČO SA VYKRESLIŤ NEDÁ A PREČO
 * ----------------------------
 * `environment` je `node` bez DOM a šprint zakazuje pribrať jsdom. Efekty sa
 * pri serverovom renderi nespúšťajú, takže stav, ktorý vzniká až z odpovede
 * servera (`firstRun` po `/api/auth/bootstrap`, `failure`/`stored` po `putKey`),
 * sa nakresliť nedá. `ApiKeyForm.tsx` si preto svoje dva takéto stavy vyčlenil
 * do samostatných komponentov (`NotStoredState`, `VerifyState`) — a tie sa už
 * renderujú priamo. `/login/page.tsx` to zatiaľ neurobil; jeho vetva
 * „needs-admin" ostáva jediné miesto, kde sa meria zdroják, a je to poznačené
 * pri každom takom tvrdení.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// `/login` je klientská stránka a volá `useRouter()`. Bez app routera to
// v teste hodí „invariant expected app router to be mounted"; navigáciu tu
// nič nemeria, takže stačí prázdna náhrada.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }),
}));

import LoginPage from '@/app/login/page';
import { ApiKeyForm, NotStoredState } from '@/components/settings/ApiKeyForm';
import ActionFailurePanel from '@/components/ui/ActionFailure';
import {
  LOGIN_PATH,
  SEED_ADMIN_COMMAND,
  SUDO_REQUIRED_CODE,
  UNAUTHENTICATED_CODE,
  describeActionFailure,
  firstRunStateFromCount,
  isUnauthenticatedCode,
  showsAdminSetup,
} from '@/lib/ui/first-run';

const SRC = join(process.cwd(), 'src');

/**
 * Zdroják komponentu. Chýbajúci alebo prázdny súbor je CHYBA, nie prázdny
 * reťazec: `''` prejde cez každé `not.toContain(...)` a cez každé
 * `not.toMatch(...)`, takže by z testu urobil ozdobu. Predtým to tu bolo
 * `catch { return '' }`.
 */
function read(...parts: string[]): string {
  const path = join(SRC, ...parts);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(
      `Zdroják ${path} sa nedá prečítať, takže tvrdenia nad ním nič nemerajú: ${String(error)}`,
    );
  }
  if (text.trim().length === 0) {
    throw new Error(`Zdroják ${path} je prázdny — negatívne tvrdenia nad ním sú falošne zelené.`);
  }
  return text;
}

/* ═════════════════════════ 1. Stav prvého behu ════════════════════════════ */

describe('firstRunStateFromCount — stav prvého behu z POČTU účtov (I1)', () => {
  it('nula účtov = prvý beh, treba vytvoriť admina', () => {
    expect(firstRunStateFromCount(0)).toBe('needs-admin');
    expect(showsAdminSetup(firstRunStateFromCount(0))).toBe(true);
  });

  it('aspoň jeden účet = bežný prihlasovací formulár', () => {
    expect(firstRunStateFromCount(1)).toBe('ready');
    expect(firstRunStateFromCount(7)).toBe('ready');
    expect(showsAdminSetup(firstRunStateFromCount(1))).toBe(false);
  });

  it('fail-closed: neznámy počet NIKDY netvrdí, že účet neexistuje', () => {
    for (const value of [null, undefined, Number.NaN, Infinity, -1, 1.5]) {
      expect(firstRunStateFromCount(value as number | null)).toBe('unknown');
      expect(showsAdminSetup(firstRunStateFromCount(value as number | null))).toBe(false);
    }
  });
});

describe('SEED_ADMIN_COMMAND — presný príkaz pre človeka v termináli', () => {
  it('je to `docker compose exec` na seed-admin skript (docs/21-RUNBOOKY.md)', () => {
    expect(SEED_ADMIN_COMMAND).toContain('docker compose exec ovl-zliav-app');
    expect(SEED_ADMIN_COMMAND).toContain('scripts/seed-admin.ts');
    expect(SEED_ADMIN_COMMAND).toContain('--disable-warning=MODULE_TYPELESS_PACKAGE_JSON');
  });

  it('neobsahuje žiadne meno ani heslo — tie zadá človek interaktívne (I1)', () => {
    expect(SEED_ADMIN_COMMAND).not.toMatch(/--password|--username|-p\s|admin:/i);
  });
});

/* ══════════════════ 2. Chýbajúca session pri akcii (401) ══════════════════ */

describe('describeActionFailure — 401 bez session je ľudská veta, nie porucha', () => {
  const failure = describeActionFailure(
    { code: UNAUTHENTICATED_CODE, message: 'Session chýba alebo expirovala.' },
    { action: 'Uloženie API kľúča' },
  );

  it('povie, že nie si prihlásený', () => {
    expect(failure.message.toLowerCase()).toContain('nie si prihlásený');
    expect(failure.needsLogin).toBe(true);
  });

  it('VÝSLOVNE povie, že sa nič neuložilo — tichý neúspech je nemožný', () => {
    expect(failure.message).toMatch(/nevykonalo/i);
    expect(failure.message).toMatch(/nič sa nezmenilo|nič neuložilo|nič nezmenilo/i);
  });

  it('nevyzerá ako porucha appky — tón je `attention`, nie `critical`', () => {
    expect(failure.tone).toBe('attention');
  });

  it('technický kód zostáva dostupný v detaile', () => {
    expect(failure.rawCode).toBe(UNAUTHENTICATED_CODE);
  });

  it('`sudo_required` NIE je odhlásenie — nesmie posielať na prihlásenie', () => {
    const sudo = describeActionFailure(
      { code: SUDO_REQUIRED_CODE, message: 'Vyžaduje sa potvrdenie heslom.' },
      { action: 'Uloženie API kľúča' },
    );
    expect(sudo.needsLogin).toBe(false);
    expect(isUnauthenticatedCode(SUDO_REQUIRED_CODE)).toBe(false);
  });

  it('ostatné chyby prechádzajú s hláškou servera a tónom `critical`', () => {
    const other = describeActionFailure(
      { code: 'shop_error', message: 'Shop odmietol kľúč.' },
      { action: 'Uloženie API kľúča' },
    );
    expect(other.message).toBe('Shop odmietol kľúč.');
    expect(other.tone).toBe('critical');
    expect(other.needsLogin).toBe(false);
  });

  it('bez hlášky servera dá zrozumiteľný fallback, nikdy prázdny string', () => {
    expect(describeActionFailure(null, { action: 'Uloženie API kľúča' }).message.length)
      .toBeGreaterThan(10);
    expect(describeActionFailure({ code: 'x' }, { action: 'Uloženie nastavení' }).message.length)
      .toBeGreaterThan(10);
  });
});

/* ═══════════════ 3. Zapojenie do UI (`/login`, `ApiKeyForm`) ══════════════ */

describe('/login kým sa prvý beh nezistí, netvrdí NIČ (vykreslený strom)', () => {
  /**
   * Prvý render stránky — efekt s `/api/auth/bootstrap` v serverovom renderi
   * nebeží, takže je to presne ten stav, ktorý používateľ vidí v prvom okamihu.
   */
  const html = renderToStaticMarkup(createElement(LoginPage));

  it('vykreslí sa čakací stav, nie prázdno', () => {
    // Poistka: keby render vrátil prázdno, negatívne tvrdenia nižšie by boli
    // falošne zelené.
    expect(html.length).toBeGreaterThan(50);
    expect(html).toContain('data-testid="login-loading"');
    expect(html).toContain('aria-busy="true"');
  });

  it('prihlasovací formulár NIE JE bezpodmienečne v strome', () => {
    /*
     * Toto je to, čo pôvodne skúšalo porovnanie `setupIndex < formIndex` nad
     * textom súboru — a čo nemeralo. Formulár stojí za podmienkou; keby ho
     * niekto vytiahol pred vetvenie (alebo zmazal skorý návrat pri
     * `firstRun === null`), objaví sa TU, ešte kým appka nevie, či nejaký účet
     * existuje. Presne to bola chyba zo 6. 8. 2026: slepý formulár.
     */
    expect(html).not.toContain('login-username');
    expect(html).not.toContain('login-password');
    expect(html).not.toContain('login-submit');
  });

  it('a nekreslí ani návod na vytvorenie admina, kým to nevie', () => {
    // Fail-closed má dve strany: netvrdiť „účet neexistuje" je rovnako dôležité
    // ako netvrdiť „prihlás sa".
    expect(html).not.toContain('login-needs-admin');
    expect(html).not.toContain(SEED_ADMIN_COMMAND);
  });
});

describe('/login pri users=0 povie, čo robiť — namiesto slepého formulára', () => {
  /*
   * Vetva „needs-admin" vzniká až z odpovede `/api/auth/bootstrap`, teda
   * z efektu — a ten sa v `renderToStaticMarkup` nespúšťa (viď hlavička).
   * Preto sú tieto tri tvrdenia jediné v tomto súbore, ktoré merajú ZDROJÁK.
   * `read()` už chýbajúci súbor neprehltne, takže aspoň nevedia byť falošne
   * zelené nad prázdnym reťazcom.
   */
  const source = read('app', 'login', 'page.tsx');

  it('zisťuje stav prvého behu z bootstrap endpointu', () => {
    expect(source).toContain('/api/auth/bootstrap');
    expect(source).toMatch(/firstRunStateFromCount|showsAdminSetup|needsAdmin/);
  });

  it('vetva prvého behu existuje a ukazuje presný príkaz na vytvorenie admina', () => {
    expect(source).toContain('SEED_ADMIN_COMMAND');
    expect(source).toContain('login-needs-admin');
    expect(source).toMatch(/needsAdmin\s*\?|showsAdminSetup\(/);
  });

  it('hlášky NEúspešného prihlásenia zostávajú generické (žiadna enumerácia mien)', () => {
    expect(source).not.toMatch(/používateľ .*neexistuje|meno neexistuje|neznámy používateľ/i);
  });
});

describe('ApiKeyForm — tichý neúspech uloženia kľúča je nemožný (vykreslený strom)', () => {
  const prazdny = renderToStaticMarkup(
    createElement(ApiKeyForm, { keyMeta: null, onStored: () => {} }),
  );

  it('kým sa nič neodoslalo, formulár netvrdí ani úspech, ani neúspech', () => {
    expect(prazdny).toContain('data-testid="api-key-form"');
    expect(prazdny).toContain('data-testid="api-key-missing"');
    // Ani zelené „uložené", ani červené „neuložené" — nič sa zatiaľ nestalo.
    expect(prazdny).not.toContain('api-key-stored');
    expect(prazdny).not.toContain('api-key-not-stored');
  });

  it('pole na kľúč je typu heslo a hodnota sa nikam nevypisuje', () => {
    expect(prazdny).toContain('data-testid="api-key-input"');
    expect(prazdny).toMatch(/<input[^>]*type="password"[^>]*data-testid="api-key-input"/);
  });

  it('po neúspechu je na obrazovke výslovné „kľúč sa NEULOŽIL" — s farbou aj značkou', () => {
    /*
     * `NotStoredState` je samostatný komponent práve preto, aby sa tento stav
     * dal vykresliť bez prehliadača (hlavička `ApiKeyForm.tsx` to hovorí
     * rovnako). Meria sa teda výstup, nie výskyt reťazca v zdrojáku.
     */
    const html = renderToStaticMarkup(createElement(NotStoredState));
    expect(html).toContain('data-testid="api-key-not-stored"');
    expect(html).toContain('NEULOŽIL');
    // Tri kanály: farba (trieda), značka (ikona) a slovo.
    expect(html).toContain('class="sig bad"');
    expect(html).toContain('ovl-ic');
  });

  it('panel neúspechu vedie na prihlásenie, keď chýba session', () => {
    const failure = describeActionFailure(
      { code: UNAUTHENTICATED_CODE, message: 'Session chýba alebo expirovala.' },
      { action: 'Uloženie kľúča na zápis zliav' },
    );
    const html = renderToStaticMarkup(
      createElement(ActionFailurePanel, { failure, testId: 'api-key-failure' }),
    );
    expect(LOGIN_PATH).toBe('/login');
    expect(html).toContain(`href="${LOGIN_PATH}"`);
    expect(html).toContain('data-testid="action-failure-login-link"');
    expect(html).toContain('data-tone="attention"');
  });

  it('a pri chybe, ktorá s prihlásením nesúvisí, odkaz na prihlásenie NEponúka', () => {
    // Bez tejto druhej strany by tvrdenie vyššie prešlo aj nad panelom, ktorý
    // dáva odkaz na prihlásenie pri každej chybe — a to je zavádzanie.
    const failure = describeActionFailure(
      { code: 'shop_error', message: 'Shop odmietol kľúč.' },
      { action: 'Uloženie kľúča na zápis zliav' },
    );
    const html = renderToStaticMarkup(
      createElement(ActionFailurePanel, { failure, testId: 'api-key-failure' }),
    );
    expect(html).toContain('Shop odmietol kľúč.');
    expect(html).toContain('data-tone="critical"');
    expect(html).not.toContain(`href="${LOGIN_PATH}"`);
  });

  it('pri chybe zahodí prípadné staré hlásenie o úspechu', () => {
    /*
     * Jediné tvrdenie tejto sekcie, ktoré meria zdroják: reset `stored` sa deje
     * v obsluhe chyby a tú bez prehliadača nespustíme. Nepýtame sa preto na
     * výskyt v CELOM súbore (to by prešlo, aj keby `setStored(null)` stálo
     * kdekoľvek inde), ale na TELO funkcie `fail()` — tej, ktorou prechádza
     * každá chybová cesta. Inak by na obrazovke zostal zelený badge „kľúč
     * uložený" spolu s červenou chybou a používateľ by veril tomu zelenému.
     */
    const source = read('components', 'settings', 'ApiKeyForm.tsx');
    // Telo `fail()` = od hlavičky po prvú zatváraciu zátvorku na úrovni
    // funkcie (dve medzery odsadenia vnútri komponentu).
    const fail = /function fail\([\s\S]*?\n {2}\}/.exec(source)?.[0] ?? '';
    expect(fail, 'funkcia fail() sa v ApiKeyForm.tsx nenašla').not.toBe('');
    expect(fail).toMatch(/setStored\(null\)/);
    expect(fail).toMatch(/setFailure\(/);
  });
});
