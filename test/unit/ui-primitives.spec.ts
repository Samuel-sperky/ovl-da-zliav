/**
 * Aura Zľavy — TESTY ČISTEJ LOGIKY UI PRIMITÍV (`src/components/ui/primitives.ts`).
 *
 * Testuje sa VÝPOČET, nie vzhľad: naplnenie stropu, prahy varovania, tóny,
 * slovenské formátovanie a slovníky glyfov. Vykresľovanie JSX tu vedome nie je
 * — `vitest.config.ts` beží v `environment: 'node'` a zbiera len `*.spec.ts`,
 * takže test nad DOM by v tomto projekte nemal ako existovať. Rozdelenie
 * `primitives.ts` (logika) verzus `*.tsx` (značkovanie) je presne preto.
 *
 * Najdôležitejšie tvrdenia v tomto súbore nie sú o číslach, ale o pravidlách:
 *
 *  - vyčerpaný rozpočet NIE JE červený (K2) — kým to platí, appka nekričí
 *    „chyba" na niečo, čo je len čakanie do 02:00,
 *  - každá úroveň má farbu AJ glyf AJ slovo, a `warn` sa od `full` líši aj
 *    vtedy, keď majú rovnaký tón,
 *  - nekonfigurovaný strop sa nedopĺňa optimizmom.
 *
 * Vlastník: U1.
 */
import { describe, expect, it } from 'vitest';

import { ICON_NAMES } from '@/components/ui/Icon';

import {
  BUDGET_LEVEL_ICON,
  BUDGET_LEVEL_WORD,
  BUDGET_WARN_RATIO,
  NOTE_CLASS,
  NOTE_ICON,
  NOTE_TONE,
  TREND_ICON,
  TREND_WORD,
  budgetAriaText,
  budgetCountLabel,
  budgetFillPercent,
  budgetLevel,
  budgetLevelTone,
  budgetResetSentence,
  noteRole,
  trendTone,
  type BudgetLevel,
  type NoteVariant,
  type TrendDirection,
  type TrendMeaning,
} from '@/components/ui/primitives';

const LEVELS: readonly BudgetLevel[] = ['calm', 'warn', 'full'];
const VARIANTS: readonly NoteVariant[] = ['info', 'warn', 'err'];
const DIRECTIONS: readonly TrendDirection[] = ['up', 'down', 'flat'];

/* ═══════════════════ 1. Naplnenie stropu — výpočet percenta ═══════════════ */

describe('budgetFillPercent — koľko zo stropu je minuté', () => {
  it('počíta bežné podiely na jedno desatinné miesto', () => {
    expect(budgetFillPercent(0, 200)).toBe(0);
    expect(budgetFillPercent(50, 200)).toBe(25);
    expect(budgetFillPercent(160, 200)).toBe(80);
    expect(budgetFillPercent(9, 18)).toBe(50);
    // 1/3 = 33,333… → 33,3 (nie 33,33333333333333 do šírky v CSS)
    expect(budgetFillPercent(1, 3)).toBe(33.3);
    expect(budgetFillPercent(2, 3)).toBe(66.7);
  });

  it('nikdy nepretečie ani nespadne pod nulu', () => {
    expect(budgetFillPercent(200, 200)).toBe(100);
    expect(budgetFillPercent(999, 200)).toBe(100);
    expect(budgetFillPercent(-5, 200)).toBe(0);
  });

  it('nekonfigurovaný strop hlási plno, nie voľno', () => {
    // Pesimistický smer je vedomý: appka nesmie sľúbiť kapacitu, o ktorej nevie.
    expect(budgetFillPercent(0, 0)).toBe(100);
    expect(budgetFillPercent(10, -1)).toBe(100);
    expect(budgetFillPercent(10, Number.NaN)).toBe(100);
    expect(budgetFillPercent(10, Number.POSITIVE_INFINITY)).toBe(100);
  });

  it('pokazená spotreba pri platnom stropu je nula, nie NaN', () => {
    expect(budgetFillPercent(Number.NaN, 200)).toBe(0);
    expect(budgetFillPercent(Number.POSITIVE_INFINITY, 200)).toBe(0);
  });
});

/* ═══════════════════════ 2. Prahy varovania ═══════════════════════════════ */

describe('budgetLevel — prahy varovania', () => {
  it('prah je 80 % a je inkluzívny', () => {
    expect(BUDGET_WARN_RATIO).toBe(0.8);
    expect(budgetLevel(159, 200)).toBe('calm'); // 79,5 %
    expect(budgetLevel(160, 200)).toBe('warn'); // presne 80 %
    expect(budgetLevel(199, 200)).toBe('warn'); // 99,5 %
  });

  it('plný strop je `full`, aj keď sa prekročí', () => {
    expect(budgetLevel(200, 200)).toBe('full');
    expect(budgetLevel(201, 200)).toBe('full');
  });

  it('prázdny a rozbehnutý rozpočet je pokoj', () => {
    expect(budgetLevel(0, 200)).toBe('calm');
    expect(budgetLevel(1, 200)).toBe('calm');
  });

  it('minútový strop z predlohy sa správa rovnako ako denný', () => {
    // Predloha merala „minúta 0/18" a „dnes 0/200" — jeden výpočet pre oba.
    expect(budgetLevel(0, 18)).toBe('calm');
    expect(budgetLevel(14, 18)).toBe('calm'); // 77,8 % — pod prahom
    expect(budgetLevel(15, 18)).toBe('warn'); // 83,3 % — nad prahom
    expect(budgetLevel(18, 18)).toBe('full');
  });
});

/* ═════════════ 3. Stav nikdy nie je len farba — tón + glyf + slovo ════════ */

describe('K2 — vyčerpaný rozpočet nie je chyba', () => {
  it('plný strop je predvolene `attention`, nikdy nie `critical`', () => {
    expect(budgetLevelTone('full')).toBe('attention');
    expect(budgetLevelTone('warn')).toBe('attention');
    expect(budgetLevelTone('calm')).toBe('idle');
  });

  it('červenú si musí volajúci vypýtať menovite', () => {
    expect(budgetLevelTone('full', 'critical')).toBe('critical');
    // `fullTone` sa dotýka LEN plného stropu — varovanie zostáva jantárové.
    expect(budgetLevelTone('warn', 'critical')).toBe('attention');
    expect(budgetLevelTone('calm', 'critical')).toBe('idle');
  });
});

describe('stav nikdy nie je len farba', () => {
  it('každá úroveň má glyf aj slovo', () => {
    for (const level of LEVELS) {
      expect(ICON_NAMES, `ikona ${level}`).toContain(BUDGET_LEVEL_ICON[level]);
      expect(BUDGET_LEVEL_WORD[level].length, `slovo ${level}`).toBeGreaterThan(0);
    }
  });

  it('glyfy sú navzájom rôzne — aj `warn` verzus `full`, ktoré zdieľajú tón', () => {
    const glyphs = LEVELS.map((level) => BUDGET_LEVEL_ICON[level]);
    expect(new Set(glyphs).size).toBe(LEVELS.length);
    expect(budgetLevelTone('warn')).toBe(budgetLevelTone('full'));
    expect(BUDGET_LEVEL_ICON.warn).not.toBe(BUDGET_LEVEL_ICON.full);
  });

  it('slová sú navzájom rôzne a po slovensky', () => {
    const words = LEVELS.map((level) => BUDGET_LEVEL_WORD[level]);
    expect(new Set(words).size).toBe(LEVELS.length);
    expect(BUDGET_LEVEL_WORD.full).toBe('strop vyčerpaný');
    expect(BUDGET_LEVEL_WORD.warn).toBe('blíži sa strop');
  });
});

/* ═══════════════════════ 4. Slovenské formátovanie ════════════════════════ */

describe('budgetCountLabel — dvojica čísel v riadku prúžku', () => {
  it('používa lomku ako zvyšok appky', () => {
    expect(budgetCountLabel(0, 18)).toBe('0/18');
    expect(budgetCountLabel(100, 200)).toBe('100/200');
  });

  it('tisícky oddeľuje medzerou, nikdy bodkou ani čiarkou', () => {
    expect(budgetCountLabel(3420, 8000)).toBe('3 420/8 000');
    expect(budgetCountLabel(1000000, 1000000)).toBe('1 000 000/1 000 000');
  });

  it('neznáme číslo je pomlčka, nie nula', () => {
    expect(budgetCountLabel(Number.NaN, 200)).toBe('—/200');
    expect(budgetCountLabel(10, Number.POSITIVE_INFINITY)).toBe('10/—');
  });
});

describe('budgetResetSentence — kedy sa strop obnoví', () => {
  it('lepí predloženú frázu do vety', () => {
    expect(budgetResetSentence('o 02:00')).toBe('Obnoví sa o 02:00.');
    expect(budgetResetSentence('zajtra o polnoci')).toBe('Obnoví sa zajtra o polnoci.');
  });

  it('bez frázy nevymýšľa vetu', () => {
    expect(budgetResetSentence(undefined)).toBeNull();
    expect(budgetResetSentence(null)).toBeNull();
    expect(budgetResetSentence('')).toBeNull();
    expect(budgetResetSentence('   ')).toBeNull();
  });
});

describe('budgetAriaText — čo prečíta čítačka', () => {
  it('nesie popis, čísla aj slovo úrovne', () => {
    expect(budgetAriaText('Zápisy dnes', 100, 200)).toBe(
      'Zápisy dnes: 100/200, v rámci stropu.',
    );
    expect(budgetAriaText('Zápisy dnes', 160, 200)).toBe(
      'Zápisy dnes: 160/200, blíži sa strop.',
    );
    expect(budgetAriaText('Zápisy dnes', 200, 200)).toBe(
      'Zápisy dnes: 200/200, strop vyčerpaný.',
    );
  });

  it('pridá obnovu, keď ju volajúci pozná', () => {
    expect(budgetAriaText('Zápisy dnes', 200, 200, 'o 02:00')).toBe(
      'Zápisy dnes: 200/200, strop vyčerpaný. Obnoví sa o 02:00.',
    );
  });

  it('nikdy neopakuje percento — to nesie `aria-valuenow`', () => {
    expect(budgetAriaText('Zápisy dnes', 160, 200)).not.toContain('%');
  });
});

/* ═══════════════════════ 5. Vysvetlivka (Note) ════════════════════════════ */

describe('Note — varianty vysvetlivky', () => {
  it('každý variant má triedu, glyf aj tón', () => {
    for (const variant of VARIANTS) {
      expect(NOTE_CLASS[variant], `trieda ${variant}`).toContain('ovl-note');
      expect(ICON_NAMES, `ikona ${variant}`).toContain(NOTE_ICON[variant]);
      expect(NOTE_TONE[variant], `tón ${variant}`).toBeTruthy();
    }
  });

  it('vysvetlivka dedí panel z globals — nezavádza vlastnú triedu', () => {
    expect(NOTE_CLASS.info).toBe('ovl-note');
    expect(NOTE_CLASS.warn).toBe('ovl-note ovl-note--attention');
    expect(NOTE_CLASS.err).toBe('ovl-note ovl-note--critical');
  });

  it('glyfy sú navzájom rôzne', () => {
    expect(new Set(VARIANTS.map((v) => NOTE_ICON[v])).size).toBe(VARIANTS.length);
  });

  it('len chyba preruší čítačku', () => {
    expect(noteRole('err')).toBe('alert');
    expect(noteRole('warn')).toBe('status');
    expect(noteRole('info')).toBe('status');
  });

  it('varianty sedia na stavové tóny §3.2', () => {
    expect(NOTE_TONE.info).toBe('idle');
    expect(NOTE_TONE.warn).toBe('attention');
    expect(NOTE_TONE.err).toBe('critical');
  });
});

/* ═══════════════════════ 6. Smer zmeny (StatTile) ═════════════════════════ */

describe('StatTile — smer zmeny', () => {
  it('každý smer má glyf aj slovo a sú navzájom rôzne', () => {
    for (const direction of DIRECTIONS) {
      expect(ICON_NAMES, `ikona ${direction}`).toContain(TREND_ICON[direction]);
      expect(TREND_WORD[direction].length, `slovo ${direction}`).toBeGreaterThan(0);
    }
    expect(new Set(DIRECTIONS.map((d) => TREND_ICON[d])).size).toBe(DIRECTIONS.length);
    expect(new Set(DIRECTIONS.map((d) => TREND_WORD[d])).size).toBe(DIRECTIONS.length);
  });

  it('rast sám osebe nie je dobrá správa — predvolený význam nefarbí', () => {
    const meanings: readonly TrendMeaning[] = ['good', 'bad', 'idle'];
    expect(meanings.every((m) => Boolean(trendTone(m)))).toBe(true);
    expect(trendTone('idle')).toBe('idle');
    expect(trendTone('good')).toBe('good');
    expect(trendTone('bad')).toBe('critical');
  });
});
