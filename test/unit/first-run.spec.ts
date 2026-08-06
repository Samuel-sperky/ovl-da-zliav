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
 *   3. že `/login` a `ApiKeyForm` sú na tieto stavy naozaj zapojené (kontrola
 *      zdrojáku — komponenty sa v `environment: 'node'` renderovať nedajú).
 *
 * Hranica, ktorú test drží tiež: stav sa odvodzuje z POČTU účtov, nikdy
 * z ich údajov (I1), a hlášky NEúspešného prihlásenia zostávajú generické.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

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
/** Chýbajúci súbor = prázdny zdroják, takže padne konkrétna asercia, nie celý suite. */
function read(...parts: string[]): string {
  try {
    return readFileSync(join(SRC, ...parts), 'utf8');
  } catch {
    return '';
  }
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

describe('/login pri users=0 povie, čo robiť — namiesto slepého formulára', () => {
  const source = read('app', 'login', 'page.tsx');

  it('zisťuje stav prvého behu z bootstrap endpointu', () => {
    expect(source).toContain('/api/auth/bootstrap');
    expect(source).toMatch(/firstRunStateFromCount|showsAdminSetup|needsAdmin/);
  });

  it('zobrazí presný príkaz na vytvorenie admina', () => {
    expect(source).toContain('SEED_ADMIN_COMMAND');
    expect(source).toContain('login-needs-admin');
  });

  it('v stave `needs-admin` NEzobrazí prihlasovací formulár', () => {
    // Formulár je za podmienkou, nie bezpodmienečne v strome.
    expect(source).toMatch(/needsAdmin\s*\?|showsAdminSetup\(/);
    const setupIndex = source.indexOf('login-needs-admin');
    const formIndex = source.indexOf('login-username');
    expect(setupIndex).toBeGreaterThan(-1);
    expect(formIndex).toBeGreaterThan(-1);
    // Návod je vetvou PRED formulárom (early return / ternár), nie pod ním.
    expect(setupIndex).toBeLessThan(formIndex);
  });

  it('hlášky NEúspešného prihlásenia zostávajú generické (žiadna enumerácia mien)', () => {
    expect(source).not.toMatch(/používateľ .*neexistuje|meno neexistuje|neznámy používateľ/i);
  });
});

describe('bootstrap endpoint je read-only a vracia LEN príznak, nie údaje účtov', () => {
  const source = read('app', 'api', 'auth', 'bootstrap', 'route.ts');

  it('je `auth: \'none\'` a výhradne GET — inak by ho prvý beh nedosiahol', () => {
    expect(source).toContain("auth: 'none'");
    expect(source).toContain("method: 'GET'");
  });

  it('číta výhradne POČET účtov (`countUsers`), nikdy `getByUsername`/`getById`', () => {
    expect(source).toContain('countUsers');
    expect(source).not.toContain('getByUsername');
    expect(source).not.toContain('getById');
    expect(source).not.toContain('passwordHash');
  });
});

describe('ApiKeyForm — tichý neúspech uloženia kľúča je nemožný', () => {
  const source = read('components', 'settings', 'ApiKeyForm.tsx');

  it('používa `describeActionFailure` a panel, ktorý ponúkne prihlásenie', () => {
    expect(source).toContain('describeActionFailure');
    expect(source).toContain('ActionFailurePanel');
  });

  it('po neúspechu zobrazí výslovné „kľúč sa NEULOŽIL"', () => {
    expect(source).toContain('api-key-not-stored');
  });

  it('panel neúspechu vedie na prihlásenie, keď chýba session', () => {
    const panel = read('components', 'ui', 'ActionFailure.tsx');
    expect(LOGIN_PATH).toBe('/login');
    expect(panel).toContain('LOGIN_PATH');
    expect(panel).toContain('href={LOGIN_PATH}');
    expect(panel).toContain('needsLogin');
  });

  it('pri chybe zahodí prípadné staré hlásenie o úspechu', () => {
    // `stored` sa musí resetovať, inak by na obrazovke zostal zelený badge
    // „kľúč uložený" spolu s chybou a používateľ by veril tomu zelenému.
    expect(source).toMatch(/setStored\(null\)/);
  });
});
