/**
 * Aura Zľavy — RÁMEC STRÁNKY: `Panel`, `PageHeader`, `Tabs`, `Segmented`
 * (D133, D142; V6a, 2. 9. 2026).
 *
 * ČO TENTO SÚBOR MERIA A ČO NECHÁVA SUSEDOVI
 * ------------------------------------------
 * Tu je všetko, čo sa dá zmerať BEZ prehliadača: čistá logika pohybu
 * klávesnicou, vykreslený markup (`renderToStaticMarkup`) a hygiena
 * `frame.module.css`. Skutočný `keydown`, fokus a roving `tabIndex` v behu
 * meria `test/unit/ramec-klavesnica.spec.ts` — má na to vlastné prostredie
 * `jsdom` a je to tam jediný dôvod, prečo ho má.
 *
 * Rozdelenie nie je pohodlie: pohyb výberu je čistá funkcia práve preto, aby
 * krajné prípady (jediná položka, všetky zakázané, hodnota mimo zoznamu)
 * nemuseli platiť jeden drahý DOM-ový test — v ňom by sa napísali tri a
 * zvyšných deväť by nemal kto pokryť.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 *  A. **Výber visí na ARIA atribúte, nie na triede.** Tvrdenia o vzhľade
 *     výberu sa pýtajú na selektor `[aria-selected='true']` /
 *     `[aria-checked='true']` v `frame.module.css`. Keby vzhľad výberu
 *     niesla vlastná trieda, dal by sa nakresliť vybraný prvok, o ktorom
 *     čítačka nevie — a to je porušenie pravidla troch kanálov, ktoré by
 *     nikto nevidel (§4 bod 3).
 *
 *  B. **Farba nie je jediný kanál.** Vybraná záložka musí mať okrem farby aj
 *     TVAR (podčiarknutie), zvolený segment plochu s okrajom. Test to meria
 *     nad pravidlom v CSS, nie nad dojmom.
 *
 *  C. **Počet na záložke je trojstavový (I11).** `undefined` = žiadne číslo,
 *     `null` = pomlčka U+2014, číslo = číslo. Nula je tvrdenie a nesmie
 *     zastupovať nevedomosť.
 *
 *  D. **Modul nesmie mať vlastnú farbu.** Žiadny surový hex, žiadne `rgba()`
 *     ani `rgb(… / …)`, žiadny `!important` (D132, D144, D147). Toto je
 *     miestna poistka pre štyri súbory rámca; celoplošný strážny test nad
 *     všetkými `*.module.css` je práca iného agenta V6a a tento test ju
 *     nenahrádza — len nedovolí, aby sa medzi ne tieto štyri prepašovali
 *     skôr, než ten strážca vznikne.
 *
 * Vlastník: V6a (rámec stránky).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import PageHeader from '@/components/ui/PageHeader';
import { Panel, PanelBody, PanelFoot, PanelHead } from '@/components/ui/Panel';
import Segmented from '@/components/ui/Segmented';
import Tabs from '@/components/ui/Tabs';
import {
  RADIO_MOVE_KEYS,
  TAB_MOVE_KEYS,
  joinClasses,
  nextRadioIndex,
  nextTabIndex,
  tabCountText,
  tabId,
  tabPanelId,
} from '@/components/ui/frame';
import { NEVIEME } from '@/lib/ui/product-label';

import { bezKomentarov } from '../helpers/css-stavy';

const CSS_SUROVE = readFileSync(
  resolve(process.cwd(), 'src/components/ui/frame.module.css'),
  'utf8',
);
/** Komentáre smú spomínať čokoľvek — pravidlá sa hľadajú bez nich. */
const CSS = bezKomentarov(CSS_SUROVE);

/* ═══════════════════ 1. Pohyb klávesnicou ako čistá funkcia ═══════════════ */

describe('nextTabIndex — vodorovný tablist', () => {
  it('šípky obiehajú dokola, Home a End skáču na kraje', () => {
    expect(nextTabIndex('ArrowRight', 3, 0)).toBe(1);
    expect(nextTabIndex('ArrowRight', 3, 2)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 3, 0)).toBe(2);
    expect(nextTabIndex('ArrowLeft', 3, 1)).toBe(0);
    expect(nextTabIndex('Home', 3, 2)).toBe(0);
    expect(nextTabIndex('End', 3, 0)).toBe(2);
  });

  it('↑ a ↓ vodorovný tablist NEBERIE — stránka ich potrebuje na posun', () => {
    expect(nextTabIndex('ArrowUp', 3, 1)).toBe(null);
    expect(nextTabIndex('ArrowDown', 3, 1)).toBe(null);
  });

  it('cudzia klávesa nehýbe ničím', () => {
    for (const key of ['a', 'Enter', ' ', 'Tab', 'Escape', 'PageDown']) {
      expect(nextTabIndex(key, 3, 0), key).toBe(null);
    }
  });

  it('prázdny prepínač nemá kam ísť', () => {
    for (const key of TAB_MOVE_KEYS) {
      expect(nextTabIndex(key, 0, -1), key).toBe(null);
      expect(nextTabIndex(key, -1, 0), key).toBe(null);
    }
  });

  it('jediná položka zostáva na sebe, nie mimo zoznamu', () => {
    for (const key of TAB_MOVE_KEYS) {
      expect(nextTabIndex(key, 1, 0), key).toBe(0);
    }
  });

  it('hodnota mimo zoznamu sa počíta od prvej položky, nie od nikoho', () => {
    /*
     * Toto je bod B hlavičky `frame.ts`: keď je vybraná položka zakázaná,
     * `current` je -1. Prepínač, ktorý na klávesu nereaguje, vyzerá ako
     * zamrznutá obrazovka.
     */
    expect(nextTabIndex('ArrowRight', 3, -1)).toBe(1);
    expect(nextTabIndex('ArrowLeft', 3, -1)).toBe(2);
    expect(nextTabIndex('ArrowRight', 3, 99)).toBe(1);
  });
});

describe('nextRadioIndex — skupina rádií', () => {
  it('berie aj ↑ a ↓, pretože skupina rádií nemá vlastný posuv', () => {
    expect(nextRadioIndex('ArrowDown', 3, 0)).toBe(1);
    expect(nextRadioIndex('ArrowUp', 3, 0)).toBe(2);
    expect(nextRadioIndex('ArrowDown', 3, 2)).toBe(0);
  });

  it('vodorovné šípky, Home a End robia to isté ako v tabliste', () => {
    for (const key of TAB_MOVE_KEYS) {
      expect(nextRadioIndex(key, 4, 1), key).toBe(nextTabIndex(key, 4, 1));
    }
  });

  it('cudzia klávesa nehýbe ničím', () => {
    for (const key of ['x', 'Enter', 'Tab', 'Backspace']) {
      expect(nextRadioIndex(key, 3, 0), key).toBe(null);
    }
  });

  it('všetkých šesť ohlásených klávesov naozaj hýbe', () => {
    /* Zoznam v `RADIO_MOVE_KEYS` je sľub obrazovke — musí byť pravdivý. */
    for (const key of RADIO_MOVE_KEYS) {
      expect(nextRadioIndex(key, 4, 1), key).not.toBe(null);
    }
  });
});

/* ═════════════════════ 2. Priznanie „nevieme" v počte ═════════════════════ */

describe('tabCountText — počet na záložke je trojstavový (I11)', () => {
  it('null je POMLČKA, nie nula', () => {
    expect(tabCountText(null)).toBe(NEVIEME);
    expect(tabCountText(null)).toBe('—');
    expect(tabCountText(null)).not.toBe('0');
  });

  it('nula je nula — je to tvrdenie a smie sa povedať', () => {
    expect(tabCountText(0)).toBe('0');
  });

  it('nečíslo je tiež „nevieme"', () => {
    expect(tabCountText(Number.NaN)).toBe(NEVIEME);
    expect(tabCountText(Number.POSITIVE_INFINITY)).toBe(NEVIEME);
  });

  it('tisíce sa oddeľujú tak ako inde v appke', () => {
    expect(tabCountText(41_348)).toBe('41 348');
  });
});

/* ═══════════════════════ 3. Identifikátory záložiek ═══════════════════════ */

describe('tabId a tabPanelId — lišta a panel sa nemôžu rozísť', () => {
  it('záložka a jej panel majú RÔZNE id nad tou istou hodnotou', () => {
    expect(tabId('r1-', 'polozky')).not.toBe(tabPanelId('r1-', 'polozky'));
  });

  it('dve skupiny s tými istými hodnotami nevyrobia rovnaké id', () => {
    expect(tabId('a-', 'prehlad')).not.toBe(tabId('b-', 'prehlad'));
  });

  it('id neobsahuje medzeru — inak sa naň nedá odkázať z aria-controls', () => {
    expect(tabId('r1-', 'polozky')).not.toMatch(/\s/);
    expect(tabPanelId('r1-', 'polozky')).not.toMatch(/\s/);
  });
});

describe('joinClasses', () => {
  it('nepravdivé časti vypadnú — v DOM-e nikdy nezostane „undefined"', () => {
    expect(joinClasses('a', undefined, null, false, '', 'b')).toBe('a b');
    expect(joinClasses(undefined, null)).toBe('');
  });
});

/* ══════════════════════ 4. Vykreslený markup — Panel ══════════════════════ */

describe('Panel — plocha s hlavičkou aj bez', () => {
  it('plocha bez hlavičky je plocha bez hlavičky (žiadny príznak netreba)', () => {
    const html = renderToStaticMarkup(
      createElement(Panel, {}, createElement(PanelBody, {}, 'obsah')),
    );
    expect(html).not.toContain('<h2');
    expect(html).not.toContain('<h3');
    expect(html).toContain('obsah');
  });

  it('hlavička nesie popisok, podtitul a akcie vpravo', () => {
    const html = renderToStaticMarkup(
      createElement(
        Panel,
        {},
        createElement(PanelHead, {
          title: 'Rozpočet zápisov',
          subtitle: 'za posledných 30 dní',
          actions: createElement('button', { type: 'button' }, 'Obnoviť'),
        }),
        createElement(PanelBody, {}, '96 / 240'),
        createElement(PanelFoot, {}, createElement('button', { type: 'button' }, 'Zavrieť')),
      ),
    );
    expect(html).toContain('<h2>Rozpočet zápisov</h2>');
    expect(html).toContain('za posledných 30 dní');
    expect(html).toContain('Obnoviť');
    expect(html).toContain('Zavrieť');
  });

  it('`as` mení STUPEŇ nadpisu — kvôli osnove, nie kvôli veľkosti', () => {
    const h3 = renderToStaticMarkup(
      createElement(PanelHead, { as: 'h3', title: 'Priebeh zápisu' }),
    );
    expect(h3).toContain('<h3>Priebeh zápisu</h3>');
    expect(h3).not.toContain('<h2');
  });

  it('hlavička s vlastným obsahom NEKRESLÍ aj popisok — je to náhrada', () => {
    const html = renderToStaticMarkup(
      createElement(PanelHead, { title: 'Nemá sa objaviť' }, createElement('span', {}, 'vlastné')),
    );
    expect(html).toContain('vlastné');
    expect(html).not.toContain('Nemá sa objaviť');
  });

  it('vnorená plocha má inú triedu než hostiteľská', () => {
    const tvrdy = renderToStaticMarkup(createElement(Panel, {}));
    const mierny = renderToStaticMarkup(createElement(Panel, { soft: true }));
    expect(tvrdy).not.toBe(mierny);
  });

  it('vlastná trieda a atribúty prežijú — plocha nie je slepá', () => {
    /*
     * `Panel` rozprestiera zvyšok propov na `<div>`, takže obrazovka mu smie
     * poslať `id`, `aria-*` aj `data-*`. Tu sa meria `id` a `aria-label`:
     * `data-*` sa cez `createElement` typovo nedá zapísať (v JSX áno), a to,
     * čo test naozaj stráži, je zachovaný rozprestrený zvyšok.
     */
    const html = renderToStaticMarkup(
      createElement(Panel, { className: 'vlastna', id: 'panel-rozpocet', 'aria-label': 'Rozpočet' }),
    );
    expect(html).toContain('vlastna');
    expect(html).toContain('id="panel-rozpocet"');
    expect(html).toContain('aria-label="Rozpočet"');
  });

  it('telo bez odsadenia sa od bežného líši', () => {
    const bezne = renderToStaticMarkup(createElement(PanelBody, {}, 'x'));
    const flush = renderToStaticMarkup(createElement(PanelBody, { flush: true }, 'x'));
    expect(flush).not.toBe(bezne);
  });
});

/* ═══════════════════ 5. Vykreslený markup — PageHeader ════════════════════ */

describe('PageHeader — nadpis, popis a akcie vpravo', () => {
  const html = renderToStaticMarkup(
    createElement(PageHeader, {
      eyebrow: 'Nastavenia',
      title: 'Kľúče a rozsah',
      description: 'Zápisový kľúč platí 48 hodín; objednávkový 30 dní.',
      actions: createElement('button', { type: 'button' }, 'Obnoviť kľúč'),
      testId: 'hlavicka-nastavenia',
    }),
  );

  it('nadpis stránky je h1 a je práve jeden', () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('<h1>Kľúče a rozsah</h1>');
  });

  it('kreslí nadkapitolu, popis aj akcie', () => {
    expect(html).toContain('Nastavenia');
    expect(html).toContain('Zápisový kľúč platí 48 hodín');
    expect(html).toContain('Obnoviť kľúč');
  });

  it('je to `header`, nie `div` — čítačka podľa toho hľadá začiatok stránky', () => {
    expect(html.startsWith('<header')).toBe(true);
    expect(html).toContain('data-testid="hlavicka-nastavenia"');
  });

  it('bez popisu a akcií nekreslí prázdne obaly', () => {
    const holy = renderToStaticMarkup(createElement(PageHeader, { title: 'Prehľad' }));
    expect(holy).toContain('<h1>Prehľad</h1>');
    expect(holy.match(/<p/g)).toBe(null);
    expect(holy.match(/<div/g)).toHaveLength(1);
  });

  it('značka je pre čítačku nevidteľná — význam nesie nadpis, nie obrázok', () => {
    const so = renderToStaticMarkup(
      createElement(PageHeader, { title: 'Zľavy', icon: createElement('svg', {}) }),
    );
    expect(so).toContain('aria-hidden="true"');
  });
});

/* ══════════════════════ 6. Vykreslený markup — Tabs ═══════════════════════ */

describe('Tabs — tri kanály výberu a poctivé počty', () => {
  type Zalozka = 'prehlad' | 'polozky' | 'priebeh';
  const ITEMS = [
    { value: 'prehlad' as Zalozka, label: 'Prehľad' },
    { value: 'polozky' as Zalozka, label: 'Položky', count: 7 },
    { value: 'priebeh' as Zalozka, label: 'Priebeh', count: null },
  ];

  const html = renderToStaticMarkup(
    createElement(Tabs<Zalozka>, {
      value: 'polozky',
      onChange: () => {},
      items: ITEMS,
      ariaLabel: 'Časti detailu zľavy',
      idBase: 'zlava-',
      testId: 'zalozky-zlavy',
    }),
  );

  it('lišta je tablist a MÁ MENO — bez mena nepovie, čo prepína', () => {
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Časti detailu zľavy"');
    expect(html).toContain('data-testid="zalozky-zlavy"');
  });

  it('vybraná záložka to hlási ARIA, nie len farbou', () => {
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html.match(/aria-selected="false"/g)).toHaveLength(2);
  });

  it('každá záložka má id a ukazuje na svoj panel', () => {
    for (const item of ITEMS) {
      expect(html, item.value).toContain(`id="${tabId('zlava-', item.value)}"`);
      expect(html, item.value).toContain(`aria-controls="${tabPanelId('zlava-', item.value)}"`);
    }
  });

  it('roving tabIndex: zastavovací bod tabulátora je JEDEN', () => {
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(2);
  });

  it('neznámy počet je POMLČKA, nie nula (I11)', () => {
    expect(html).toContain('>7<');
    expect(html).toContain(`>${NEVIEME}<`);
    /* Záložka bez `count` nemá číslo vôbec — nie nulu. */
    expect(html.indexOf('Prehľad')).toBeGreaterThan(-1);
    expect(html).not.toContain('>0<');
  });

  it('popisy sú slovenské (§4 bod 4)', () => {
    for (const slovo of ['Prehľad', 'Položky', 'Priebeh']) {
      expect(html, slovo).toContain(slovo);
    }
  });

  it('zakázaná záložka je naozaj zakázaná a nedrží zastavovací bod', () => {
    const s = renderToStaticMarkup(
      createElement(Tabs<Zalozka>, {
        value: 'prehlad',
        onChange: () => {},
        items: [
          { value: 'prehlad' as Zalozka, label: 'Prehľad' },
          { value: 'polozky' as Zalozka, label: 'Položky', disabled: true },
        ],
        ariaLabel: 'Časti detailu',
        idBase: 'x-',
      }),
    );
    expect(s).toContain('disabled=""');
    expect(s.match(/tabindex="0"/g)).toHaveLength(1);
  });

  it('hodnota mimo zoznamu nezhodí lištu z tabulátora', () => {
    /*
     * Bez tejto poistky by pri pokazenej hodnote nemal `tabIndex` komu dať
     * nulu a k lište by sa klávesnicou vôbec nedalo dostať.
     */
    const s = renderToStaticMarkup(
      createElement(Tabs<Zalozka>, {
        value: 'neexistuje' as Zalozka,
        onChange: () => {},
        items: ITEMS,
        ariaLabel: 'Časti detailu',
        idBase: 'y-',
      }),
    );
    expect(s.match(/tabindex="0"/g)).toHaveLength(1);
    expect(s).not.toContain('aria-selected="true"');
  });
});

/* ════════════════════ 7. Vykreslený markup — Segmented ═══════════════════ */

describe('Segmented — skupina rádií, nie tablist bez panelov', () => {
  type Okno = '7' | '30' | '90';
  const html = renderToStaticMarkup(
    createElement(Segmented<Okno>, {
      value: '30',
      onChange: () => {},
      options: [
        { value: '7' as Okno, label: '7', title: '7 dní' },
        { value: '30' as Okno, label: '30', title: '30 dní' },
        { value: '90' as Okno, label: '90', title: '90 dní' },
      ],
      ariaLabel: 'Za koľko dní sa počítajú predané kusy',
      testId: 'okno-prehladu',
    }),
  );

  it('je to radiogroup s menom, a segmenty sú rádiá', () => {
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Za koľko dní sa počítajú predané kusy"');
    expect(html.match(/role="radio"/g)).toHaveLength(3);
    /* Tablist bez panelov je sľub, ktorý prepínač zobrazenia nedodrží. */
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('role="tab"');
  });

  it('zvolený segment to hlási ARIA, nie len farbou', () => {
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html.match(/aria-checked="false"/g)).toHaveLength(2);
    expect(html).not.toContain('aria-selected');
  });

  it('roving tabIndex: zastavovací bod tabulátora je JEDEN', () => {
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(2);
  });

  it('samotné číslo dostane slovné meno — „7" nepovie nič', () => {
    expect(html).toContain('aria-label="7 dní"');
    expect(html).toContain('aria-label="30 dní"');
  });

  it('bez `title` si segment meno z popisu nekradne dvakrát', () => {
    const s = renderToStaticMarkup(
      createElement(Segmented<'tabulka' | 'karty'>, {
        value: 'tabulka',
        onChange: () => {},
        options: [
          { value: 'tabulka', label: 'Tabuľka' },
          { value: 'karty', label: 'Karty' },
        ],
        ariaLabel: 'Ako zobraziť produkty',
      }),
    );
    expect(s).not.toContain('aria-label="Tabuľka"');
    expect(s).toContain('Tabuľka');
  });

  it('menší prepínač sa od bežného líši triedou, nie inou značkou', () => {
    const md = renderToStaticMarkup(
      createElement(Segmented<'a'>, {
        value: 'a',
        onChange: () => {},
        options: [{ value: 'a', label: 'A' }],
        ariaLabel: 'Meranie',
      }),
    );
    const sm = renderToStaticMarkup(
      createElement(Segmented<'a'>, {
        value: 'a',
        onChange: () => {},
        options: [{ value: 'a', label: 'A' }],
        ariaLabel: 'Meranie',
        size: 'sm',
      }),
    );
    expect(sm).not.toBe(md);
    expect(sm.match(/role="radio"/g)).toHaveLength(1);
  });

  it('zakázaný segment je zakázaný a nedrží zastavovací bod', () => {
    const s = renderToStaticMarkup(
      createElement(Segmented<'a' | 'b'>, {
        value: 'a',
        onChange: () => {},
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B', disabled: true },
        ],
        ariaLabel: 'Meranie',
      }),
    );
    expect(s).toContain('disabled=""');
    expect(s.match(/tabindex="0"/g)).toHaveLength(1);
  });
});

/* ═════════════════ 8. `frame.module.css` — hygiena a tri kanály ═══════════ */

describe('frame.module.css — farba ide výhradne z tokenov (D132, D147)', () => {
  it('meranie vôbec niečo našlo', () => {
    /* Bez tejto poistky by tvrdenia nižšie prešli aj nad prázdnym súborom. */
    expect(CSS.length).toBeGreaterThan(1000);
    expect(CSS).toContain('var(--');
  });

  it('žiadny surový hex', () => {
    expect(CSS.match(/#[0-9a-fA-F]{3,8}\b/g)).toBe(null);
  });

  it('žiadne rgba() ani rgb(… / …) — je to tá istá vec inak napísaná (D147)', () => {
    expect(CSS.match(/\brgba?\s*\(/g)).toBe(null);
    expect(CSS.match(/\bhsla?\s*\(/g)).toBe(null);
  });

  it('žiadny !important', () => {
    expect(CSS).not.toContain('!important');
  });

  it('tónuje sa color-mix, nie priehľadnosťou farby', () => {
    expect(CSS).toContain('color-mix(in srgb,');
  });
});

describe('frame.module.css — stav nie je nikdy len farba (§4 bod 3)', () => {
  /**
   * Blok pravidla podľa presného selektora. Otázka nie je „je ten reťazec
   * v súbore", ale „existuje BLOK s tým selektorom a čo v ňom je" — tá istá
   * myšlienka, akú má `test/helpers/css-stavy.ts`.
   */
  function blok(selektor: string): string | null {
    const escaped = selektor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(CSS);
    return m === null ? null : m[1]!;
  }

  it('vzhľad vybranej záložky VISÍ na aria-selected, nie na triede', () => {
    /*
     * Bod A hlavičky: keby vzhľad niesla vlastná trieda, dala by sa
     * nakresliť vybraná záložka, o ktorej čítačka nevie.
     */
    const pravidlo = blok(".tab[aria-selected='true']");
    expect(pravidlo, 'pravidlo pre vybranú záložku neexistuje').not.toBe(null);
    expect(pravidlo).toContain('color:');
    /* TVAR — podčiarknutie. Farba sama je pri deuteranopii prázdny kanál. */
    expect(pravidlo).toContain('border-bottom-color:');
  });

  it('nevybraná záložka MÁ kam podčiarknutie nakresliť', () => {
    const tab = blok('.tab');
    expect(tab).not.toBe(null);
    expect(tab).toContain('border-bottom: 2px solid transparent');
  });

  it('vzhľad zvoleného segmentu VISÍ na aria-checked, nie na triede', () => {
    const pravidlo = blok(".segment[aria-checked='true']");
    expect(pravidlo, 'pravidlo pre zvolený segment neexistuje').not.toBe(null);
    expect(pravidlo).toContain('color:');
    /* TVAR — zdvihnutá plocha s vlastným okrajom. */
    expect(pravidlo).toContain('background:');
    expect(pravidlo).toContain('border-color:');
  });

  it('vybraný stav nemá záložnú triedu, ktorou by sa dal obísť', () => {
    /*
     * Keby v module existovala trieda `.tabSelected` / `.segmentChecked`,
     * dala by sa nakresliť bez ARIA atribútu — a tri kanály by tichým
     * spôsobom prestali platiť.
     */
    expect(CSS).not.toMatch(/\.tab(Selected|Active|On)\b/);
    expect(CSS).not.toMatch(/\.segment(Selected|Checked|Active|On)\b/);
  });

  it('pohyb sa pri prefers-reduced-motion vypína', () => {
    expect(CSS).toContain('prefers-reduced-motion');
  });
});
