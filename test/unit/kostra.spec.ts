/**
 * Aura Zľavy — KOSTRA APPKY (kontrakt kostry 19. 8. 2026).
 *
 * Tento súbor vznikol z chyby, ktorá sa neprejaví ani typechekom, ani lintom,
 * ani žiadnym existujúcim testom — len rozpadnutou obrazovkou.
 *
 * Nový ľavý panel dostal triedu `.side`. Tá už v appke existovala: detail zľavy
 * ňou označuje popisok vedľa dominanty (`<div className="side lvl-3">`) a dva
 * CSS moduly majú svoje `styles.side`. Globálne pravidlo `.side { height: 100vh;
 * background: var(--paper3); border-right: 1px solid }` sa naň okamžite chytilo,
 * takže z popisku „fronta má túto zľavu vybavenú" sa stal 700 px vysoký sivý
 * blok a dominanta „21 / 21" spadla na jeho spodok.
 *
 * ČO SA TU STRÁŽI
 * ---------------
 *
 * 1. **Triedy kostry sú vyhradené.** Každá z nich smie byť v `src/` len tam,
 *    kde ju kostra kreslí. Keď ju použije ktorýkoľvek iný komponent, test
 *    spadne — a spadne PREDTÝM, než si to niekto všimne na snímke.
 *
 * 2. **Chróm je jeden vodorovný riadok.** Do 19. 8. boli tri (pruh PRODUKCIA,
 *    hlavička so štyrmi tabmi, stavový pruh) a appka začínala pod prehybom.
 *
 * 3. **Trvalé fakty nie sú v topbare.** Kľúč a rozpočet patria do päty panela;
 *    v jednoriadkovom topbare sa štyri menovky na 1280 px navzájom odsekli.
 *
 * Vlastník: kontrakt kostry, 19. 8. 2026.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

/** Všetky zdroje v `src/` ako [cesta, obsah]. */
function zdroje(): readonly (readonly [string, string])[] {
  const out: (readonly [string, string])[] = [];
  const chod = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) chod(p);
      else if (/\.(tsx?|css)$/.test(e.name)) out.push([p, readFileSync(p, 'utf8')] as const);
    }
  };
  chod(SRC);
  return out;
}

/**
 * Zdroj bez komentárov.
 *
 * Bez tohto krok tento test meral PRÓZU: `.shell` sa trafil do slovenskej
 * vety „tú vlastní shell appky" a `.topbar` do komentárov, ktoré vysvetľujú,
 * prečo topbar existuje. Test potom hlásil kolízie, ktoré nikde neboli —
 * teda meral niečo iné než to, o čom tvrdil, že to meria.
 */
function bezKomentarov(obsah: string): string {
  return obsah
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const ZDROJE = zdroje().map(([p, obsah]) => [p, bezKomentarov(obsah)] as const);
const AS = (p: string) => p.replace(/\\/g, '/');

const SHELL = AS(`${SRC}/components/layout/AppShell.tsx`);
const GLOBALS = AS(`${SRC}/app/globals.css`);

/**
 * Triedy, ktoré patria výhradne kostre.
 *
 * `shell-side` sa tak menuje zámerne a nie `side`: krátky názov už bol
 * obsadený. Kto sem pridá ďalšiu triedu, musí zvoliť názov, ktorý v `src/`
 * ešte nie je — test mu to povie.
 */
const VYHRADENE = ['shell', 'shell-main', 'shell-side', 'shell-brand', 'shell-side-foot', 'topbar'] as const;

describe('triedy kostry nekolidujú s ničím v appke', () => {
  for (const trieda of VYHRADENE) {
    it(`.${trieda} používa len kostra`, () => {
      /*
       * Hľadá sa POUŽITIE triedy, nie slovo:
       *  · v JSX ako `className="… trieda …"`,
       *  · v CSS ako selektor `.trieda` nasledovaný medzerou, `{`, `,` alebo `:`.
       * Hranica `[\w-]` na oboch stranách je nutná, aby `shell-side`
       * nezachytilo `shell-side-foot` a naopak.
       */
      const re = new RegExp(
        String.raw`className=[^>]*\b${trieda}\b` + '|' + String.raw`\.${trieda}(?![\w-])\s*[{,:.\s]`,
      );
      const cudzie = ZDROJE.filter(([p, obsah]) => {
        const cesta = AS(p);
        if (cesta === SHELL || cesta === GLOBALS) return false;
        return re.test(obsah);
      }).map(([p]) => AS(p).replace(AS(SRC), 'src'));

      expect(
        cudzie,
        `.${trieda} je trieda kostry — v inom komponente prepíše jeho vzhľad`,
      ).toEqual([]);
    });
  }
});

describe('chróm je jeden vodorovný riadok', () => {
  const shell = readFileSync(fileURLToPath(new URL('../../src/components/layout/AppShell.tsx', import.meta.url)), 'utf8');

  it('nad obsahom je práve jeden topbar', () => {
    expect(shell.split('className="topbar"').length - 1).toBe(1);
  });

  it('pruh PRODUKCIA je v topbare, nie nad ním', () => {
    const topbar = shell.slice(shell.indexOf('className="topbar"'), shell.indexOf('</div>', shell.indexOf('className="topbar"')));
    expect(topbar).toContain('<ProductionBar />');
  });

  it('stav appky sa čita RAZ pre celý shell', () => {
    // Dve čítania = dve rovnaké požiadavky na /api/status pri každom obnovení.
    // Počíta sa PRIRADENIE, nie zmienka — inak sa test trafí do doc-bloku,
    // ktorý to pravidlo vysvetľuje.
    const volania = bezKomentarov(shell).match(/=\s*useStatus\(\)/g) ?? [];
    expect(volania).toHaveLength(1);
  });
});

describe('trvalé fakty sú v päte panela, nie v topbare', () => {
  const shell = readFileSync(fileURLToPath(new URL('../../src/components/layout/AppShell.tsx', import.meta.url)), 'utf8');
  const bar = readFileSync(fileURLToPath(new URL('../../src/components/layout/StatusBar.tsx', import.meta.url)), 'utf8');

  it('pruh sa kreslí na dvoch miestach s rôznym rozsahom', () => {
    expect(shell).toContain('place="topbar"');
    expect(shell).toContain('place="side"');
  });

  it('kľúč a rozpočet patria panelu, zápisy a katalóg topbaru', () => {
    for (const [testId, kde] of [
      ['status-key', 'side'],
      ['status-budget', 'side'],
      ['status-writes', 'topbar'],
      ['status-catalog', 'topbar'],
    ] as const) {
      const riadok = bar.split('\n').find((l) => l.includes(`'${testId}'`));
      expect(riadok, testId).toBeTruthy();
      expect(riadok, testId).toContain(`where: '${kde}'`);
    }
  });

  it('čas a tlačidlo Obnoviť sú len tam, kde majú zmysel', () => {
    // V päte panela by tlačidlo Obnoviť bolo druhé a používateľ by nevedel,
    // ktoré z nich čo obnoví.
    expect(bar).toContain("place === 'side' ? null : <Tail state={state} />");
  });
});
