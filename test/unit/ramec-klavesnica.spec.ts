/**
 * Aura Zľavy — RÁMEC STRÁNKY POD KLÁVESNICOU (`Tabs`, `Segmented`).
 *
 * @vitest-environment jsdom
 *
 * PREČO MÁ TENTO SÚBOR VLASTNÉ PROSTREDIE
 * ---------------------------------------
 * Zvyšok merania rámca je v `test/unit/ramec-stranky.spec.ts` a beží bez
 * prehliadača (`environment: 'node'`) — čistá logika pohybu a vykreslený
 * markup. Tri veci sa tam ale zmerať NEDAJÚ a práve ony sú na prepínači to
 * najkrehkejšie:
 *
 *   1. **`keydown` sa musí naozaj doručiť** — obsluha visí na koreni skupiny,
 *      nie na tlačidle, takže udalosť musí prebublať.
 *   2. **Fokus ide ZA výberom.** Prepínač je jeden zastavovací bod tabulátora
 *      (roving `tabIndex`). Keby po klávese fokus zostal na starom tlačidle,
 *      to by v tom istom okamihu prestalo byť zastavovacím bodom a človek by
 *      mal fokus na prvku, ktorý už nie je vybraný ani dosiahnuteľný
 *      tabulátorom. Statický render o fokuse nevie nič.
 *   3. **`preventDefault` len na vlastných klávesách.** Prepínač, ktorý
 *      spolkne `PageDown`, zoberie stránke posun.
 *
 * Je to druhý súbor projektu s `jsdom` (prvý je `detail-panel-fokus.spec.ts`)
 * a je to zámerne len na to, čo bez DOM-u nejde.
 *
 * ČO ANI TENTO SÚBOR NEZMERÁ
 * --------------------------
 * jsdom nepočíta rozloženie, takže samotný `Tab` sa tu prejsť nedá
 * (`offsetParent` je vždy `null` a prehliadač si poradie tabulátora počíta
 * sám). Meria sa teda to, čo merateľné je: kam ide fokus po šípke, ktorý
 * prvok drží `tabIndex="0"` a čo sa stalo s výberom.
 *
 * Vlastník: V6a (rámec stránky).
 */
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import Segmented, { type SegmentedOption } from '@/components/ui/Segmented';
import Tabs, { type TabItem } from '@/components/ui/Tabs';

type Zalozka = 'prehlad' | 'polozky' | 'priebeh';
type Okno = '7' | '30' | '90';

const ZALOZKY: readonly TabItem<Zalozka>[] = [
  { value: 'prehlad', label: 'Prehľad' },
  { value: 'polozky', label: 'Položky', count: 7 },
  { value: 'priebeh', label: 'Priebeh', count: null },
];

const OKNA: readonly SegmentedOption<Okno>[] = [
  { value: '7', label: '7', title: '7 dní' },
  { value: '30', label: '30', title: '30 dní' },
  { value: '90', label: '90', title: '90 dní' },
];

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  // React 19 chce vedieť, že sme v `act` prostredí, inak varuje pri každom
  // prekreslení. Príznak žije na `globalThis`, nie v type — odtiaľ `as`.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/**
 * Prepínač so skutočným stavom. Komponenty sú riadené (hodnotu vlastní
 * obrazovka), takže bez stavu by sa výber po klávese nikdy neprekreslil
 * a test by meral atrapu.
 */
function vykresliZalozky(
  zaciatok: Zalozka,
  items: readonly TabItem<Zalozka>[] = ZALOZKY,
): { zmeny: Zalozka[] } {
  const zmeny: Zalozka[] = [];
  function Riadene() {
    const [value, setValue] = useState<Zalozka>(zaciatok);
    return createElement(Tabs<Zalozka>, {
      value,
      onChange: (v: Zalozka) => {
        zmeny.push(v);
        setValue(v);
      },
      items,
      ariaLabel: 'Časti detailu zľavy',
      idBase: 'zlava-',
    });
  }
  act(() => root.render(createElement(Riadene)));
  return { zmeny };
}

function vykresliOkna(
  zaciatok: Okno,
  options: readonly SegmentedOption<Okno>[] = OKNA,
): { zmeny: Okno[] } {
  const zmeny: Okno[] = [];
  function Riadene() {
    const [value, setValue] = useState<Okno>(zaciatok);
    return createElement(Segmented<Okno>, {
      value,
      onChange: (v: Okno) => {
        zmeny.push(v);
        setValue(v);
      },
      options,
      ariaLabel: 'Za koľko dní sa počítajú predané kusy',
    });
  }
  act(() => root.render(createElement(Riadene)));
  return { zmeny };
}

/** Tlačidlá prepínača v poradí, v akom stoja v DOM-e. */
function tlacidla(role: 'tab' | 'radio'): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>(`[role="${role}"]`)];
}

/** Ktoré tlačidlo je vybrané podľa ARIA (nie podľa farby). */
function vybrane(role: 'tab' | 'radio'): string | null {
  const atribut = role === 'tab' ? 'aria-selected' : 'aria-checked';
  const uzol = container.querySelector<HTMLButtonElement>(`[role="${role}"][${atribut}="true"]`);
  return uzol === null ? null : (uzol.textContent ?? '');
}

/** Ktoré tlačidlo drží zastavovací bod tabulátora. */
function zastavovaciBod(role: 'tab' | 'radio'): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`[role="${role}"][tabindex="0"]`);
}

/**
 * Stlač klávesu na prvku, ktorý má fokus. Udalosť bubbluje — obsluha visí na
 * koreni skupiny, nie na tlačidle, a keby nebublala, nezachytil by ju nikto.
 */
function stlac(key: string): KeyboardEvent {
  const cielny = document.activeElement;
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    (cielny ?? document.body).dispatchEvent(event);
  });
  return event;
}

/* ═══════════════════════════════ 1. Tabs ══════════════════════════════════ */

describe('Tabs — klávesnica', () => {
  it('šípka vpravo posunie výber AJ fokus', () => {
    const { zmeny } = vykresliZalozky('prehlad');
    tlacidla('tab')[0]!.focus();

    stlac('ArrowRight');

    expect(zmeny).toEqual(['polozky']);
    expect(vybrane('tab')).toContain('Položky');
    /* Bod 2 hlavičky: fokus musí ísť za výberom, inak zostane na prvku,
       ktorý už nie je zastavovacím bodom tabulátora. */
    expect(document.activeElement).toBe(tlacidla('tab')[1]);
    expect(zastavovaciBod('tab')).toBe(tlacidla('tab')[1]);
  });

  it('šípka vľavo z prvej záložky obehne na poslednú', () => {
    vykresliZalozky('prehlad');
    tlacidla('tab')[0]!.focus();

    stlac('ArrowLeft');

    expect(vybrane('tab')).toContain('Priebeh');
    expect(document.activeElement).toBe(tlacidla('tab')[2]);
  });

  it('Home a End skáču na kraje', () => {
    vykresliZalozky('polozky');
    tlacidla('tab')[1]!.focus();

    stlac('End');
    expect(vybrane('tab')).toContain('Priebeh');
    expect(document.activeElement).toBe(tlacidla('tab')[2]);

    stlac('Home');
    expect(vybrane('tab')).toContain('Prehľad');
    expect(document.activeElement).toBe(tlacidla('tab')[0]);
  });

  it('↑ a ↓ nechá vodorovný tablist na pokoji — stránka ich potrebuje', () => {
    const { zmeny } = vykresliZalozky('polozky');
    tlacidla('tab')[1]!.focus();

    const dole = stlac('ArrowDown');
    const hore = stlac('ArrowUp');

    expect(zmeny).toEqual([]);
    expect(vybrane('tab')).toContain('Položky');
    expect(dole.defaultPrevented, 'ArrowDown sa nesmie spolknúť').toBe(false);
    expect(hore.defaultPrevented, 'ArrowUp sa nesmie spolknúť').toBe(false);
  });

  it('cudziu klávesu nespolkne — inak zoberie stránke posun', () => {
    vykresliZalozky('prehlad');
    tlacidla('tab')[0]!.focus();

    for (const key of ['PageDown', 'Tab', 'a', 'Escape']) {
      const event = stlac(key);
      expect(event.defaultPrevented, key).toBe(false);
    }
  });

  it('vlastnú klávesu spolkne — prehliadač by ňou inak scrolloval', () => {
    vykresliZalozky('prehlad');
    tlacidla('tab')[0]!.focus();

    expect(stlac('ArrowRight').defaultPrevented).toBe(true);
    expect(stlac('End').defaultPrevented).toBe(true);
  });

  it('zakázaná záložka nie je v obehu klávesnice', () => {
    const { zmeny } = vykresliZalozky('prehlad', [
      { value: 'prehlad', label: 'Prehľad' },
      { value: 'polozky', label: 'Položky', disabled: true },
      { value: 'priebeh', label: 'Priebeh' },
    ]);
    tlacidla('tab')[0]!.focus();

    stlac('ArrowRight');

    /* Klávesa, ktorá zastaví na zakázanej položke, je horšia než klávesa,
       ktorá nerobí nič. */
    expect(zmeny).toEqual(['priebeh']);
    expect(vybrane('tab')).toContain('Priebeh');
    expect(document.activeElement).toBe(tlacidla('tab')[2]);
  });

  it('klik vyberie záložku bez toho, aby o fokus zápasil', () => {
    const { zmeny } = vykresliZalozky('prehlad');

    act(() => {
      tlacidla('tab')[2]!.click();
    });

    expect(zmeny).toEqual(['priebeh']);
    expect(vybrane('tab')).toContain('Priebeh');
  });

  it('opakovaná klávesa na tej istej záložke nevyvolá zbytočnú zmenu', () => {
    const { zmeny } = vykresliZalozky('prehlad');
    tlacidla('tab')[0]!.focus();

    stlac('Home');

    /* `Home` na prvej záložke je pohyb na sebe — výber sa nemení, takže sa
       obrazovke nehlási zmena, ktorá sa nestala. */
    expect(zmeny).toEqual([]);
    expect(document.activeElement).toBe(tlacidla('tab')[0]);
  });
});

/* ════════════════════════════ 2. Segmented ════════════════════════════════ */

describe('Segmented — klávesnica', () => {
  it('šípka vpravo posunie voľbu AJ fokus', () => {
    const { zmeny } = vykresliOkna('7');
    tlacidla('radio')[0]!.focus();

    stlac('ArrowRight');

    expect(zmeny).toEqual(['30']);
    expect(vybrane('radio')).toBe('30');
    expect(document.activeElement).toBe(tlacidla('radio')[1]);
    expect(zastavovaciBod('radio')).toBe(tlacidla('radio')[1]);
  });

  it('↑ a ↓ v skupine rádií FUNGUJÚ — nemá vlastný posuv (APG)', () => {
    const { zmeny } = vykresliOkna('30');
    tlacidla('radio')[1]!.focus();

    const dole = stlac('ArrowDown');
    expect(vybrane('radio')).toBe('90');
    expect(dole.defaultPrevented).toBe(true);

    const hore = stlac('ArrowUp');
    expect(vybrane('radio')).toBe('30');
    expect(hore.defaultPrevented).toBe(true);

    expect(zmeny).toEqual(['90', '30']);
  });

  it('šípka vľavo z prvej voľby obehne na poslednú', () => {
    vykresliOkna('7');
    tlacidla('radio')[0]!.focus();

    stlac('ArrowLeft');

    expect(vybrane('radio')).toBe('90');
    expect(document.activeElement).toBe(tlacidla('radio')[2]);
  });

  it('Home a End skáču na kraje', () => {
    vykresliOkna('30');
    tlacidla('radio')[1]!.focus();

    stlac('Home');
    expect(vybrane('radio')).toBe('7');

    stlac('End');
    expect(vybrane('radio')).toBe('90');
    expect(document.activeElement).toBe(tlacidla('radio')[2]);
  });

  it('cudziu klávesu nespolkne', () => {
    vykresliOkna('7');
    tlacidla('radio')[0]!.focus();

    for (const key of ['PageDown', 'Tab', 'x']) {
      expect(stlac(key).defaultPrevented, key).toBe(false);
    }
  });

  it('zakázaná voľba nie je v obehu klávesnice', () => {
    const { zmeny } = vykresliOkna('7', [
      { value: '7', label: '7' },
      { value: '30', label: '30', disabled: true },
      { value: '90', label: '90' },
    ]);
    tlacidla('radio')[0]!.focus();

    stlac('ArrowRight');

    expect(zmeny).toEqual(['90']);
    expect(vybrane('radio')).toBe('90');
    expect(document.activeElement).toBe(tlacidla('radio')[2]);
  });

  it('medzerník a Enter na zaostrenom rádiu robí prehliadač sám (je to button)', () => {
    /*
     * Netreba pre ne vlastnú obsluhu: `<button>` na medzerník a Enter kliká
     * natívne. Test drží, že sa z rádia nestal `<div>` — vtedy by prestali
     * fungovať a nikto by si to nevšimol.
     */
    vykresliOkna('7');
    for (const uzol of tlacidla('radio')) {
      expect(uzol.tagName).toBe('BUTTON');
      expect(uzol.getAttribute('type')).toBe('button');
    }
  });

  it('hodnota mimo zoznamu nezhodí skupinu z tabulátora a klávesa ju opraví', () => {
    const { zmeny } = vykresliOkna('365' as Okno);

    /* Zastupuje prvá povolená voľba — inak sa k prepínaču klávesnicou vôbec
       nedá dostať. */
    const bod = zastavovaciBod('radio');
    expect(bod).toBe(tlacidla('radio')[0]);
    expect(vybrane('radio')).toBe(null);

    bod!.focus();
    stlac('ArrowRight');

    expect(zmeny).toEqual(['30']);
    expect(vybrane('radio')).toBe('30');
  });
});
