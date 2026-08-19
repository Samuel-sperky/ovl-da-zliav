/**
 * Aura Zľavy — PÍSMO SA DODÁVA S APPKOU (kontrakt UX/dizajn 19. 8. 2026, vlna F).
 *
 * Tento súbor existuje kvôli chybe, ktorá prežila celý vývoj appky a nikto si ju
 * nevšimol: `--ovl-font` deklaroval `'Inter'`, v repozitári však nebol ani jeden
 * súbor písma, žiadny `@font-face` ani `next/font`. Na Windows PC, kde appka
 * beží, Inter nainštalovaný nie je — takže sa celý čas vykresľovala v Segoe UI
 * a každé rozhodnutie o typografii sa robilo proti písmu, ktoré nikto nevidel.
 * Nič nespadlo, nič nevyhodilo chybu. Presne preto to musí strážiť test.
 *
 * ŠTYRI VECI, KTORÉ SA TU NESMÚ POKAZIŤ:
 *
 *  A. **Názov rodiny musí sedieť na balík.** Predtým tu stálo `'Inter var'`,
 *     čo nie je názov žiadnej rodiny — prehliadač ho ticho preskočil. Test
 *     preto číta názov rodiny zo SKUTOČNÉHO CSS balíka, nie z konštanty.
 *
 *  B. **Písmo musí byť variabilné.** `globals.css` používa rezy 550, 620, 640,
 *     650, 660 a 680. Statický Inter má len 100–900 po stovkách a tieto by sa
 *     zaokrúhlili — hierarchia postavená na jemných rozdieloch by zmizla.
 *
 *  C. **Slovenčina potrebuje latin-ext.** Bez tejto podmnožiny by č, š, ž, ť,
 *     ľ a ô vypadli do náhradného písma uprostred slova.
 *
 *  D. **Žiadna sieť (I6).** Písmo sa načítava z `node_modules`, nikdy z CDN.
 *
 * Vlastník: vlna F, kontrakt UX/dizajn 19. 8. 2026.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const GLOBALS = read('../../src/app/globals.css');
const ZLAVY_CSS = read('../../src/components/campaigns/zlavy.module.css');

/**
 * Všetky zdroje komponentov ako jeden reťazec.
 *
 * Slúži na jedinú, ale zásadnú otázku: KRESLÍ ten selektor vôbec niekto?
 * 19. 8. 2026 sa ukázalo, že oprava rol popiskov (D2) siahla na .ovl-card,
 * .ovl-table a .ovl-eyebrow — a ani jeden z nich nepoužíva žiadny komponent.
 * Test bol zelený a obrazovky boli pritom rozbité, lebo živé hlavičky kreslí
 * table.tbl thead th a .zlist-h. Odvtedy platí: o čom tento súbor niečo
 * tvrdí, to musí byť v kóde nájditeľné.
 */
function zdrojeKomponentov(): string {
  const koren = fileURLToPath(new URL('../../src', import.meta.url));
  const out: string[] = [];
  const chod = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = dir + '/' + e.name;
      if (e.isDirectory()) chod(p);
      else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) {
        out.push(readFileSync(p, 'utf8'));
      }
    }
  };
  chod(koren);
  return out.join('\n');
}
const KOMPONENTY = zdrojeKomponentov();
const LAYOUT = read('../../src/app/layout.tsx');
const BALIK_WGHT = read('../../node_modules/@fontsource-variable/inter/wght.css');

/** Prvá rodina zo zásobníka `--ovl-font`. */
function prvaRodina(): string {
  const m = GLOBALS.match(/--ovl-font:\s*([^;]+);/);
  if (!m) throw new Error('--ovl-font sa nenašiel');
  return m[1]!.split(',')[0]!.trim().replace(/^['"]|['"]$/g, '');
}

/** Názov rodiny, ktorý naozaj deklaruje nainštalovaný balík. */
function rodinaZBalika(): string {
  const m = BALIK_WGHT.match(/font-family:\s*'([^']+)'/);
  if (!m) throw new Error('balík nedeklaruje font-family');
  return m[1]!;
}

describe('appka dodáva písmo, ktoré deklaruje', () => {
  it('zásobník začína presne tou rodinou, ktorú definuje balík', () => {
    // Toto je celé jadro chyby: názov, ktorý sa nezhoduje, prehliadač preskočí
    // a NIKDE to nenahlási.
    expect(prvaRodina()).toBe(rodinaZBalika());
  });

  it('layout načítava rez aj kurzívu z balíka', () => {
    expect(LAYOUT).toContain("@fontsource-variable/inter/wght.css");
    expect(LAYOUT).toContain("@fontsource-variable/inter/wght-italic.css");
  });

  it('balík je v závislostiach, nie len v node_modules', () => {
    const pkg = JSON.parse(read('../../package.json')) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.['@fontsource-variable/inter']).toBeTruthy();
  });
});

describe('písmo je variabilné, lebo appka to potrebuje', () => {
  it('balík pokrýva plný rozsah rezov', () => {
    expect(BALIK_WGHT).toMatch(/font-weight:\s*100\s+900/);
  });

  it('appka naozaj používa rezy mimo stoviek', () => {
    // Keby ich prestala používať, prestal by platiť dôvod pre variabilné písmo
    // a tento test by mal spadnúť, nech sa rozhodnutie prehodnotí.
    const rezy = [...GLOBALS.matchAll(/font-weight:\s*(\d{3})\b/g)].map((m) => Number(m[1]));
    const medzistupne = [...new Set(rezy.filter((w) => w % 100 !== 0))].sort((a, b) => a - b);
    expect(medzistupne.length).toBeGreaterThan(0);
  });
});

describe('slovenčina sa vykreslí celá', () => {
  it('balík obsahuje podmnožinu latin-ext', () => {
    expect(BALIK_WGHT).toContain('latin-ext');
  });

  it('rozsah latin-ext pokrýva slovenské znaky', () => {
    // U+0100–U+017F je Latin Extended-A: č(010D) š(0161) ž(017E) ť(0165)
    // ľ(013E) ĺ(013A) ň(0148) ď(010F) ŕ(0155). Bez neho by slovo „Zľavy"
    // vykreslili dve rôzne písma.
    const blok = BALIK_WGHT.slice(BALIK_WGHT.indexOf('/* inter-latin-ext-wght-normal */'));
    const m = blok.match(/unicode-range:\s*([^;]+);/);
    expect(m?.[1]).toContain('U+0100-02BA');
  });
});

describe('appka po písmo nesiaha do siete (I6)', () => {
  for (const [nazov, obsah] of [
    ['globals.css', GLOBALS],
    ['layout.tsx', LAYOUT],
  ] as const) {
    it(`${nazov} neodkazuje na externý zdroj písma`, () => {
      expect(obsah).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com|next\/font\/google/);
    });
  }
});

describe('tri roly popiskov sa dajú rozoznať (D2)', () => {
  /** Vlastnosti pravidla pre daný selektor. */
  function pravidlo(selektor: string, css: string = GLOBALS): string {
    const i = css.indexOf(selektor + ' {');
    if (i < 0) throw new Error(`selektor ${selektor} sa nenašiel`);
    return css.slice(i, css.indexOf('}', i));
  }

  /** Kotviaca trieda selektora — prvá trieda zľava. */
  function kotva(selektor: string): string {
    const m = selektor.match(/\.([a-zA-Z][\w-]*)/);
    if (!m) throw new Error(`selektor ${selektor} nemá triedu`);
    return m[1]!;
  }

  /**
   * ŽIVÉ selektory popiskov. Kto sem pridá ďalší, musí zároveň zniesť dôkaz,
   * že ho niekto kreslí — inak sa zopakuje chyba z 19. 8. 2026.
   */
  const ZIVE = [
    'table.tbl thead th',
    '.zlist-h',
    '.sec-h h2',
    '.kpi .k',
  ] as const;

  for (const sel of ZIVE) {
    it(`${sel} naozaj niekto kreslí`, () => {
      expect(
        KOMPONENTY,
        `${sel} je mŕtvy selektor — tvrdenia o ňom nemerajú nič`,
      ).toContain(kotva(sel));
    });
  }

  it('hlavičky stĺpcov sú na oboch miestach rovnaké', () => {
    // Zoznam zliav kreslí hlavičky vlastným selektorom. Keď sa rozídu, dve
    // tabuľky v tej istej appke vyzerajú ako z dvoch rôznych appiek.
    for (const sel of ['table.tbl thead th', '.zlist-h']) {
      expect(pravidlo(sel), sel).toContain('font-size: var(--ovl-fs-eyebrow)');
      expect(pravidlo(sel), sel).toContain('font-weight: 600');
      expect(pravidlo(sel), sel).toContain('letter-spacing: 0.06em');
    }
  });

  it('popisok dlaždice pod dominantou nemá verzálky', () => {
    // .cap sedí priamo pod 64 px číslom na Novej zľave.
    expect(pravidlo('.cap', ZLAVY_CSS)).not.toContain('text-transform: uppercase');
    expect(pravidlo('.cap', ZLAVY_CSS)).toContain('var(--ovl-fs-label-tile)');
  });

  it('popisok sekcie je tmavší a hrubší než popisok stĺpca', () => {
    // Sekcia pomenúva oblasť, stĺpec len zvislý rad. Keď majú rovnakú farbu
    // aj hrúbku, obrazovka nemá hierarchiu — presne to bol defekt D2.
    expect(pravidlo('.sec-h h2')).toContain('color: var(--ink2)');
    expect(pravidlo('.sec-h h2')).toContain('font-weight: 700');
    expect(pravidlo('table.tbl thead th')).toContain('color: var(--dim)');
    expect(pravidlo('table.tbl thead th')).toContain('font-weight: 600');
  });

  it('popisok dlaždice nemá verzálky, aby nesúperil s číslom nad sebou', () => {
    expect(pravidlo('.kpi .k')).not.toContain('text-transform: uppercase');
  });

  it('popisky nepoužívajú zlatú — akcent je v tejto palete jediný (R5)', () => {
    for (const sel of ZIVE) {
      expect(pravidlo(sel), sel).not.toContain('var(--gold');
    }
  });
});

describe('tabulárne číslice platia pre celú appku', () => {
  it('sú nastavené na body, nie lepené po komponentoch', () => {
    const body = GLOBALS.slice(GLOBALS.indexOf('body {', GLOBALS.indexOf('background: var(--paper)') - 200));
    expect(body).toContain('tabular-nums');
  });
});
