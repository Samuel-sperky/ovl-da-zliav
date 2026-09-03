/**
 * Aura Zľavy — OKNO KARIET A TABUĽKY JE JEDNO (V7, D149, D155, K3, K9).
 *
 * Statická strana toho, čo `prehlad-kpi-zapojenie.spec.ts` meria nad DOM-om.
 * DOM dokáže, že JEDEN prepínač prekresľuje karty a nesie okno na koreni
 * obrazovky. Nedokáže, že si ho o mesiac niekto nezdvojí: tabuľku Prehľadu
 * kreslí iný krok V7 a `useState` navyše je jeden riadok, ktorý v prehliadači
 * vyzerá úplne v poriadku — kým sa niekto nepozrie na obe čísla naraz.
 *
 * ČO SA TU MERIA A PREČO PRÁVE TAKTO
 * ──────────────────────────────────
 *
 *  A. **Zoznam okien sa neopisuje ručne** (K9). `SOLD_WINDOW_DAYS` musí byť
 *     ODVODENÝ zo `SOLD_WINDOWS` v `products/catalog-filter.ts`. Meria sa to
 *     dvakrát: hodnotami (musia sa rovnať) aj ČÍTANÍM ZDROJA (v module nesmie
 *     stáť literál zoznamu). Len hodnoty by nestačili — dve kópie sú v deň
 *     vzniku vždy rovnaké a rozídu sa až pri prvej zmene.
 *
 *  B. **Stav okna predaja má PRESNE JEDNO miesto.** Hľadá sa v každom `.tsx`
 *     v `components/dashboard/` deklarácia stavu, ktorá drží `SoldWindow`.
 *     Smie ju mať iba `Overview.tsx`. Kto pridá tabuľku s vlastným stavom,
 *     padne tu — nie až v prehliadači, kde by karta hovorila 30 dní a tabuľka
 *     360 a obe by vyzerali rovnako dôveryhodne.
 *
 *  C. **Zakázané slovo (K3, D148).** Karta nesie `soldPerStock` a volá sa
 *     „Predané na sklad". Meno účtovnej metriky nesmie padnúť ani ako kód, ani
 *     ako UI text, ani v docblocku — docblock je to, čo bude o rok čítať
 *     ďalší človek a z čoho si prevezme názov. Kontrolujú sa všetky nové
 *     súbory kroku; `test/unit/sales-insights.spec.ts` má tie isté súbory vo
 *     svojom zozname, takže pravidlo drží z dvoch strán.
 *
 *  D. **Prepínač nekreslí vlastný vzhľad** (D142). `SoldWindowSwitch` musí
 *     stáť na `ui/Segmented`; staré `.seg` z `globals.css` sa v ňom nesmie
 *     objaviť, inak by na jednej obrazovke boli dva rôzne prepínače tej istej
 *     veci.
 *
 * Vlastník: V7, krok 1/4 (KPI riadok a prepínače okna).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SOLD_WINDOWS } from '@/components/products/catalog-filter';
import { SOLD_WINDOW_CHOICES } from '@/lib/sales/windows';
import {
  DEFAULT_SOLD_WINDOW,
  SOLD_WINDOW_DAYS,
  isSoldWindow,
  soldWindowFromValue,
  soldWindowOptions,
  soldWindowValue,
} from '@/components/dashboard/sold-window';

const ROOT = process.cwd();
const DASHBOARD = resolve(ROOT, 'src/components/dashboard');

const read = (relPath: string): string => readFileSync(resolve(ROOT, relPath), 'utf8');

/** Komentáre von — docblocky v tomto repe o starých menách zámerne píšu. */
const bezKomentarov = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1 ');

/** Súbory kroku 1/4, ktoré vznikli alebo sa prepísali. */
const SUBORY_KROKU: readonly string[] = [
  'src/components/dashboard/sold-window.ts',
  'src/components/dashboard/SoldWindowSwitch.tsx',
  'src/components/dashboard/kpi-api.ts',
  'src/components/dashboard/kpi-row-model.ts',
  'src/components/dashboard/KpiRow.tsx',
];

/* ═══════════ A. Zoznam okien je odvodený, nie prepísaný (K9) ══════════════ */

describe('A. okná kariet sa berú zo `SOLD_WINDOWS`, nepíšu sa druhýkrát', () => {
  it('hodnoty sa rovnajú zdrojovému zoznamu', () => {
    /*
     * `SOLD_WINDOW_CHOICES` (`lib/sales/windows.ts`) je od D149 JEDINÝ zdroj:
     * odvodzuje sa z neho aj strop `SALES_WINDOW_DAYS` aj `ALLOWED_SOLD_WINDOWS`
     * v zrkadle. Prepínač Prehľadu musí sedieť s ním, nie s vlastnou kópiou.
     */
    expect([...SOLD_WINDOW_DAYS]).toEqual([...SOLD_WINDOW_CHOICES]);
    // A prepínač filtra Produktov ukazuje na to isté — inak by dve obrazovky
    // ponúkali dve rôzne ponuky okien tej istej veličiny.
    expect([...SOLD_WINDOW_DAYS]).toEqual([...SOLD_WINDOWS]);
    // A ponuka D155 je naozaj tá, ktorú zadanie menuje.
    expect([...SOLD_WINDOW_DAYS]).toEqual([30, 60, 90, 180, 360]);
  });

  it('v module nestojí literál zoznamu — inak sú to dve kópie', () => {
    const kod = bezKomentarov(read('src/components/dashboard/sold-window.ts'));
    expect(kod).toContain("from '@/lib/sales/windows'");
    // Ani zoznam v hranatých zátvorkách, ani jednotlivé okná ako literály.
    expect(/\[\s*30\s*,\s*60\s*,/.test(kod), 'zoznam okien je tu prepísaný ručne').toBe(false);
    for (const days of [60, 180, 360]) {
      expect(
        new RegExp(`\\b${String(days)}\\b`).test(kod),
        `okno ${String(days)} je v module napísané ručne`,
      ).toBe(false);
    }
  });

  it('predvolené okno je z ponuky a prevod tam a späť je jedna cesta', () => {
    expect(isSoldWindow(DEFAULT_SOLD_WINDOW)).toBe(true);
    for (const days of SOLD_WINDOW_DAYS) {
      expect(soldWindowFromValue(soldWindowValue(days)), String(days)).toBe(days);
    }
    // Fail-closed: čokoľvek mimo zoznamu okno NEZMENÍ (žiadny tichý fallback).
    for (const bad of ['14', '', 'tridsat', '30.5', '361']) {
      expect(soldWindowFromValue(bad), bad).toBeNull();
    }
    expect(isSoldWindow(7)).toBe(false);
  });

  it('každá možnosť prepínača má číslo na tlačidle a frázu pre čítačku', () => {
    const options = soldWindowOptions();
    expect(options.map((o) => o.label)).toEqual(SOLD_WINDOW_DAYS.map((d) => String(d)));
    for (const option of options) {
      // „180" nepovie nič, „180 dní" povie — presne preto `Segmented` prop má.
      expect(option.title, option.value).toMatch(/^\d+ (deň|dni|dní)$/);
    }
  });
});

/* ═══════════ B. Stav okna predaja má jedno miesto (D155) ══════════════════ */

describe('B. druhý stav okna predaja by rozišiel karty s tabuľkou', () => {
  it('`SoldWindow` v `useState` drží iba `Overview.tsx`', () => {
    const drzitelia: string[] = [];
    for (const entry of readdirSync(DASHBOARD, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.tsx')) continue;
      const kod = bezKomentarov(readFileSync(join(DASHBOARD, entry.name), 'utf8'));
      if (/useState\s*<\s*SoldWindow\s*>/.test(kod)) drzitelia.push(entry.name);
    }
    expect(
      drzitelia,
      'okno kariet a tabuľky je JEDEN stav (D155) a leží v Overview.tsx — ' +
        'tabuľka si ho berie odtiaľ, vlastný otvoriť nesmie',
    ).toEqual(['Overview.tsx']);
  });

  it('koreň Prehľadu okno naozaj vypisuje — tabuľka z toho čerpá', () => {
    const kod = bezKomentarov(read('src/components/dashboard/Overview.tsx'));
    expect(kod).toContain('data-sold-window={soldWindow}');
    // Prepínač aj rad kariet dostávajú TÚ ISTÚ premennú, nie dve.
    expect(kod).toContain('<SoldWindowSwitch value={soldWindow}');
    expect(kod).toContain('windowDays={soldWindow}');
  });
});

/* ═══════════ C. Zakázané slovo účtovnej metriky (K3, D148) ════════════════ */

describe('C. karta sa volá „Predané na sklad" a nič iné', () => {
  it('v súboroch kroku nie je meno účtovnej metriky ani ako slovo v komentári', () => {
    for (const path of SUBORY_KROKU) {
      const kod = read(path);
      expect(/\bturnover\b/i.test(kod), `${path} nesmie mať metriku obrátkovosti`).toBe(false);
      expect(/\bobrátkovos/i.test(kod), `${path} nesmie to slovo použiť ani v texte`).toBe(
        false,
      );
      expect(/\bcogs\s*[=:]/i.test(kod), `${path} nesmie dopočítavať COGS`).toBe(false);
    }
  });

  it('meno karty stojí v modeli presne raz a je to zabehnutý tvar', () => {
    const kod = read('src/components/dashboard/kpi-row-model.ts');
    expect(kod).toContain("'Predané na sklad'");
    expect(kod).toContain('soldPerStock');
  });
});

/* ═══════════ D. Prepínač stojí na primitíve, nie na starom `.seg` ════════ */

describe('D. prepínač okna kariet nekreslí vlastný vzhľad (D142)', () => {
  it('používa `ui/Segmented` a staré `.seg` v ňom nie je', () => {
    const kod = read('src/components/dashboard/SoldWindowSwitch.tsx');
    expect(kod).toContain("from '@/components/ui/Segmented'");
    expect(bezKomentarov(kod)).not.toContain("className=\"seg\"");
  });
});

/* ═══════════ E. D154 — silné číslo, tlmený popisok NAD ním ════════════════ */

/**
 * „Slabé čísla" a „malé písmo" boli dve zo štyroch príčin, pre ktoré Samuel
 * označil V6 za nečitateľný, takže veľkosť KPI čísla je ROZHODNUTIE (D154), nie
 * kozmetika — a rozhodnutia sa v tomto repe merajú.
 *
 * Meria sa CSS AKO TEXT, presne ako v `prehlad-rad-dlazdic.spec.ts`: vitest
 * rieši `.module.css` Proxy-om, takže vykreslený markup o skutočnej veľkosti
 * písma nepovie nič. Kontroluje sa aj TVAR selektora — pravidlo o veľkosti,
 * ktoré prehrá špecifickosťou s `.kpi .v` z `globals.css`, by v prehliadači
 * nenakreslilo nič a v teste na prítomnosť reťazca by zostalo zelené.
 */
describe('E. D154 — číslo karty je ~40 px a má tabulárne číslice', () => {
  const MODUL = read('src/components/dashboard/kpi-row.module.css');

  /** Telo pravidla s presne týmto selektorom. `null`, keď tam nie je. */
  function telo(selektor: string): string | null {
    const escaped = selektor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:^|[{};])\\s*${escaped}\\s*\\{([^{}]*)\\}`);
    const m = re.exec(MODUL.replace(/\/\*[\s\S]*?\*\//g, ''));
    return m === null ? null : (m[1] ?? '').trim();
  }

  function vlastnost(body: string | null, meno: string): string | null {
    if (body === null) return null;
    const m = new RegExp(`(?:^|;)\\s*${meno}\\s*:\\s*([^;]+)`).exec(body);
    return m === null ? null : (m[1] ?? '').trim();
  }

  it('rad má TRI rovnaké stĺpce a prebíja `auto-fit` z globals', () => {
    const body = telo(':global(.kpis).row');
    expect(body, 'pravidlo mriežky radu chýba').not.toBeNull();
    expect(vlastnost(body, 'grid-template-columns')).toBe('repeat(3, minmax(0, 1fr))');
  });

  it('hodnota má 2,5 rem (40 px) a zarovnané číslice', () => {
    /* Selektor musí mať TRI triedy — `.kpi .v` z globals má dve a pri rovnakej
       špecifickosti by o veľkosti rozhodlo poradie súborov v zlepenom hárku. */
    const body = telo('.row :global(.kpi) :global(.v)');
    expect(body, 'pravidlo hodnoty chýba alebo má iný selektor').not.toBeNull();
    expect(vlastnost(body, 'font-size')).toBe('2.5rem');
    expect(vlastnost(body, 'font-variant-numeric')).toContain('tabular-nums');
  });

  it('popisok je menší, tlmený tokenom a má odstup od čísla', () => {
    const body = telo('.row :global(.kpi) :global(.k)');
    expect(body, 'pravidlo popisku chýba alebo má iný selektor').not.toBeNull();
    // Farba sa NEPÍŠE, berie sa z tokenu (D147) — a po D164 je aj `--dim` 7 : 1,
    // takže odstup nesie veľkosť, nie sila farby (R1).
    expect(vlastnost(body, 'color')).toBe('var(--dim)');
    expect(vlastnost(body, 'font-size')).toBe('var(--ovl-fs-label-tile)');
    expect(vlastnost(body, 'margin-bottom')).toBe('var(--ovl-s2)');
  });

  it('v module nie je ani hex, ani rgba(), ani !important (D147)', () => {
    const bez = MODUL.replace(/\/\*[\s\S]*?\*\//g, ' ');
    expect(/#[0-9a-f]{3,8}\b/i.test(bez)).toBe(false);
    expect(/rgba?\(/i.test(bez)).toBe(false);
    expect(bez).not.toContain('!important');
  });
});
