/**
 * Aura Zľavy — ZNAČKA STAVU JE IKONA, NIE ZNAK V CSS (šprint dokončenia, W1).
 *
 * Tento súbor je poistka na prechod, ktorý W1 dokončil: rodina tried `.sig`,
 * `.flag` a `.state` kreslila druhý kanál stavu znakmi v `content:` v
 * pseudo-prvku `::before` (`✓ ▲ ✕ ◆ ○ ● ·`) a odteraz ho kreslí `<Icon>` cez
 * obaly z `ui/StatusMark.tsx`.
 *
 * PREČO TENTO SÚBOR EXISTUJE (a prečo ho nestačí nahradiť okom)
 * ------------------------------------------------------------
 *
 * Ani jedna z chýb, ktoré tu strážime, nič nezhodí. Vyzerajú ako preklep:
 *
 *  1. Keby niekto vrátil do `globals.css` `.sig.ok::before { content: '✓' }`,
 *     stav by mal značku DVAKRÁT — ikonu aj znak vedľa nej.
 *  2. Keby niekto pridal ďalšie miesto s triedou `.sig ok` a zabudol na
 *     `<SigMark>`, stav by tam ostal BEZ značky. Farba aj slovo tam budú,
 *     takže nič nespadne a pod deuteranopiou zmizne rozdiel.
 *  3. Keby sa maska zámku vrátila do CSS, cesta ikony `lock` by bola v repe
 *     dvakrát a pri zmene tvaru by sa ticho rozišla.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 *  A. **Test musí merať ŽIVÉ selektory.** 19. 8. 2026 sa ukázalo, že test o
 *     `.ovl-card`, `.ovl-table` a `.ovl-eyebrow` svietil zeleno, kým živé
 *     hlavičky kreslil `table.tbl thead th`. Preto sa tu o každej rodine
 *     tried najprv dokazuje, že ju vôbec niekto kreslí.
 *  B. **Mŕtvosť triedy sa NEDÁ dokázať grepom na literál.** Triedy skladajú
 *     `sigClass()` (`dashboard/live-status-model.ts`), `toneSigClass()` a mapa
 *     `TONE_SIG_CLASS` (`ui/blocker-look.ts`) — reťazec `"sig lock"` v zdroji
 *     nie je nikde, a pritom pri pilotnom rozsahu reálne vznikne. Kto sa tu
 *     bude opierať o hľadanie literálu, dokáže si nepravdu.
 *  C. **Emoji sa hľadá na POVRCHU, nie v komentároch.** Štyri hlavičky v
 *     `src/` zámerne citujú `🔒`, keď vysvetľujú, prečo maska vznikla a prečo
 *     musela skončiť. To je história zapísaná v komentári, nie znak, ktorý
 *     appka nakreslí. Preto sa pred hľadaním komentáre odstrihnú.
 *  D. **`✓` a `–` sú v CSS povolené, ale len mimo rodiny `.sig`.** Kreslí ich
 *     natívny checkbox. `▸`/`▾` kreslí `<details>` a `≈` je typografický znak
 *     odhadu (P7) — ikona „minus" by z „nevieme" spravila nulu.
 *  E. **Holá `.sig` bez tónu je ZÁMER, nie zabudnuté miesto.**
 *     `campaigns/BlockerList.tsx` ňou dáva závažnosti tvar značky, ale ani
 *     farbu, ani glyf — tie kóduje spôsob riešenia vedľa. Preto sa párovanie
 *     „hostiteľ ↔ značka" vzťahuje len na hostiteľov S TÓNOM.
 *
 * Vlastník: W1, šprint dokončenia 19. 8. 2026.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const GLOBALS_RAW = read('../../src/app/globals.css');

/** Odstrihne `/* … *\/` a `// …`, aby sa história v komentároch nemerala ako povrch. */
function bezKomentarov(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

const GLOBALS = bezKomentarov(GLOBALS_RAW);

interface Zdroj {
  cesta: string;
  telo: string;
}

/**
 * Všetky zdroje pod `src/` ako zoznam.
 *
 * Slúži na jedinú, ale zásadnú otázku: KRESLÍ ten selektor vôbec niekto?
 * (pozri bod A hlavičky)
 */
function zdroje(): Zdroj[] {
  const koren = fileURLToPath(new URL('../../src', import.meta.url));
  const out: Zdroj[] = [];
  const chod = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) chod(p);
      else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) {
        out.push({ cesta: p.replace(/\\/g, '/'), telo: readFileSync(p, 'utf8') });
      }
    }
  };
  chod(koren);
  return out;
}

const ZDROJE = zdroje();
const KOMPONENTY = ZDROJE.map((z) => z.telo).join('\n');
const KOMPONENTY_POVRCH = ZDROJE.map((z) => bezKomentarov(z.telo)).join('\n');

/** Rozreže CSS na pravidlá `selektor { telo }`. */
function pravidla(css: string): { selektor: string; telo: string }[] {
  const out: { selektor: string; telo: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    out.push({ selektor: m[1]!.trim(), telo: m[2]! });
  }
  return out;
}

const PRAVIDLA = pravidla(GLOBALS);

/** Znaky, ktoré rodina `.sig`/`.flag`/`.state` kreslila do 19. 8. 2026. */
/**
 * Znaky, ktoré rodina `.sig`/`.flag`/`.state` kreslila do 19. 8. 2026.
 *
 * `✓` je medzi nimi, hoci ho kreslí aj natívny checkbox — bez neho by sa
 * vrátený `.sig.ok::before { content: '✓' }` chytil len na prvom tvrdení
 * (rodina `.sig` nemá `content`), nie na tomto. Selektory, ktoré `✓` a `–`
 * kresliť SMÚ, sú vymenované nižšie: je to natívny checkbox, nie stav.
 */
const STAVOVE_ZNAKY = ['○', '◆', '●', '▲', '✕', '·', '✓'];

/** Selektory, ktoré smú kresliť znak z `STAVOVE_ZNAKY` — a prečo. */
const POVOLENE_SELEKTORY: Readonly<Record<string, string>> = {
  '.cb:checked::after': 'natívny checkbox — fajka je jeho vlastný ovládací prvok',
  '.cb:indeterminate::after': 'natívny checkbox — čiastočný výber',
};

/* ═════════════════════ 1. Rodiny tried sú živé (bod A) ═════════════════════ */

describe('o čom tento test tvrdí, to niekto naozaj kreslí', () => {
  it('rodina .sig je v zdrojoch komponentov nájditeľná', () => {
    expect(/className=(?:"sig|\{sigClass\(|\{toneSigClass\()/.test(KOMPONENTY_POVRCH)).toBe(
      true,
    );
  });

  it('skladacie funkcie tried existujú — literál "sig lock" v zdroji nie je (bod B)', () => {
    expect(KOMPONENTY.includes('export function sigClass')).toBe(true);
    expect(KOMPONENTY.includes('export function toneSigClass')).toBe(true);
    // Na POVRCHU (bez komentárov) literál nie je — `live-status-model.ts` ho
    // cituje v hlavičke práve preto, aby to nikto nepoužil ako dôkaz mŕtvosti.
    expect(KOMPONENTY_POVRCH.includes('"sig lock"')).toBe(false);
  });

  it('obaly značiek z ui/StatusMark.tsx sa naozaj používajú', () => {
    for (const obal of ['SigMark', 'ToneSigMark', 'FlagMark', 'StateMark']) {
      const pouzitia = ZDROJE.filter(
        (z) => !z.cesta.endsWith('ui/StatusMark.tsx') && z.telo.includes(`<${obal}`),
      );
      expect(pouzitia.length, `${obal} nikto nekreslí`).toBeGreaterThan(0);
    }
  });
});

/* ═══════════════ 2. Stavová značka nie je v CSS (bod 1 hlavičky) ═══════════ */

describe('stavovú značku už nekreslí CSS', () => {
  it('žiadne pravidlo rodiny .sig/.flag/.state nedeklaruje content', () => {
    const vinnici = PRAVIDLA.filter(
      (p) =>
        /\.(sig|flag|state)\b/.test(p.selektor) &&
        /content:\s*(['"])(?!\1)/.test(p.telo),
    ).map((p) => p.selektor);
    expect(vinnici).toEqual([]);
  });

  it('stavové znaky sa v globals.css nevyskytujú v žiadnom content:', () => {
    const najdene: string[] = [];
    for (const p of PRAVIDLA) {
      if (p.selektor in POVOLENE_SELEKTORY) continue;
      const m = p.telo.match(/content:\s*['"]([^'"]*)['"]/);
      if (!m) continue;
      for (const znak of STAVOVE_ZNAKY) {
        if (m[1]!.includes(znak)) najdene.push(`${p.selektor} → ${m[1]}`);
      }
    }
    expect(najdene).toEqual([]);
  });

  it('maska zámku je zrušená a cesta ikony lock je v repe raz (bod 3)', () => {
    expect(GLOBALS).not.toMatch(/data:image\/svg/);
    const lockPravidla = PRAVIDLA.filter((p) => /\.sig\.lock/.test(p.selektor));
    for (const p of lockPravidla) {
      expect(p.telo, `${p.selektor} nesie masku`).not.toMatch(/mask-image|content:/);
    }
    const definicieCesty = ZDROJE.filter((z) => /^\s*lock:\s*\[/m.test(bezKomentarov(z.telo)));
    expect(definicieCesty.map((z) => z.cesta)).toHaveLength(1);
  });
});

/* ═════════════ 3. Každý hostiteľ s tónom má značku (bod 2, bod E) ═════════ */

describe('hostiteľ s tónom a značka idú vždy spolu', () => {
  /**
   * Ako sa v tejto appke aplikuje TÓNOVANÁ trieda rodiny.
   *
   * Musia tu byť VŠETKY podoby, aj tie, ktoré sa skladajú za behu — inak platí
   * bod B hlavičky a test si dokáže nepravdu. Prvá verzia poznala len
   * `"sig ok"`, `sigClass(` a `toneSigClass(`; mutácia (odstránené
   * `<ToneSigMark>` zo všetkých troch miest, ktoré indexujú rovno mapu
   * `TONE_SIG_CLASS` — `settings/KeysSection.tsx`, `settings/WritesSection.tsx`,
   * `settings/SettingsIndex.tsx`) ňou prešla ZELENO. Rovnako jej ušli dva
   * ternáre `? 'flag' : 'flag neutral'` (`products/CatalogTable.tsx`,
   * `products/ProductDetailPanel.tsx`), `flagClass()` a mapa `STATE_CLASS`
   * (`campaigns/DiscountState.tsx`).
   */
  const HOST_S_TONOM = [
    /className="(?:sig|flag|state) [a-z]/,
    /className="flag"/,
    /className=\{`sig \$\{/,
    /className=\{(?:sigClass|toneSigClass|flagClass)\(/,
    /className=\{(?:TONE_SIG_CLASS|STATE_CLASS)\[/,
    /className=\{[^}]*'(?:sig|flag) /,
  ];

  /** Súbory, ktoré kreslia tónovaného hostiteľa. */
  function hostitelia(): Zdroj[] {
    return ZDROJE.filter((z) => {
      if (z.cesta.endsWith('ui/StatusMark.tsx')) return false;
      const povrch = bezKomentarov(z.telo);
      return HOST_S_TONOM.some((re) => re.test(povrch));
    });
  }

  it('nájde sa vôbec nejaký tónovaný hostiteľ', () => {
    // Bez tejto poistky by tvrdenie nižšie svietilo zeleno aj vtedy, keby sa
    // vzory rozbili a nenašli NIČ — presne tak vznikol zelený test o troch
    // mŕtvych selektoroch (bod A).
    expect(hostitelia().length).toBeGreaterThan(19);
  });

  it('žiadny súbor nekreslí tónovaného hostiteľa bez značky', () => {
    const bezZnacky = hostitelia()
      // POZOR: musí to byť VYKRESLENIE `<SigMark`, nie import. Prvá verzia
      // tohto testu hľadala len meno a mutácia (odstránená značka pri
      // ponechanom importe) ňou prešla — test nemeral nič.
      .filter((z) => !/<(?:SigMark|ToneSigMark|FlagMark|StateMark)\b/.test(bezKomentarov(z.telo)))
      .map((z) => z.cesta);
    expect(
      bezZnacky,
      'trieda nesie len farbu — bez značky je stav len farba a slovo',
    ).toEqual([]);
  });

  it('holá .sig bez tónu je zámer a značku nepotrebuje (bod E)', () => {
    const blocker = ZDROJE.find((z) => z.cesta.endsWith('campaigns/BlockerList.tsx'));
    expect(blocker, 'BlockerList.tsx sa nenašiel').toBeDefined();
    expect(blocker!.telo).toMatch(/className="sig"/);
  });
});

/* ══════════════════════════ 4. Žiadne emoji (bod C) ═══════════════════════ */

describe('appka nekreslí emoji', () => {
  /*
   * Piktogramy a modifikátor `FE0F` (ten robí z inak textového znaku emodži).
   *
   * Alternácia, nie znaková trieda: `FE0F` je kombinujúci znak a v triede ho
   * `no-misleading-character-class` odmieta — pravidlo má pravdu, v triede sa
   * chová inak, než ako vyzerá.
   */
  const EMOJI = /\u{FE0F}|[\u{1F300}-\u{1FAFF}]/u;

  it('na povrchu appky nie je ani jedno emoji', () => {
    const vinnici = ZDROJE.filter((z) => EMOJI.test(bezKomentarov(z.telo))).map((z) => z.cesta);
    expect(vinnici).toEqual([]);
  });

  it('ani v globals.css', () => {
    expect(EMOJI.test(GLOBALS)).toBe(false);
  });

  it('hľadá sa na povrchu, nie v histórii v komentároch (bod C)', () => {
    // Poistka na samotnú poistku: keby `bezKomentarov()` prestalo strihať,
    // tieto štyri hlavičky by test zhodili a nikto by nevedel prečo.
    expect(EMOJI.test(KOMPONENTY)).toBe(true);
    expect(EMOJI.test(KOMPONENTY_POVRCH)).toBe(false);
  });
});
