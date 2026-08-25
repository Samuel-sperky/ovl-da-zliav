/**
 * Aura Zľavy — JEDEN SLOVNÍK STAVOV, ALEBO ŽIADNY (opravná vlna 19. 8. 2026).
 *
 * Nezávislé review našlo v appke DVA prevodníky `resolution → vzhľad` vedľa
 * seba (v skutočnosti štyri) a tri samostatné chyby, ktoré z toho vyplynuli:
 *
 *  A. **Rozpor farieb a slov medzi obrazovkami.** `writes_disabled` bol na
 *     Prehľade jantárový „rieši sa mimo appky" a na Detaile zľavy červený
 *     „mimo appky". Používateľ prešiel o obrazovku ďalej a to isté sa mu
 *     zmenilo z „pozor" na „chyba".
 *  B. **Slovo o závažnosti existovalo len na Prehľade.** `BlockerRow`, ktorý
 *     kreslí prekážky na Zľavách, Detaile aj Novej zľave, `severity`
 *     nevykresľoval vôbec — oprava D6 platila na jednej zo štyroch obrazoviek.
 *  C. **Stav „prebieha" sa nedal nakresliť.** `blockers-view.ts` mapoval
 *     `progress` na `sig idle`, takže piaty stav splynul s „nečinný".
 *
 * Testy nižšie sú preto namierené presne na tie tri veci — a navyše na to,
 * ČO ich umožnilo: že si prevod smela napísať každá obrazovka sama. Posledný
 * blok prehľadáva zdroj a trvá na tom, že tabuľka je JEDNA.
 *
 * Čo tento súbor nerobí: nemeria farby (to je `paleta.spec.ts`) a netvrdí, že
 * zvolené znenie je pekné. Tvrdí len, že je jedno.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ICON_NAMES } from '@/components/ui/Icon';

import { BlockerRow } from '@/components/campaigns/BlockerList';
import type { BlockerCard } from '@/components/campaigns/queue-model';
import {
  RESOLUTION_ICON,
  RESOLUTION_TONE,
  RESOLUTION_WORD,
} from '@/components/campaigns/queue-model';
import BlockersSection from '@/components/dashboard/BlockersSection';
import type { BlockerRow as StatusBlockerRow } from '@/components/dashboard/status-api';
import {
  RESOLUTION_TONE as SETTINGS_TONE,
  RESOLUTION_WORD as SETTINGS_WORD,
  TONE_SIG_CLASS,
  blockerIcon,
  blockerTone,
} from '@/components/settings/blockers-view';
import {
  BLOCKER_RESOLUTION_CODES,
  RESOLUTION_LOOK,
  SEVERITY_WORD,
  UNKNOWN_RESOLUTION_LOOK,
  resolutionLook,
  severityWord,
  toneSigClass,
} from '@/components/ui/blocker-look';
import type { BlockerResolutionCode, BlockerSeverityCode } from '@/components/ui/blocker-look';
import type { StatusTone } from '@/components/ui/ToneBadge';

import { stavovePravidlo } from '../helpers/css-stavy';

/** Päť tónov škály `--st-*`. Šiesty by znamenal farbu, ktorú nikto nezmeral. */
const TONES: readonly StatusTone[] = ['critical', 'attention', 'progress', 'good', 'idle'];

const SEVERITIES: readonly BlockerSeverityCode[] = ['blokuje', 'obmedzuje', 'informuje'];

/* ═══════════════════ 1. Slovník je úplný a trojkanálový ═══════════════════ */

describe('slovník prekážok — tri kanály, nikdy len farba', () => {
  it('každý spôsob riešenia má tón, glyf aj slovo', () => {
    for (const code of BLOCKER_RESOLUTION_CODES) {
      const look = resolutionLook(code);
      expect(TONES, `tón ${code}`).toContain(look.tone);
      // Názov ikony musí ukazovať na ikonu, ktorá naozaj existuje —
      // neprázdny reťazec by prešiel aj pri preklepe.
      expect(ICON_NAMES, `ikona ${code}`).toContain(look.icon);
      expect(look.word.length, `slovo ${code}`).toBeGreaterThan(3);
    }
  });

  it('glyfy sú navzájom odlíšiteľné — druhý kanál nesmie splývať', () => {
    const glyphs = BLOCKER_RESOLUTION_CODES.map((code) => resolutionLook(code).icon);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it('slová sú navzájom odlíšiteľné — tretí kanál tiež', () => {
    const words = BLOCKER_RESOLUTION_CODES.map((code) => resolutionLook(code).word);
    expect(new Set(words).size).toBe(words.length);
  });

  it('neznámy spôsob riešenia sa nedomýšľa ani na poplach, ani na pokoj', () => {
    expect(resolutionLook(null)).toBe(UNKNOWN_RESOLUTION_LOOK);
    expect(resolutionLook(undefined)).toBe(UNKNOWN_RESOLUTION_LOOK);
    expect(UNKNOWN_RESOLUTION_LOOK.tone).toBe('attention');
    expect(UNKNOWN_RESOLUTION_LOOK.word.length).toBeGreaterThan(0);
  });
});

/* ═══════════════════ 2. Farbu volí riešenie, nie závažnosť ════════════════ */

describe('farbu volí spôsob riešenia, nie závažnosť (kontrakt UI, bod 7)', () => {
  it('vyčerpaný rozpočet ZASTAVUJE, a predsa je pokojný (K2)', () => {
    // Keby sa farbilo podľa závažnosti, tento riadok by bol červený a z každého
    // úplne normálneho dňa by sa stal poplach.
    expect(resolutionLook('cakanie').tone).toBe('idle');
  });

  it('to, s čím sa TERAZ dá pohnúť, je jantárové — aj keď si pýta heslo', () => {
    expect(resolutionLook('sam').tone).toBe('attention');
    expect(resolutionLook('sudo').tone).toBe('attention');
  });

  it('zámok je spôsob riešenia, NIE tón', () => {
    // Do 19. 8. mal Prehľad pre `sudo` šiesty „tón" `lock` (tlmená sivá), kým
    // tab Zľavy ho kreslil jantárovo. Zámok je odvtedy vlastnosť, nie farba.
    expect(resolutionLook('sudo').locked).toBe(true);
    for (const code of BLOCKER_RESOLUTION_CODES) {
      if (code === 'sudo') continue;
      expect(resolutionLook(code).locked, code).toBe(false);
    }
    // Ani jeden tón sa nevolá „lock" — inak by sa zámok opäť stal závažnosťou.
    const tones: string[] = BLOCKER_RESOLUTION_CODES.map((c) => resolutionLook(c).tone);
    expect(tones).not.toContain('lock');
  });

  it('červená je vyhradená pre zastavený zápis, ktorý sa z appky nedá riešiť', () => {
    const red = BLOCKER_RESOLUTION_CODES.filter((c) => resolutionLook(c).tone === 'critical');
    expect(red).toEqual(['mimo_appky']);
  });

  it('závažnosť nemá vlastnú farbu — má SLOVO', () => {
    for (const severity of SEVERITIES) {
      expect(severityWord(severity).length, severity).toBeGreaterThan(3);
    }
    expect(new Set(SEVERITIES.map(severityWord)).size).toBe(SEVERITIES.length);
  });
});

/* ═══════════════════ 3. Chyba A — obrazovky si už neodporujú ══════════════ */

describe('A — tá istá prekážka vyzerá rovnako na každej obrazovke', () => {
  it('tab Zľavy a Nastavenia berú tón z toho istého slovníka ako Prehľad', () => {
    for (const code of BLOCKER_RESOLUTION_CODES) {
      const look = resolutionLook(code);
      expect(RESOLUTION_TONE[code], `Zľavy ${code}`).toBe(look.tone);
      expect(SETTINGS_TONE[code], `Nastavenia ${code}`).toBe(look.tone);
      expect(blockerTone({ resolution: code }), `blockerTone ${code}`).toBe(look.tone);
    }
  });

  it('slovo o riešení znie na každej obrazovke rovnako', () => {
    for (const code of BLOCKER_RESOLUTION_CODES) {
      expect(RESOLUTION_WORD[code], `Zľavy ${code}`).toBe(resolutionLook(code).word);
      expect(SETTINGS_WORD[code], `Nastavenia ${code}`).toBe(resolutionLook(code).word);
    }
  });

  it('glyf tiež — `sudo` má zámok všade, nie len tam, kde naň niekto myslel', () => {
    for (const code of BLOCKER_RESOLUTION_CODES) {
      expect(RESOLUTION_ICON[code], code).toBe(resolutionLook(code).icon);
      expect(blockerIcon({ resolution: code }), code).toBe(resolutionLook(code).icon);
    }
    expect(resolutionLook('sudo').icon).toBe('lock');
  });

  it('Prehľad a Detail zľavy kreslia pre `writes_disabled` ten istý tón', () => {
    // Presne tá dvojica zo snímok `aktualne-9` (jantár) a `aktualne-11`
    // (červená), kvôli ktorej celá oprava vznikla.
    const overview = renderToStaticMarkup(
      createElement(BlockersSection, { blockers: [statusRow()] }),
    );
    const detail = renderToStaticMarkup(createElement(BlockerRow, { card: card() }));

    expect(overview).toContain('rieši sa mimo appky');
    expect(detail).toContain('rieši sa mimo appky');
    expect(detail).toContain('data-tone="critical"');
    // Prehľad kreslí tón triedou `.sig`; obe strany hovoria „critical".
    expect(overview).toContain(toneSigClass('critical'));
  });
});

/* ═══════════════════ 4. Chyba B — D6 platí na všetkých obrazovkách ════════ */

describe('B — riadok prekážky nesie závažnosť SLOVOM (D6 dotiahnuté)', () => {
  it('Prehľad kreslí slovo o závažnosti', () => {
    const html = renderToStaticMarkup(
      createElement(BlockersSection, { blockers: threeLevels() }),
    );
    for (const severity of SEVERITIES) {
      expect(html, severity).toContain(SEVERITY_WORD[severity]);
    }
    expect(html.match(/data-testid="blocker-severity"/g)).toHaveLength(3);
  });

  it('riadok tabu Zľavy (Zľavy + Detail + Nová zľava) ho kreslí tiež', () => {
    // Toto je celá chyba B: do 19. 8. tento riadok `severity` nevykresľoval
    // vôbec, takže na troch zo štyroch obrazoviek sa nedalo rozoznať, čo
    // zastavuje zápis a čo len hlási platné pravidlo.
    for (const severity of SEVERITIES) {
      const html = renderToStaticMarkup(
        createElement(BlockerRow, { card: card({ severity }) }),
      );
      expect(html, severity).toContain(SEVERITY_WORD[severity]);
      expect(html, severity).toContain('data-testid="blocker-severity"');
      expect(html, severity).toContain(`data-severity="${severity}"`);
    }
  });

  it('obe obrazovky používajú TO ISTÉ slovo, nie dve podobné', () => {
    const overview = renderToStaticMarkup(
      createElement(BlockersSection, { blockers: [statusRow()] }),
    );
    const row = renderToStaticMarkup(createElement(BlockerRow, { card: card() }));
    expect(overview).toContain(SEVERITY_WORD.blokuje);
    expect(row).toContain(SEVERITY_WORD.blokuje);
  });

  it('slovo o závažnosti nie je nalepené na vetu o ďalšom kroku', () => {
    // Presne to bola chyba D6: čitateľ ho prečítal ako začiatok tej vety.
    const html = renderToStaticMarkup(createElement(BlockerRow, { card: card() }));
    expect(html).not.toContain(`${SEVERITY_WORD.blokuje} Zapnúť`);
    // Značka stojí pred slovom o spôsobe riešenia, nie za ním.
    expect(html.indexOf('blocker-severity')).toBeLessThan(html.indexOf('rieši sa mimo appky'));
  });

  it('stav ostáva trojkanálový — riadok nesie farbu, glyf aj slová', () => {
    const html = renderToStaticMarkup(createElement(BlockerRow, { card: card() }));
    expect(html).toContain('data-tone="critical"');
    expect(html).toContain(resolutionLook('mimo_appky').icon);
    expect(html).toContain(SEVERITY_WORD.blokuje);
    expect(html).toContain(resolutionLook('mimo_appky').word);
  });
});

/* ═══════════════════ 5. Chyba C — „prebieha" sa dá nakresliť ══════════════ */

describe('C — piaty stav „prebieha" už nesplýva s „nečinný"', () => {
  it('progress má vlastnú triedu, nie triedu nečinnosti', () => {
    expect(toneSigClass('progress')).toBe('sig progress');
    expect(toneSigClass('progress')).not.toBe(toneSigClass('idle'));
  });

  it('každý z piatich tónov má vlastnú triedu značky', () => {
    const classes = TONES.map(toneSigClass);
    expect(new Set(classes).size).toBe(TONES.length);
    for (const cls of classes) expect(cls).toMatch(/^sig\b/);
  });

  it('trieda, ktorú appka žiada, v `globals.css` naozaj existuje a kreslí', () => {
    /*
     * Bez tejto kontroly by sa dal `progress` „opraviť" na triedu, ktorú nikto
     * nenadefinoval, a stav by zmizol úplne namiesto toho, aby splynul.
     *
     * Pôvodne to bolo `expect(css).toContain('.sig.progress')` — teda hľadanie
     * PODREŤAZCA. Premenovanie bloku na `.sig.progress-strong {` by ho nechalo
     * v súbore, test by prešiel a appka by emitovala triedu bez štýlu. Pýtame
     * sa preto na blok s PRESNE tým selektorom, ktorý appka emituje, a na to,
     * že nesie `color:` (parser je v `test/helpers/css-stavy.ts`, ten istý,
     * ktorý v `paleta.spec.ts` stráži, odkiaľ tá farba je).
     */
    const css = readFileSync(
      fileURLToPath(new URL('../../src/app/globals.css', import.meta.url)),
      'utf8',
    );
    for (const cls of TONES.map(toneSigClass)) {
      const selektor = `.${cls.replace(' ', '.')}`;
      expect(
        stavovePravidlo(css, selektor),
        `${selektor} { color: … } v globals.css chýba — trieda "${cls}" nekreslí nič`,
      ).toBeDefined();
    }
  });

  it('TONE_SIG_CLASS z Nastavení je tá istá tabuľka', () => {
    for (const tone of TONES) expect(TONE_SIG_CLASS[tone]).toBe(toneSigClass(tone));
  });
});

/* ═══════════════════ 6. Príčina — tabuľka smie byť len JEDNA ══════════════ */

describe('prevod `resolution → vzhľad` je v zdroji práve raz', () => {
  /** Všetky zdroje pod `src/` ako dvojice cesta + obsah. */
  function sources(): { path: string; text: string }[] {
    const root = fileURLToPath(new URL('../../src', import.meta.url));
    const out: { path: string; text: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          out.push({ path: p.slice(root.length + 1).replace(/\\/g, '/'), text: readFileSync(p, 'utf8') });
        }
      }
    };
    walk(root);
    return out;
  }

  /**
   * Modul, ktorý smie mať doslovnú tabuľku `sam / sudo / cakanie / mimo_appky`
   * s hodnotami vzhľadu. Presne jeden.
   */
  const JEDINY = 'components/ui/blocker-look.ts';

  it('doslovnú tabuľku vzhľadu má jediný modul', () => {
    /*
     * Hľadá objektový literál, ktorý mapuje všetky štyri kódy naraz. Práve
     * taký tvar mali všetky tri rozídené tabuľky; kto ho napíše znova, sem
     * spadne aj s cestou k súboru.
     */
    const literal = /sam:[^\n]*\n\s*(?:.*\n\s*)?sudo:[\s\S]{0,200}?cakanie:[\s\S]{0,200}?mimo_appky:/;
    const hriesnici = sources()
      .filter((s) => s.path !== JEDINY)
      .filter((s) => literal.test(s.text))
      .map((s) => s.path);

    expect(
      hriesnici,
      'druhý slovník stavov — presne toto stálo tri chyby (19. 8. 2026)',
    ).toEqual([]);
  });

  it('modely obrazoviek si svoje mapy odvodzujú, nepíšu', () => {
    const byPath = new Map(sources().map((s) => [s.path, s.text]));
    for (const path of [
      'components/campaigns/queue-model.ts',
      'components/settings/blockers-view.ts',
      'components/dashboard/live-status-model.ts',
    ]) {
      expect(byPath.get(path), path).toContain('@/components/ui/blocker-look');
    }
  });

  it('jediný modul naozaj tú tabuľku má — poistka proti prázdnemu meraniu', () => {
    const text = sources().find((s) => s.path === JEDINY)?.text ?? '';
    expect(text).toContain('mimo_appky');
    expect(Object.keys(RESOLUTION_LOOK)).toHaveLength(4);
  });
});

/* ─────────────────────────── pomocníci ──────────────────────────────────── */

function card(patch: Partial<BlockerCard> = {}): BlockerCard {
  return {
    id: 'writes_disabled',
    severity: 'blokuje',
    resolution: 'mimo_appky' as BlockerResolutionCode,
    what: 'Zápisy do shopu sú vypnuté.',
    nextStep: 'Zapnúť ich môže len správca počítača.',
    path: null,
    assumed: false,
    clearsAt: null,
    ...patch,
  } as BlockerCard;
}

function statusRow(patch: Partial<StatusBlockerRow> = {}): StatusBlockerRow {
  return {
    id: 'writes_disabled',
    severity: 'blokuje',
    resolution: 'mimo_appky',
    what: 'Zápisy do shopu sú vypnuté.',
    nextStep: 'Zapnúť ich môže len správca počítača.',
    path: null,
    assumed: false,
    ...patch,
  };
}

/** Tri prekážky, tri úrovne závažnosti — sekcia sa musí otvoriť celá (bod 6). */
function threeLevels(): StatusBlockerRow[] {
  return [
    statusRow(),
    statusRow({ id: 'catalog_incomplete', severity: 'obmedzuje', resolution: 'sam' }),
    statusRow({ id: 'scope_pilot_cap', severity: 'informuje', resolution: 'cakanie' }),
  ];
}
