/**
 * Aura Zľavy — ZNAČKY V NASTAVENIACH SÚ V MARKUPE, NIE V CSS (A3, šprint 20).
 *
 * Vlna 1 šprintu 20 dokončuje prechod, ktorý začal 19. 8. 2026: rodina tried
 * `.sig`, `.flag` a `.state` už nekreslí druhý kanál stavu cez `content:`
 * v `::before`, ale komponentom (`ui/StatusMark.tsx` → `ui/Icon.tsx`). Tento
 * súbor stráži päť formulárov Nastavení, kde stav rozhoduje o tom, či sa do
 * PRODUKČNÉHO eshopu zapíše, alebo nie.
 *
 * PREČO SÚBOR NAD ZDROJOM, KEĎ VEDĽA JE TEST NAD VYKRESLENÝM HTML
 * ---------------------------------------------------------------
 * Väčšina stavov týchto formulárov je za klientskym stavom, nie za props:
 * výsledok skúšky spojenia (`DomainForm`), hlásenie po uložení kľúča aj
 * hlásenie o neuloženom kľúči (`ApiKeyForm`, `OrdersKeyForm`) vzniknú až po
 * odpovedi servera. `renderToStaticMarkup` sa k nim nedostane — efekty ani
 * obsluhy sa pri statickom renderi nespúšťajú. Keby test meral LEN vykreslené
 * HTML, presne tie stavy, ktoré vidí používateľ v najhoršej chvíli (kľúč sa
 * neuložil, eshop neodpovedal), by nekontroloval nikto. Preto sa tu čítajú
 * zdroje a párujú sa hostiteľ a značka priamo v JSX. Vykreslené HTML meria
 * `znacky-nastavenia-stavy.spec.ts`; oba sú potrebné.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 *  A. **Mŕtvosť triedy sa NEDÁ dokázať grepom na literál.** Triedy skladá
 *     `sigClass()`, `toneSigClass()` a mapa `TONE_SIG_CLASS` až za behu, takže
 *     hostiteľ nemusí mať v zdroji reťazec `"sig ok"` — v týchto piatich
 *     súboroch sa tón dosadzuje aj cez `` className={`sig ${tone}`} ``. Vzory
 *     nižšie preto poznajú OBE podoby a test si najprv dokazuje, že vôbec
 *     niečo našiel (bod C). Opačným smerom to neplatí ani tu: z toho, že sa
 *     literál nenašiel, sa NEsmie vyvodiť, že trieda je mŕtva.
 *  B. **Značka nesmie byť dvakrát.** `LockBadge` si zámok kreslí sám; kto
 *     k nemu pridá ešte `<Icon name="lock">`, dostane dva zámky vedľa seba
 *     a na obrazovke to vyzerá ako preklep, nie ako chyba.
 *  C. **Poistka na samotnú poistku.** Keby sa vzory rozbili a nenašli NIČ,
 *     tvrdenie „žiadny hostiteľ bez značky" by svietilo zeleno nad prázdnym
 *     zoznamom. Presne tak vznikol zelený test o troch mŕtvych selektoroch
 *     (19. 8. 2026). Preto sa počet hostiteľov najprv tvrdí zdola.
 *
 * Vlastník: A3, vlna 1 šprintu 20 (20. 8. 2026).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** Päť formulárov Nastavení, ktoré vlna 1 prevádza na značky v markupe. */
const SUBORY = [
  'ApiKeyForm.tsx',
  'DomainForm.tsx',
  'OrdersKeyForm.tsx',
  'ScopeModeForm.tsx',
  'UnlockWritesForm.tsx',
] as const;

const zdroj = (subor: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../src/components/settings/${subor}`, import.meta.url)),
    'utf8',
  );

/** Odstrihne komentáre — história v hlavičke nie je povrch appky. */
function bezKomentarov(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

const ZDROJE = SUBORY.map((subor) => ({ subor, telo: bezKomentarov(zdroj(subor)) }));

/**
 * Otvárací tag hostiteľa s TÓNOM — obe podoby, ktoré sa v týchto súboroch
 * vyskytujú (pozri bod A hlavičky):
 *
 *   • literál            `className="sig ok"`
 *   • zložený za behu    `` className={`sig ${verify.tone}`} ``
 */
const HOSTITEL =
  /<(span|p)\b[^>]*?className=(?:"((?:sig|flag|state)(?: [a-z]+)+)"|\{`(sig) \$\{[^`]*`\})[^>]*?>/g;

/** Obaly značky z `ui/StatusMark.tsx`, ktoré sa v hostiteľovi rátajú. */
const ZNACKA = /<(?:SigMark|ToneSigMark|FlagMark|StateMark|Icon)\b/g;

interface Hostitel {
  readonly subor: string;
  /** Trieda hostiteľa tak, ako stojí v zdroji (pri šablóne bez dosadeného tónu). */
  readonly trieda: string;
  /** Telo prvku — od konca otváracieho tagu po jeho uzatvárací tag. */
  readonly telo: string;
}

/**
 * Nájde hostiteľov s tónom a k nim ich telo.
 *
 * Telo končí prvým uzatváracím tagom ROVNAKÉHO mena. Vnorený `<span>` ani
 * `<p>` sa v týchto hostiteľoch nevyskytuje — sú v nich len značka a slovo —
 * takže naivné hľadanie prvého konca je tu správne a nie skratka.
 */
function hostitelia(): Hostitel[] {
  const out: Hostitel[] = [];
  for (const { subor, telo } of ZDROJE) {
    HOSTITEL.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = HOSTITEL.exec(telo)) !== null) {
      const tag = m[1]!;
      const koniec = telo.indexOf(`</${tag}>`, m.index + m[0].length);
      expect(koniec, `${subor}: hostiteľ ${m[0]} nemá uzatvárací tag`).toBeGreaterThan(-1);
      out.push({
        subor,
        trieda: m[2] ?? m[3]!,
        telo: telo.slice(m.index + m[0].length, koniec),
      });
    }
  }
  return out;
}

const HOSTITELIA = hostitelia();

/* ═════════════ 1. Poistka na poistku — našlo sa vôbec niečo (bod C) ═══════ */

describe('vzory hostiteľov naozaj niečo nájdu', () => {
  it('v piatich formulároch stojí aspoň dvanásť hostiteľov s tónom', () => {
    // Keby sa vzor rozbil, tvrdenia nižšie by svietili nad prázdnym zoznamom.
    expect(HOSTITELIA.length).toBeGreaterThanOrEqual(12);
  });

  it('každý z piatich súborov kreslí aspoň jeden stav', () => {
    for (const { subor } of ZDROJE) {
      expect(
        HOSTITELIA.filter((h) => h.subor === subor).length,
        `${subor} nekreslí ani jeden stav — buď sa vzor rozbil, alebo stav zmizol`,
      ).toBeGreaterThan(0);
    }
  });

  it('nájde sa aj hostiteľ so skladanou triedou, nielen s literálom (bod A)', () => {
    expect(HOSTITELIA.some((h) => h.trieda === 'sig')).toBe(true);
    expect(HOSTITELIA.some((h) => h.trieda.startsWith('sig '))).toBe(true);
  });
});

/* ═══════════════ 2. Každý hostiteľ s tónom nesie práve jednu značku ═══════ */

describe('hostiteľ s tónom a značka idú vždy spolu', () => {
  it('žiadny stav v Nastaveniach nestojí bez značky', () => {
    const bezZnacky = HOSTITELIA.filter((h) => (h.telo.match(ZNACKA) ?? []).length === 0).map(
      (h) => `${h.subor} → ${h.trieda}`,
    );
    expect(
      bezZnacky,
      'trieda nesie len farbu — bez značky je stav len farba a slovo',
    ).toEqual([]);
  });

  it('žiadny stav nemá značku dvakrát (bod B)', () => {
    const dvakrat = HOSTITELIA.filter((h) => (h.telo.match(ZNACKA) ?? []).length > 1).map(
      (h) => `${h.subor} → ${h.trieda}`,
    );
    expect(dvakrat).toEqual([]);
  });

  /**
   * Slovo môže byť napísané priamo („Spojenie funguje") aj dosadené výrazom
   * (`{verify.label}`, `{full ? 'plný rozsah' : 'pilotný rozsah'}`). Výraz sa
   * preto NEodstrihuje — inak by test vyhlásil za nemý každý stav, ktorého
   * slovo vzniká za behu, čo je väčšina týchto formulárov. Že za výrazom je
   * naozaj slovo a nie prázdny reťazec, meria `znacky-nastavenia-stavy`.
   */
  it('pri značke vždy stojí aj slovo — ikona nikdy nenahrádza text', () => {
    const bezSlova = HOSTITELIA.filter((h) => {
      const slovo = h.telo.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      return slovo.length < 4;
    }).map((h) => `${h.subor} → ${h.trieda}`);
    expect(bezSlova, 'značka je TRETÍ kanál, nikdy prvý').toEqual([]);
  });
});

/* ═══════════════ 3. Zámok sa nekreslí dvakrát (bod B) ═════════════════════ */

describe('zámok kreslí jeden komponent, nie dva', () => {
  it('žiadny z piatich formulárov nekreslí LockBadge a zámok naraz', () => {
    const vinnici = ZDROJE.filter(
      (z) => z.telo.includes('<LockBadge') && /<Icon\s[^>]*name="lock"/.test(z.telo),
    ).map((z) => z.subor);
    expect(vinnici).toEqual([]);
  });
});

/* ═══════════════ 4. Značku nekreslí CSS ═══════════════════════════════════ */

describe('značku v Nastaveniach nekreslí CSS ani znak v texte', () => {
  /** Znaky, ktoré rodina `.sig`/`.flag`/`.state` kreslila do 19. 8. 2026. */
  const STAVOVE_ZNAKY = ['○', '◆', '●', '▲', '✕', '✓'];

  it('ani jeden z piatich súborov nepíše stavový znak do textu', () => {
    const vinnici: string[] = [];
    for (const { subor, telo } of ZDROJE) {
      for (const znak of STAVOVE_ZNAKY) {
        if (telo.includes(znak)) vinnici.push(`${subor} → ${znak}`);
      }
    }
    expect(vinnici).toEqual([]);
  });

  it('ani jeden z nich si nedodáva vlastný ::before ani content', () => {
    const vinnici = ZDROJE.filter((z) => /::before|content:/.test(z.telo)).map((z) => z.subor);
    expect(vinnici).toEqual([]);
  });
});
