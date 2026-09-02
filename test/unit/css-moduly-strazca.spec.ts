/**
 * Aura Zľavy — STRÁŽCA VŠETKÝCH CSS MODULOV (V6b, 2. 9. 2026; D139, D143, K11).
 *
 * PREČO TENTO SÚBOR VZNIKOL
 * ─────────────────────────
 * Vitest rieši `.module.css` Proxy-om, ktorý na KAŽDÝ kľúč vráti hašované
 * meno. `styles.nz` je v teste `_nz_e472ea` aj vtedy, keď v module žiadne
 * `.nz` NEEXISTUJE — v prehliadači je ten istý kľúč `undefined`, teda
 * `class="undefined"`. Prežilo to 2. 9. 2026 celý deň: prepnutý import
 * v `NewDiscount.tsx` (`zlavy.module.css` → `new-discount.module.css`) nechal
 * v JSX staré mená, **11 z 15 kľúčov v module nebolo** a sprievodca sa
 * rozsypal na jeden stĺpec neštýlovaného textu. Typecheck, lint ani 4651
 * testov to nemali ako zachytiť a vykreslený markup o tom nepovie nič.
 *
 * `nova-zlava-selektory.spec.ts` §A na to reagoval — ale strážil JEDEN modul.
 * Vo V6b si import prepínalo pätnásť obrazoviek, takže ten istý omyl mal
 * ešte šestnásť miest, kde sa mohol stať. Tento súbor je to isté pravidlo
 * ZOVŠEOBECNENÉ: zoznam modulov aj zoznam ich volajúcich sa hľadá na disku,
 * takže nový modul je pod dozorom v tej sekunde, ako ho niekto pridá.
 *
 * ČO SA MERIA — DVA SMERY JEDNÉHO PRAVIDLA
 * ────────────────────────────────────────
 *  1. **Použitý kľúč musí mať v module pravidlo.** Inak je to
 *     `class="undefined"` a vzhľad ticho zmizne.
 *  2. **Deklarovaná trieda musí mať volajúceho.** Inak je to mŕtve CSS
 *     (D139, K11): o mesiac ju niekto upraví v domnení, že niečo kreslí,
 *     a na obrazovke sa nestane nič. Presne to už tento repo raz stálo celý
 *     priechod (`mrtve-triedy.spec.ts`, vrstva `.ovl-*`).
 *
 * Druhý smer našiel 2. 9. 2026 aj DVA selektory, ktoré neboli „nepoužité",
 * ale MŔTVE — cielili na triedu, ktorú v JSX nikto nenastavuje:
 * `.presetSave .presetInput` (vstup nesie globálne `.inp`) a
 * `.dataTable th.num` (ChartTable píše globálne `num`). Oba stratili to, čo
 * mali kresliť, a oba sú opravené na `:global(…)`, nie zmazané. Je to ten
 * istý druh chyby ako `[data-col='select']` v `catalog-table.module.css`.
 *
 * AKO SA DAL TENTO TEST NAPÍSAŤ ZLE
 * ─────────────────────────────────
 *  A. **Zhoda podreťazcov.** `toContain('.name')` je zelené aj vtedy, keď
 *     v module stojí len `.nameRow`. Preto sa mená triedy PARSUJÚ na presnú
 *     množinu a porovnávajú sa množinovo; hranica `(?![a-zA-Z0-9_-])` je
 *     v parseri zabudovaná tým, že meno končí tam, kde končí. Že to naozaj
 *     rozlišuje, dokazuje skupina D nad vymysleným vstupom — parser bez
 *     vlastného testu je len druhá nezmeraná vec.
 *  B. **Cyklus nad prázdnym zoznamom.** Keby sa moduly (alebo ich volajúci)
 *     nenašli, každé tvrdenie by prešlo. Skupina A preto najprv zmeria, že
 *     sa vôbec niečo našlo, a modul BEZ volajúceho je pád — nie ticho.
 *  C. **Komentáre.** `styles.foo` v komentári nie je vykreslená trieda a
 *     naopak — docblocky v tomto repe o starých menách PÍŠU (táto hlavička
 *     tiež). Zdroj aj CSS sa preto čítajú s komentármi prepísanými na
 *     medzery.
 *
 * ČO TENTO STRÁŽCA NEVIE — VYMENOVANÉ, NIE ZAMLČANÉ
 * ─────────────────────────────────────────────────
 *  1. **Vypočítaný kľúč** (`styles[premenná]`, `styles[`a${b}`]`). Taký
 *     prístup sa staticky prečítať nedá. Dnes v `src/` NIE JE ANI JEDEN a
 *     skupina C to drží: keď nejaký pridáš, test PADNE a povie ti, že máš
 *     buď kľúče vypísať, alebo tento strážca rozšíriť. Mlčky prejsť to
 *     nemôže — inak by sa práve tou cestou vrátil `class="undefined"`.
 *  2. **Globálne triedy v `:global(…)`** (`.inp`, `.btn`, `.n`, `num`, `sec`).
 *     Nie sú exportom modulu, takže ich tento súbor z merania VYNÍMA.
 *     Namiesto neho ich strážia `test/unit/mrtve-triedy.spec.ts` (mŕtva
 *     vrstva `.ovl-*` v `globals.css`) a `test/unit/globals-vlna3-chyby.spec.ts`.
 *  3. **`data-*` atribúty v selektoroch.** Selektor môže byť „použitý" a
 *     pritom mŕtvy, keď atribút nikto nevypisuje — tak zmizlo odsadenie
 *     prvej bunky v Produktoch (`[data-col='select']`). Statické meranie
 *     tejto vlastnosti by muselo poznať, čo vypisuje primitívum vo vnútri
 *     cudzieho komponentu; nevie to a preto to netvrdí. Stráži to preklik
 *     v prehliadači (D141) a hlavičky modulov, ktoré pri každom `data-*`
 *     selektore menujú, KTO ten atribút vypisuje.
 *  4. **CSS premenné a tokeny.** To je `dizajn-tokeny-strazca.spec.ts`
 *     (pravidlá 5 a 6) a je to iná otázka — ten sa pýta „je farba na jednom
 *     mieste", tento „kreslí tá trieda vôbec niečo".
 *
 * Vlastník: V6b, posledný agent (zovšeobecnenie §A z `nova-zlava-selektory.spec.ts`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

/* ───────────────────────────────────────────────────────────────────────────
   Čítanie disku
   ─────────────────────────────────────────────────────────────────────────── */

function walk(dir: string, match: RegExp): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path, match));
    else if (match.test(entry.name)) out.push(path);
  }
  return out;
}

/** Cesta relatívne ku koreňu repa — hlásenia musia byť klikateľné. */
const rel = (path: string): string => relative(ROOT, path).split('\\').join('/');

const SRC = resolve(ROOT, 'src');
const MODULE_PATHS: readonly string[] = walk(SRC, /\.module\.css$/).map(rel).sort();
const SOURCE_PATHS: readonly string[] = walk(SRC, /\.tsx?$/).map(rel).sort();

/** Komentár sa nahradí medzerami — dĺžka aj riadky zostanú, aby čísla sedeli. */
const blank = (text: string): string => text.replace(/[^\n]/g, ' ');

/**
 * Zdroj bez komentárov.
 *
 * `//` sa vynecháva iba vtedy, keď pred ním nestojí `:` (`https://`) ani
 * úvodzovka — inak by sa z reťazca s adresou stal komentár a zvyšok riadku
 * by z merania vypadol.
 */
const stripComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, lead: string) => lead + blank(m.slice(lead.length)));

const read = (relPath: string): string => readFileSync(resolve(ROOT, relPath), 'utf8');

/* ───────────────────────────────────────────────────────────────────────────
   Množina DEKLAROVANÝCH tried modulu
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * Mená lokálnych tried modulu — presná množina, nie hľadanie podreťazcov.
 *
 * Postup: komentáre von, `:global(…)` von (jeho obsah nie je export modulu),
 * atribútové selektory von (`[data-x='a.b']` by inak vyzeral ako trieda `b`),
 * telá pravidiel von (hodnota `0.5rem` nie je trieda) a zo zvyšku — teda
 * z čistého selektorového textu — sa vyberú mená za bodkou. Meno končí tam,
 * kde končí; `.name` a `.nameRow` sú preto dve rôzne položky množiny.
 */
export function declaredClasses(css: string): ReadonlySet<string> {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const noGlobal = noComments.replace(/:global\s*\(([^()]*)\)/g, ' ');
  const noAttrs = noGlobal.replace(/\[[^\]]*\]/g, ' ');

  /* Selektory sú to, čo stojí PRED `{`; telo pravidla sa zahodí na `}`. */
  const selectors: string[] = [];
  let buffer = '';
  for (const ch of noAttrs) {
    if (ch === '{') {
      selectors.push(buffer);
      buffer = '';
    } else if (ch === '}') {
      buffer = '';
    } else buffer += ch;
  }

  const names = new Set<string>();
  for (const selector of selectors) {
    for (const m of selector.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)) names.add(m[1]!);
  }
  return names;
}

/* ───────────────────────────────────────────────────────────────────────────
   Množina POUŽITÝCH kľúčov — z tých súborov, ktoré modul naozaj importujú
   ─────────────────────────────────────────────────────────────────────────── */

interface Importer {
  readonly file: string;
  /** Lokálne meno importu. `SalesChart.tsx` má dva moduly a dve mená. */
  readonly ident: string;
  /** Kľúče `ident.x` a `ident['x-y']`. */
  readonly keys: ReadonlySet<string>;
  /** Vypočítané prístupy `ident[…]`, ktoré sa staticky prečítať nedajú. */
  readonly dynamic: readonly string[];
}

interface ModuleUnderGuard {
  readonly path: string;
  readonly declared: ReadonlySet<string>;
  readonly importers: readonly Importer[];
}

function collect(): readonly ModuleUnderGuard[] {
  const importers = new Map<string, Importer[]>(MODULE_PATHS.map((p) => [p, []]));

  for (const file of SOURCE_PATHS) {
    const code = stripComments(read(file));
    for (const imp of code.matchAll(/import\s+(\w+)\s+from\s+'@\/([^']+\.module\.css)'/g)) {
      const modulePath = `src/${imp[2]!}`;
      const bucket = importers.get(modulePath);
      /*
       * Import na neexistujúci modul by tsc zastavil, ale keby sa alias `@/`
       * niekedy prestal mapovať na `src/`, tento cyklus by mlčky nezmeral
       * NIČ. Preto je to pád, nie `continue`.
       */
      expect(bucket, `${file} importuje ${modulePath}, taký modul na disku nie je`).toBeDefined();
      if (bucket === undefined) continue;

      const ident = imp[1]!;
      const keys = new Set<string>();
      for (const m of code.matchAll(new RegExp(`\\b${ident}\\.([A-Za-z0-9_]+)`, 'g')))
        keys.add(m[1]!);
      for (const m of code.matchAll(new RegExp(`\\b${ident}\\[\\s*'([^'\\n]*)'\\s*\\]`, 'g')))
        keys.add(m[1]!);

      const dynamic: string[] = [];
      for (const m of code.matchAll(new RegExp(`\\b${ident}\\[[^\\]\\n]*\\]`, 'g'))) {
        if (!/\[\s*'[^'\n]*'\s*\]/.test(m[0])) dynamic.push(m[0]);
      }

      bucket.push({ file, ident, keys, dynamic });
    }
  }

  return MODULE_PATHS.map((path) => ({
    path,
    declared: declaredClasses(read(path)),
    importers: importers.get(path)!,
  }));
}

const MODULES = collect();

const usedKeys = (module: ModuleUnderGuard): ReadonlySet<string> =>
  new Set(module.importers.flatMap((i) => [...i.keys]));

/* ═════════ A. Meranie vôbec niečo našlo ══════════════════════════════════ */

describe('A. strážca má čo merať', () => {
  it('moduly aj zdroje sa na disku našli', () => {
    /*
     * Bez tejto poistky by cyklus nižšie prešiel aj nad prázdnym zoznamom —
     * presne tak vznikol zelený test o mŕtvych selektoroch v Produktoch.
     * Čísla sú DOLNÉ hranice, nie presné počty: nový modul nemá test lámať.
     */
    expect(MODULE_PATHS.length).toBeGreaterThanOrEqual(17);
    expect(SOURCE_PATHS.length).toBeGreaterThan(100);
    const declared = MODULES.reduce((n, m) => n + m.declared.size, 0);
    const used = MODULES.reduce((n, m) => n + usedKeys(m).size, 0);
    expect(declared).toBeGreaterThan(300);
    expect(used).toBeGreaterThan(300);
  });

  it('každý modul má aspoň jeden súbor, ktorý ho importuje', () => {
    /* Modul bez volajúceho je mŕtvy CELÝ (D139) a v cykle nižšie by
       vyzeral ako „bez chyby" — nemal by totiž ani jeden použitý kľúč. */
    const osirele = MODULES.filter((m) => m.importers.length === 0).map((m) => m.path);
    expect(osirele, 'tento modul nikto neimportuje — je mŕtvy celý').toEqual([]);
  });

  it('žiadny modul sa neimportuje pod dvoma menami v jednom súbore', () => {
    /*
     * `SalesChart.tsx` importuje DVA moduly (`chartStyles` a `styles`) a to
     * je v poriadku. Dva rôzne názvy pre TEN ISTÝ modul v jednom súbore by
     * ale znamenali, že meranie kľúčov závisí od toho, ktoré meno kde stojí
     * — a to je presne ten druh nejednoznačnosti, ktorý strážca nesmie mať.
     */
    const kolizie: string[] = [];
    for (const module of MODULES) {
      const perFile = new Map<string, string[]>();
      for (const imp of module.importers) {
        const list = perFile.get(imp.file) ?? [];
        list.push(imp.ident);
        perFile.set(imp.file, list);
      }
      for (const [file, idents] of perFile) {
        if (idents.length > 1) kolizie.push(`${file} → ${module.path} ako ${idents.join(', ')}`);
      }
    }
    expect(kolizie).toEqual([]);
  });
});

/* ═════════ B. Prvý smer: použitý kľúč MÁ v module pravidlo ═══════════════ */

describe('B. `styles.X` sa v module nájde — inak je to class="undefined"', () => {
  for (const module of MODULES) {
    it(`${module.path}: ani jeden použitý kľúč nechýba`, () => {
      const chybajuce: string[] = [];
      for (const imp of module.importers) {
        for (const key of imp.keys) {
          if (!module.declared.has(key)) chybajuce.push(`${imp.file} → ${imp.ident}.${key}`);
        }
      }
      expect(
        chybajuce,
        `tieto kľúče v ${module.path} nie sú — v prehliadači je to class="undefined"`,
      ).toEqual([]);
    });
  }
});

/* ═════════ C. Vypočítaný kľúč: strážca nemá tichú dieru ═════════════════ */

describe('C. vypočítaný kľúč sa nezmerá, takže sa nesmie objaviť', () => {
  it('nikde nie je `styles[premenná]` ani `styles[`a${b}`]`', () => {
    const najdene = MODULES.flatMap((m) =>
      m.importers.flatMap((i) => i.dynamic.map((d) => `${i.file} → ${d}`)),
    );
    expect(
      najdene,
      'taký kľúč sa staticky prečítať nedá: vypíš kľúče, alebo rozšír tohto strážcu ' +
        'a napíš do hlavičky, čo presne vie merať',
    ).toEqual([]);
  });
});

/* ═════════ D. Druhý smer: deklarovaná trieda MÁ volajúceho (D139, K11) ══ */

describe('D. mŕtva trieda v module je dlh, nie neškodnosť', () => {
  for (const module of MODULES) {
    it(`${module.path}: ani jedna deklarovaná trieda nezostala bez volajúceho`, () => {
      const used = usedKeys(module);
      const mrtve = [...module.declared].filter((name) => !used.has(name)).sort();
      expect(
        mrtve,
        `tieto triedy ${module.path} nikto nekreslí — buď ich použi, alebo zmaž (D139, K11). ` +
          'Ak selektor cieli na GLOBÁLNU triedu, patrí do `:global(…)`',
      ).toEqual([]);
    });
  }
});

/* ═════════ E. Parser sám: rozlišuje `.name` od `.nameRow`? ══════════════ */

describe('E. parser tried je presný, nie „obsahuje"', () => {
  it('`.name` a `.nameRow` sú dve rôzne triedy', () => {
    /*
     * Toto je to jediné tvrdenie, ktoré meria SÁM STRÁŽCA, a je nosné:
     * `toContain('.name')` je zelené aj nad modulom, kde je len `.nameRow`,
     * a taký strážca by chýbajúci kľúč `name` prehlásil za nájdený. Pri
     * mutačnom overení `.ovl-btn` → `.ovl-btnX` presne takto zostal zelený
     * starší test (`mrtve-triedy.spec.ts`).
     */
    const found = declaredClasses('.nameRow { color: red }');
    expect([...found]).toEqual(['nameRow']);
    expect(found.has('name')).toBe(false);
  });

  it('`:global(…)` nie je export modulu', () => {
    const found = declaredClasses('.rail :global(.inp) { flex: 1 }');
    expect([...found]).toEqual(['rail']);
  });

  it('hodnota v tele pravidla ani atribút nie sú trieda', () => {
    const found = declaredClasses(
      ".cell[data-col='a.b'] { padding: 0.5rem; background: url(x.png) }",
    );
    expect([...found]).toEqual(['cell']);
  });

  it('vnorené pravidlá (`@media`) sa čítajú tiež', () => {
    const found = declaredClasses('@media (max-width: 900px) { .stack > .item:hover { gap: 0 } }');
    expect([...found].sort()).toEqual(['item', 'stack']);
  });

  it('komentár nie je deklarácia', () => {
    expect([...declaredClasses('/* .zmazane bolo tu */ .zive { gap: 0 }')]).toEqual(['zive']);
  });

  it('a komentár v ZDROJI nie je použitie', () => {
    /* Druhá polovica tej istej pasce: mutácia v komentári PADNÚŤ nesmie,
       inak by strážca kryl mená, ktoré len niekto spomenul v docblocku. */
    const code = stripComments("/* styles.zmazane */\nconst a = styles.zive;\n// styles.tiez\n");
    expect([...code.matchAll(/\bstyles\.([A-Za-z0-9_]+)/g)].map((m) => m[1])).toEqual(['zive']);
  });
});
