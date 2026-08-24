/**
 * Aura Zľavy — V NASTAVENIACH NEPRIBUDNE STAV BEZ ZNAČKY (A3, vlna 1, šprint 20).
 *
 * Doplnok k `znacky-nastavenia-stavy.spec.ts`, ktorý je hlavný: ten vykresľuje
 * HTML a pri každom stavovom uzle meria tri kanály. Tento súbor rieši jedinú
 * vec, ktorú vykreslený výstup zmerať nevie — **stav, ktorý ešte nikto
 * nevykreslil**. Keď na budúci týždeň niekto pridá do formulára šiesty
 * `<span className="sig warn">` a značku k nemu zabudne, render test o ňom
 * nebude vedieť, lebo ho nemá ako vyvolať. Tu sa spária hostiteľ a značka
 * priamo v JSX, takže nový stav bez značky spadne hneď.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 *  A. **Netvrdí sa nič o TEXTE zdroja.** Žiadne „súbor nesmie obsahovať slovo
 *     X" — taký test zakáže autorovi vysvetliť v komentári, prečo stará mapa
 *     zanikla, a vlna 1 šprintu 20 na presne takú pascu narazila. Meria sa
 *     výhradne štruktúra JSX: k otváraciemu tagu s tónovanou triedou sa nájde
 *     jeho telo a v ňom sa počítajú značky.
 *  B. **Mŕtvosť triedy sa NEDÁ dokázať grepom na literál.** Triedy skladá
 *     `sigClass()`, `toneSigClass()` a mapa `TONE_SIG_CLASS` až za behu; aj
 *     v týchto piatich súboroch sa tón dosadzuje cez
 *     `` className={`sig ${tone}`} ``. Vzor preto pozná obe podoby. Opačným
 *     smerom to neplatí ani tu: z nenájdeného literálu sa NEsmie vyvodiť,
 *     že trieda je mŕtva.
 *  C. **Prázdny nález je pád.** Keby sa vzor rozbil a nenašiel nič, tvrdenie
 *     „žiadny hostiteľ bez značky" by svietilo nad prázdnym zoznamom. Presne
 *     tak vznikol zelený test o troch mŕtvych selektoroch (19. 8. 2026).
 *     Počet hostiteľov sa preto najprv tvrdí zdola.
 *  D. **Zámok sa nekreslí dvakrát.** `LockBadge` si ikonu kreslí sám; kto
 *     k nemu pridá `<Icon name="lock">`, dostane dva zámky vedľa seba a na
 *     obrazovke to vyzerá ako preklep, nie ako chyba.
 *
 * Vlastník: A3, vlna 1 šprintu 20 (20. 8. 2026).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** Päť formulárov Nastavení, ktoré vlna 1 preberá. */
const SUBORY = [
  'ApiKeyForm.tsx',
  'DomainForm.tsx',
  'OrdersKeyForm.tsx',
  'ScopeModeForm.tsx',
  'UnlockWritesForm.tsx',
] as const;

/** Odstrihne komentáre — hlavička súboru nie je JSX a merať sa nemá. */
function bezKomentarov(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

const ZDROJE = SUBORY.map((subor) => ({
  subor,
  telo: bezKomentarov(
    readFileSync(
      fileURLToPath(new URL(`../../src/components/settings/${subor}`, import.meta.url)),
      'utf8',
    ),
  ),
}));

/**
 * Otvárací tag hostiteľa s TÓNOM — obe podoby, ktoré sa tu vyskytujú (bod B):
 * literál `className="sig ok"` aj šablóna `` className={`sig ${tone}`} ``.
 */
const HOSTITEL =
  /<(span|p)\b[^>]*?className=(?:"((?:sig|flag|state)(?: [a-z]+)+)"|\{`(sig) \$\{[^`]*`\})[^>]*?>/g;

/** Obaly značky z `ui/StatusMark.tsx` plus priama ikona. */
const ZNACKA = /<(?:SigMark|ToneSigMark|FlagMark|StateMark|Icon)\b/g;

interface Hostitel {
  readonly subor: string;
  readonly trieda: string;
  readonly telo: string;
}

/**
 * Hostitelia s tónom a ich telá.
 *
 * Hľadá sa len otvárací tag; telo sa doreže po prvý uzatvárací tag rovnakého
 * mena. Vnorený `<span>` ani `<p>` v týchto hostiteľoch nie je — sú v nich len
 * značka a slovo — takže prvý koniec je tu ten správny.
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

describe('vzor hostiteľov naozaj niečo nájde', () => {
  it('v piatich formulároch stojí aspoň šesť hostiteľov s tónom', () => {
    expect(HOSTITELIA.length).toBeGreaterThanOrEqual(6);
  });

  it('nájde sa aj hostiteľ so skladanou triedou, nielen s literálom (bod B)', () => {
    expect(HOSTITELIA.some((h) => h.trieda === 'sig')).toBe(true);
    expect(HOSTITELIA.some((h) => h.trieda.startsWith('sig '))).toBe(true);
  });
});

/* ═══════════════ 2. Hostiteľ s tónom a značka idú vždy spolu ══════════════ */

describe('nový stav v Nastaveniach nemôže vzniknúť bez značky', () => {
  it('žiadny hostiteľ s tónom nie je bez značky', () => {
    const bezZnacky = HOSTITELIA.filter((h) => (h.telo.match(ZNACKA) ?? []).length === 0).map(
      (h) => `${h.subor} → ${h.trieda}`,
    );
    expect(bezZnacky, 'trieda nesie len farbu — bez značky je stav len farba a slovo').toEqual(
      [],
    );
  });

  it('žiadny hostiteľ nemá značku dvakrát', () => {
    const dvakrat = HOSTITELIA.filter((h) => (h.telo.match(ZNACKA) ?? []).length > 1).map(
      (h) => `${h.subor} → ${h.trieda}`,
    );
    expect(dvakrat).toEqual([]);
  });

  it('pri značke vždy stojí aj slovo — ikona nikdy nenahrádza text', () => {
    // Slovo môže byť napísané priamo aj dosadené výrazom (`{look.label}`),
    // takže sa výraz NEodstrihuje; že za ním je naozaj slovo, meria render test.
    const bezSlova = HOSTITELIA.filter(
      (h) => h.telo.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().length < 4,
    ).map((h) => `${h.subor} → ${h.trieda}`);
    expect(bezSlova, 'značka je TRETÍ kanál, nikdy prvý').toEqual([]);
  });
});

/* ═══════════════ 3. Zámok kreslí jeden komponent, nie dva (bod D) ═════════ */

describe('zámok sa nekreslí dvakrát', () => {
  it('žiadny z piatich formulárov nekreslí LockBadge a ikonu zámku naraz', () => {
    const vinnici = ZDROJE.filter(
      (z) => z.telo.includes('<LockBadge') && /<Icon\s[^>]*name="lock"/.test(z.telo),
    ).map((z) => z.subor);
    expect(vinnici).toEqual([]);
  });
});
