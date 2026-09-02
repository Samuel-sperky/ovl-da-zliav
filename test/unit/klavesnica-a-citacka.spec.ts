/**
 * Aura Zľavy — KLÁVESNICA, FOKUS A ČÍTAČKA (nález P5, 26. 8. 2026).
 *
 * PREČO TENTO SÚBOR VZNIKOL
 * ─────────────────────────
 * Do 26. 8. 2026 nemal projekt o prístupnosti ani vetu: `accessibility`, `WCAG`,
 * `klávesnic` a `čítačk` dávali dohromady dva zásahy v 155 kB auditov a
 * architektúry. Appka sa na tomto počítači nedá spustiť (`argon2` blokuje
 * Windows Application Control), takže „preklik v prehliadači" nebol splnený ani
 * raz a nikto nikdy nesledoval, čo z obrazoviek prečíta čítačka.
 *
 * Merajú sa tri veci, každá presne tam, kde sa dá ticho pokaziť späť:
 *
 *  A. **`aria-label` na prvku bez roly je zahodený.** Prepínače obdobia
 *     (`.seg`) a pätka tabuľky mali meno na `<div>`/`<span>`. Podľa ARIA nesmie
 *     mať prvok s rolou `generic` prístupné meno — čítačka ho zahodí a
 *     z prepínača zostane „30, 60, 90, 180, 360" bez toho, čo tie čísla sú.
 *     Nie je to teda oprava textu, ale oprava toho, či ten text vôbec existuje.
 *
 *  B. **`.on` je VÝHRADNE farba.** `.seg button.on` sa v `globals.css` líši od
 *     nevybraného len `background` a `color`; `.chip.on` navyše obrysom. Pravidlo
 *     appky P3 znie „farba + značka + slovo" a pre prepínač je jeho podobou
 *     `aria-pressed`: bez neho je zvolené obdobie stav oznámený len farbou.
 *     Test preto číta CSS AJ markup — keby pribudol tretí kanál (napr. slovo
 *     v `.on`), tvrdenie o CSS padne a niekto sa nad tým zastaví.
 *
 *  C. **Rozklik musí povedať, že je rozklik.** Tlačidlo názvu v tabuľke otvára
 *     panel vedľa nej; tlačidlo „Vložiť" v Kľúčoch otvára formulár až pod
 *     tabuľkou za dvoma odsekmi; „Kľúč unikol" otvára červenú zónu. Vo všetkých
 *     troch prípadoch bolo stlačenie pre čítačku ticho. `aria-expanded` hovorí
 *     stav, `aria-controls` hovorí kam.
 *
 *  D. **`role="dialog"` bez mena je „dialóg" a nič viac.** Šuplík detailu
 *     auditu mal nadpis vidieť, ale čítačke pri vstupe nepovedal, do čoho
 *     človek vstúpil. Meno sa berie z toho ISTÉHO nadpisu, ktorý je na
 *     obrazovke — nie z odpísaného `aria-label`, ktorý sa s ním po prvej
 *     úprave textu rozíde.
 *
 * ČO TENTO SÚBOR NEMERÁ (a nemôže)
 * ────────────────────────────────
 * Statický render nevie zmerať poradie tabulátora, viditeľnosť fokusového
 * prstenca ani to, čo čítačka naozaj vysloví. Vie zmerať len to, či sú
 * v markupe tie atribúty, z ktorých čítačka poradie a stav odvodzuje. Chovanie
 * klávesy a fokusu v paneli detailu meria `detail-panel-fokus.spec.ts` nad
 * skutočným DOM-om.
 *
 * Vlastník: P5.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import NewDiscount, { type NewDiscountInitial } from '@/components/campaigns/NewDiscount';
import CatalogFilters from '@/components/products/CatalogFilters';
import CatalogTable from '@/components/products/CatalogTable';
import ProductDetailPanel, {
  PRODUCT_DETAIL_ID,
} from '@/components/products/ProductDetailPanel';
import { DEFAULT_CATALOG_FILTER } from '@/components/products/catalog-filter';
import KeysSection from '@/components/settings/KeysSection';
import Drawer from '@/components/ui/Drawer';
import PanicButton from '@/components/settings/PanicButton';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const CSS = read('../../src/app/globals.css');

/* ═══════════════════════════ vzorka ═══════════════════════════════════════ */

const ROW = {
  productId: 18342,
  name: 'Strieborné náušnice Lumen, kubický zirkón',
  price: '34.90',
  hasAttributes: false,
  shopStatus: 'ok' as const,
  unitsSold: 4,
  everDiscounted: false,
  discountedNow: false,
  fetchedAt: '2026-08-10T01:00:00.000Z',
  origin: 'mirror' as const,
};

const INY_ROW = { ...ROW, productId: 19001, name: 'Oceľový prívesok s perleťovým vzorom' };

const TABLE = {
  rows: [ROW, INY_ROW],
  soldWindowDays: 30,
  total: 2,
  page: 1,
  perPage: 50 as const,
  loading: false,
  selected: new Set<number>(),
  allMatchingSelected: false,
  onToggleRow: () => {},
  onTogglePage: () => {},
  onOpenDetail: () => {},
  onPage: () => {},
  onPerPage: () => {},
};

const FILTERS = {
  filter: DEFAULT_CATALOG_FILTER,
  counts: null,
  lockedFilters: {},
  saved: [] as const,
  activeSaved: null,
  open: true,
  onChange: () => {},
  onApplySaved: () => {},
  onRemoveSaved: () => {},
};

const NEW_DISCOUNT: NewDiscountInitial = {
  productIds: null,
  filter: DEFAULT_CATALOG_FILTER,
  expectedTotal: null,
  window: null,
};

const table = (extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(CatalogTable, { ...TABLE, ...extra }));

const filters = (extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(CatalogFilters, { ...FILTERS, ...extra }));

const detail = () =>
  renderToStaticMarkup(
    createElement(ProductDetailPanel, { row: ROW, soldWindowDays: 30, onClose: () => {} }),
  );

const newDiscount = () =>
  renderToStaticMarkup(createElement(NewDiscount, { initial: NEW_DISCOUNT }));

/** Otváracia značka prvku, ktorý nesie dané `data-testid`. */
function openingTagOf(html: string, testId: string): string {
  const at = html.indexOf(`data-testid="${testId}"`);
  expect(at, `uzol s data-testid="${testId}" v markupe nie je`).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
}

/**
 * Otváracia značka prvku, ktorý nesie dané `aria-label`. Prepínače `.seg`
 * `data-testid` nemajú — meno JE ich identita, a práve o to tu ide.
 */
function tagWithLabel(html: string, label: string): string {
  const at = html.indexOf(`aria-label="${label}"`);
  expect(at, `uzol s aria-label="${label}" v markupe nie je`).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
}

/** Blok pravidiel jedného selektora z `globals.css`. */
function block(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, `selektor ${selector} v globals.css chýba`).toBeGreaterThan(-1);
  return CSS.slice(start, CSS.indexOf('}', start));
}

const OBDOBIE = 'Za koľko dní sa počítajú predané kusy';

/* ═══════ A. Meno prepínača existuje len s rolou ═══════════════════════════ */

describe('A — prepínač bez roly nemá čítačke ako povedať, čo prepína', () => {
  it('prepínač obdobia vo filtroch je pomenovaná skupina', () => {
    const tag = tagWithLabel(filters(), OBDOBIE);
    expect(tag).toContain('role="group"');
  });

  it('prepínač obdobia v paneli detailu je pomenovaná skupina', () => {
    const tag = tagWithLabel(detail(), OBDOBIE);
    expect(tag).toContain('role="group"');
  });

  it('prepínač obdobia v sprievodcovi novou zľavou je pomenovaná skupina', () => {
    // Tento jediný prepínač nemal do 26. 8. 2026 ANI meno — susedné slovo
    // „Obdobie" bolo len text vedľa, teda kanál výhradne pre oko.
    const tag = tagWithLabel(newDiscount(), OBDOBIE);
    expect(tag).toContain('role="group"');
  });

  it('voľba riadkov na stránku v pätke tabuľky má meno na prvku s rolou', () => {
    /* PRESMEROVANÉ 2. 9. 2026 (V6b, D137): pätku kreslí `ui/Pagination`.
       Voľba počtu riadkov už NIE JE `.seg` skupina tlačidiel s
       `aria-label="Riadkov na stránku"` na `<span>`, ale `<select>`
       s VIDITEĽNÝM popiskom „Na stránku". Pravidlo je to isté a splnené
       inak — a lepšie: meno nesie prvok, ktorý rolu má sám (`combobox`),
       takže sa nemá ako zahodiť. `aria-label` by tu bol krok späť — prepísal
       by viditeľné slovo, ktoré hlasové ovládanie hľadá (to isté pravidlo si
       `Pagination` píše pri poli skoku na stranu).

       Meria sa teda VÄZBA, nie prítomnosť atribútu: popisok musí ukazovať na
       `id` toho ovládača. `<label for>` bez partnera je meno, ktoré čítačka
       neprečíta, a to je presne tá trieda chyby, pre ktorú tento súbor je. */
    const html = table();
    const tag = openingTagOf(html, 'pagination-page-size');
    expect(tag.slice(0, 8)).toBe('<select ');
    const id = /id="([^"]+)"/.exec(tag)?.[1];
    expect(id, `ovládač bez \`id\`: ${tag}`).toBeTruthy();
    expect(html).toContain(`<label for="${id}">Na stránku</label>`);
  });

  it('žiadny `.seg` v týchto štyroch obrazovkách nezostal bez roly', () => {
    for (const html of [filters(), detail(), newDiscount(), table()]) {
      // `.seg` sa kreslí ako `<div class="seg">` alebo `<span class="seg">`;
      // v oboch prípadoch je bez roly meno zahodené.
      const bezRoly = /<(?:div|span) class="seg"(?![^>]*role=)/.exec(html);
      expect(bezRoly, `bez roly: ${bezRoly?.[0] ?? ''}`).toBeNull();
    }
  });
});

/* ═══════ B. Zvolená možnosť nie je len farba (P3) ═════════════════════════ */

describe('B — `.on` je farba, takže stav musí niesť `aria-pressed`', () => {
  it('`.seg button.on` sa v CSS naozaj líši VÝHRADNE farbou', () => {
    // Keby tu pribudol tretí kanál (obrys, značka, slovo), toto padne — a to
    // je zámer: tvrdenie nižšie by potom stálo na inom dôvode.
    const rules = block('.seg button.on');
    const vlastnosti = [...rules.matchAll(/\n\s*([a-z-]+):/g)].map((m) => m[1]).sort();
    expect(vlastnosti).toEqual(['background', 'color']);
  });

  it('`.chip.on` sa líši len pozadím, obrysom a farbou textu', () => {
    const vlastnosti = [...block('.chip.on').matchAll(/\n\s*([a-z-]+):/g)]
      .map((m) => m[1])
      .sort();
    expect(vlastnosti).toEqual(['background', 'border-color', 'color']);
  });

  it('zvolené obdobie v sprievodcovi je stlačené, ostatné nie', () => {
    const html = newDiscount();
    // Predvolené okno je 30 dní (`DEFAULT_CATALOG_FILTER`).
    expect(openingTagOf(html, 'window-30')).toContain('aria-pressed="true"');
    for (const days of [60, 90, 180, 360]) {
      expect(openingTagOf(html, `window-${days}`)).toContain('aria-pressed="false"');
    }
  });

  it('zvolený zdroj výberu je stlačený — „z filtra" verzus „z označených"', () => {
    const html = newDiscount();
    expect(openingTagOf(html, 'source-filter')).toContain('aria-pressed="true"');
  });

  it('pri výbere z označených je stlačený ten druhý, nie prvý', () => {
    const html = renderToStaticMarkup(
      createElement(NewDiscount, {
        initial: { ...NEW_DISCOUNT, productIds: [18342, 19001] },
      }),
    );
    expect(openingTagOf(html, 'source-products')).toContain('aria-pressed="true"');
    expect(openingTagOf(html, 'source-filter')).toContain('aria-pressed="false"');
  });

  /* KOTVA PRESMEROVANÁ 2. 9. 2026 (V6b): značku uloženého filtra kreslí
     `ui/Chip` → `FilterChip`, ktorý má DVA ovládače (použiť a zabudnúť), takže
     `data-testid` obalu dostane prípony `-apply` a `-remove`. `aria-pressed`
     patrí tomu, ktorý filter použije. Že stav nesie aj oko (značka vedľa
     slova, nie iba farba), stráži `test/unit/signaly-tri-kanaly.spec.ts`. */
  it('uložený filter, ktorý práve platí, je stlačený', () => {
    const saved = [{ name: 'Ležiaky', query: 'soldBuckets=none' }];
    const html = filters({ saved, activeSaved: 'Ležiaky' });
    expect(openingTagOf(html, 'saved-filter-Ležiaky-apply')).toContain('aria-pressed="true"');
  });

  it('uložený filter, ktorý neplatí, stlačený nie je', () => {
    const saved = [{ name: 'Ležiaky', query: 'soldBuckets=none' }];
    const html = filters({ saved, activeSaved: null });
    expect(openingTagOf(html, 'saved-filter-Ležiaky-apply')).toContain('aria-pressed="false"');
  });
});

/* ═══════ C. Rozklik hovorí stav aj cieľ ══════════════════════════════════ */

describe('C — rozklik povie, či je otvorený a čo otvára', () => {
  it('tlačidlo názvu je zatvorený rozklik a ukazuje na panel detailu', () => {
    const tag = openingTagOf(table(), 'open-detail-18342');
    expect(tag).toContain('aria-expanded="false"');
    expect(tag).toContain(`aria-controls="${PRODUCT_DETAIL_ID}"`);
  });

  it('otvorený riadok má rozklik otvorený — a len ten jeden', () => {
    const html = table({ openId: 18342 });
    expect(openingTagOf(html, 'open-detail-18342')).toContain('aria-expanded="true"');
    expect(openingTagOf(html, 'open-detail-19001')).toContain('aria-expanded="false"');
  });

  it('`aria-controls` naozaj trafí `id` panela, nie podobný reťazec', () => {
    // Dva zhodné literály v dvoch súboroch sa rozídu pri prvom premenovaní;
    // preto je to jedna konštanta a preto sa tu meria oboje naraz.
    expect(table({ openId: 18342 })).toContain(`aria-controls="${PRODUCT_DETAIL_ID}"`);
    // `id=` sa hľadá S hranicou slova: `data-testid="product-detail"` má
    // `id="product-detail"` v sebe ako podreťazec, takže obyčajné `toContain`
    // by prešlo aj panelu, ktorý `id` vôbec nemá.
    const aside = openingTagOf(detail(), 'product-detail');
    expect(aside).toContain(` id="${PRODUCT_DETAIL_ID}"`);
  });

  it('tlačidlo kľúča je rozklik a ukazuje na formulár, ktorý otvára', () => {
    const html = renderToStaticMarkup(
      createElement(KeysSection, { writeKey: null, ordersKey: null, onStored: () => {} }),
    );
    // Chýbajúci kľúč na zápis otvára formulár hneď (rozhodnutie sekcie).
    const write = openingTagOf(html, 'key-row-write-toggle');
    expect(write).toContain('aria-expanded="true"');
    expect(write).toContain('aria-controls="key-row-write-form"');
    expect(html).toContain('id="key-row-write-form"');

    const orders = openingTagOf(html, 'key-row-orders-toggle');
    expect(orders).toContain('aria-expanded="false"');
    expect(orders).toContain('aria-controls="key-row-orders-form"');
  });

  it('„Kľúč unikol" je rozklik nad červenou zónou', () => {
    const html = renderToStaticMarkup(
      createElement(PanicButton, { keyPresent: true, onWiped: () => {} }),
    );
    const tag = openingTagOf(html, 'panic-open');
    expect(tag).toContain('aria-expanded="false"');
    expect(tag).toContain('aria-controls="panic-editor"');
  });
});

/* ═══════ D. Dialóg má meno, a to z viditeľného nadpisu ═══════════════════ */

describe('D — šuplík povie, do čoho človek vstúpil', () => {
  const drawer = () =>
    renderToStaticMarkup(
      createElement(Drawer, {
        open: true,
        onClose: () => {},
        title: 'Zápis do eshopu · 12. 08. 2026 09:14',
        children: 'obsah',
        testId: 'audit-drawer',
      }),
    );

  it('dialóg je pomenovaný — a meno ukazuje na nadpis, ktorý je vidieť', () => {
    const html = drawer();
    const tag = openingTagOf(html, 'audit-drawer');
    expect(tag).toContain('role="dialog"');

    const odkaz = /aria-labelledby="([^"]+)"/.exec(tag);
    expect(odkaz, 'dialóg bez `aria-labelledby`').not.toBeNull();

    // Cieľ musí naozaj existovať a musí to byť nadpis so viditeľným textom.
    const nadpis = new RegExp(`<h2 id="${odkaz![1]}"[^>]*>([^<]+)</h2>`).exec(html);
    expect(nadpis, `uzol s id="${odkaz![1]}" v šuplíku nie je`).not.toBeNull();
    expect(nadpis![1]).toContain('Zápis do eshopu');
  });

  it('tlačidlo zavretia má meno, aj keď v ňom nie je ani jedno slovo', () => {
    // Obsahom je ikona; meno preto nesie tlačidlo a ikona zostáva `aria-hidden`,
    // inak by čítačka prečítala „zavrieť" dvakrát.
    const html = drawer();
    expect(html).toContain('aria-label="Zavrieť"');
  });
});
