/**
 * Aura Zľavy — ROZVRH OBRAZOVKY ZĽAVY (UX2, 24. 8. 2026).
 *
 * Štyri chyby, ktoré snímkovač (`npm run snimky`) odmeral pri 1440 × 900 a
 * ktoré boli na oboch témach aj v zozname aj v detaile:
 *
 *   1. „15–30 %" v rebríku naráža do stavu — bunka bola o 23 px užšia než
 *      text a znak „%" dosadal na slovo „zapisuje sa".
 *   2. Meta riadok sa orezával presne na čísle: „…zapísané 948 z " (−109 px).
 *      Odpadával práve ten údaj, kvôli ktorému riadok existuje.
 *   3. Tabuľka POLOŽIEK pretekala von z karty (td.name o 112 px).
 *   4. Zoznam zliav bol z dvoch tretín prázdny, hoci appka mala načítané dáta.
 *
 * ČO SA TU DÁ A ČO NIE
 * --------------------
 * Šírku textu v pixeloch zmeria len prehliadač a robí to snímkovač. Tento
 * súbor stráži to, čo prehliadač nepotrebuje: TVAR, z ktorého tie pretečenia
 * vznikli. Preto sa všade, kde to ide, kreslí skutočný markup a hľadá sa
 * v ňom správanie — nie prítomnosť reťazca v zdroji. Nad CSS sa merajú
 * hodnoty deklarácií (nie výskyt podreťazca) a vždy proti číslu, ktoré
 * snímkovač nameral.
 *
 * Vlastník: UX2.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ItemsTable } from '@/components/campaigns/DiscountDetail';
import { discountColumns, LeadTiers, WatchSection } from '@/components/campaigns/DiscountsList';
import type { QueueSnapshotView } from '@/components/campaigns/queue-model';
import type {
  DiscountItemView,
  DiscountRow,
  TierView,
} from '@/components/campaigns/zlavy-api';

const CSS = readFileSync(
  resolve(process.cwd(), 'src/components/campaigns/zlavy.module.css'),
  'utf8',
);

/**
 * Hodnota jednej deklarácie v jednom pravidle CSS modulu.
 *
 * Zámerne NIE `toContain('116px')`: taký test prejde aj vtedy, keď je číslo
 * v komentári alebo v úplne inom pravidle, a pri mutácii ostane zelený.
 * Selektor sa hľadá ako celé pravidlo a z jeho tela sa číta konkrétna
 * vlastnosť.
 */
function deklaracia(selektor: string, vlastnost: string): string | null {
  const bezKomentarov = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const hlavicka = bezKomentarov.indexOf(selektor);
  if (hlavicka === -1) return null;
  const otvorka = bezKomentarov.indexOf('{', hlavicka);
  const zatvorka = bezKomentarov.indexOf('}', otvorka);
  if (otvorka === -1 || zatvorka === -1) return null;
  const telo = bezKomentarov.slice(otvorka + 1, zatvorka);
  const najdene = new RegExp(`(?:^|;)\\s*${vlastnost}\\s*:\\s*([^;]+)`).exec(telo);
  return najdene === null ? null : najdene[1]!.trim();
}

/* ═══════════════════════════ fixtúry ══════════════════════════════════════ */

const PASMA: readonly TierView[] = [
  { ord: 1, label: 'Ležiaky nad rok', percent: 30, itemsCount: 412 },
  { ord: 2, label: 'Pomaly sa točiace', percent: 25, itemsCount: 520 },
  { ord: 3, label: 'Zvyšok kolekcie', percent: 15, itemsCount: 248 },
];

function zlava(patch: Partial<DiscountRow> = {}): DiscountRow {
  return {
    id: 42,
    name: 'Letné dočistenie skladu — oceľ',
    status: 'queued',
    statusReason: null,
    percent: 25,
    dateFrom: '2026-08-22',
    dateTo: '2026-09-05',
    mode: 'percent',
    itemsTotal: 1180,
    itemsOk: 948,
    itemsFailed: 11,
    itemsUncertain: 3,
    itemsPending: 218,
    late: false,
    createdAt: '2026-08-20T09:00:00.000Z',
    tiers: PASMA,
    estimate: { pending: 218, perDay: 200, days: 2, date: '2026-08-26' },
    ...patch,
  };
}

function polozka(patch: Partial<DiscountItemView> = {}): DiscountItemView {
  return {
    id: 1,
    productId: 4100,
    position: 1,
    status: 'failed',
    nameAtWrite: 'Oceľový prívesok s perleťovým vzorom rozpínací, vzor kocky a čiary',
    priceAtPreview: '22.63',
    priceAtWrite: null,
    priceMismatch: false,
    hasAttributes: false,
    attemptCount: 3,
    httpStatus: 502,
    errorCode: 'shop_timeout',
    errorMessage: null,
    finishedAt: null,
    ...patch,
  };
}

function fronta(patch: Partial<QueueSnapshotView> = {}): QueueSnapshotView {
  return {
    budget: { day: '2026-08-24', budget: 200, spent: 128, remaining: 72, exhausted: false },
    queue: { pending: 518, total: 1480, done: 962, campaigns: 2 },
    items: {
      total: 1480,
      pending: 518,
      done: 962,
      ok: 948,
      failed: 11,
      uncertain: 3,
      otherResolved: 0,
      campaigns: 2,
    },
    current: null,
    estimate: { pending: 518, perDay: 200, days: 3, date: '2026-08-27' },
    limits: {
      shopPerUtcDay: 240,
      configuredPerDay: 200,
      belowShopCap: true,
      nextResetAt: '2026-08-25T00:00:00.000Z',
      secondsToReset: 28_800,
    },
    keyStatus: null,
    standing: {
      writing: true,
      reason: null,
      blockers: [],
      blocked: false,
      waitUntil: null,
      writesLocked: false,
      writesLockedReason: null,
    },
    attention: {
      uncertain: {
        items: 3,
        campaigns: [{ campaignId: 42, name: 'Letné dočistenie skladu — oceľ', items: 3 }],
        truncated: false,
        what: 'Pri troch kusoch odišiel zápis a odpoveď nedorazila.',
        nextStep: 'Otvorte zľavu a pozrite si zoznam položiek.',
      },
      failed: {
        items: 11,
        campaigns: [{ campaignId: 42, name: 'Letné dočistenie skladu — oceľ', items: 11 }],
        truncated: false,
        what: 'Jedenásť kusov eshop odmietol.',
        nextStep: 'Skúsiť znova sa dá z detailu zľavy.',
      },
    },
    heartbeat: { lastTickAt: '2026-08-24T13:46:00.000Z', stale: false },
    ...patch,
  };
}

/*
 * ZMENA 2. 9. 2026 (V6b). Riadok rebríka kreslil vlastný `PickRow`; vo V6b sa
 * z neho stali stĺpce pre primitív `Table` (`discountColumns()`). Merané fakty
 * nižšie sa NEZMENILI — „zapísané 948 z 1 180" musí zostať v jednom
 * nedeliteľnom uzle, lebo presne tento reťazec snímkovač odrezal na
 * „zapísané 948 z ".
 *
 * Vykresľujú sa BUNKY, nie celá `Table`: tvrdenia sa týkajú toho, čo vyrobia
 * stĺpce, a nie prop-plochy tabuľky. Keby test staval celú `Table`, pri každej
 * zmene jej API by padal na niečom, čo vôbec nemeria.
 */
const riadok = (row: DiscountRow) =>
  discountColumns(null)
    .map((column) =>
      renderToStaticMarkup(
        createElement('div', null, column.cell(row, 0).content as never),
      ),
    )
    .join('');

/* ═══════ 1. Percento sa nesmie dotknúť stavu (chyba 1) ════════════════════ */

/*
 * PRESMEROVANÉ 2. 9. 2026 (V6b, D139). Do prevodu na `ui/Table` merali tieto
 * tvrdenia CSS rebríka: `.rail :global(.zpick)` (šírka riadku) a `.pct`
 * (veľkosť percenta). Rebrík zmizol a s ním aj tie pravidlá — merať ich ďalej
 * by znamenalo strážiť mŕtve selektory, teda presne to, čo si tento repo raz
 * zaplatil (`mrtve-triedy.spec.ts`).
 *
 * KTO TÚ ZÁRUKU STRÁŽI TERAZ (aby nezostala nestrážená):
 *  · šírku bunky percenta → `discountColumns()` (tu, nižšie). `ui/Table` dáva
 *    ten istý `width` na `<th>` aj na `<td>` a odsadenie prilepených stĺpcov
 *    z neho počíta `stickyOffsets()` — obe kryje `tabulka-skupina.spec.ts`,
 *    takže hlavička sa od hodnoty rozísť nemá ako a nemusí to merať aj tento
 *    súbor;
 *  · 26 px rez percenta → `.rowPct b` v `zlavy.module.css` (tu, nižšie).
 */

describe('1 — bunka percenta unesie rozsah pásiem, nielen „25 %"', () => {
  it('meranie vôbec niečo našlo', () => {
    /* Bez tejto poistky by testy nižšie prešli aj nad prázdnym súborom. */
    expect(CSS.length).toBeGreaterThan(10_000);
    expect(discountColumns(null).length).toBeGreaterThan(0);
  });

  it('stĺpec percenta má aspoň 109 px, čo je nameraná šírka „15–30 %"', () => {
    /*
     * 109 px nie je odhad: pri 86 px bunke nahlásil snímkovač pretečenie
     * o 23 px (86 + 23). Keby sa stĺpec vrátil pod túto mieru, znak „%" by
     * zase dosadal na slovo „zapisuje sa" vedľa.
     */
    const stlpec = discountColumns(null).find((column) => column.key === 'percent');
    expect(stlpec, 'stĺpec percenta sa nenašiel').not.toBeUndefined();
    const px = /^(\d+(?:\.\d+)?)px$/.exec(stlpec!.width ?? '');
    expect(px, `nečakaná šírka: ${String(stlpec!.width)}`).not.toBeNull();
    expect(Number(px![1])).toBeGreaterThanOrEqual(109);
  });

  it('percento je PRVÝ stĺpec a je prilepené — identita riadku sa neodroluje', () => {
    /* Rebrík držal percento vľavo tým, že bol prvý v mriežke. V tabuľke to
       drží poradie stĺpcov a `stickyColumns` (D137). */
    expect(discountColumns(null)[0]?.key).toBe('percent');
    expect(discountColumns(null)[1]?.key).toBe('name');
  });

  it('percento sa kvôli miestu nezmenšilo — v riadku zostáva 26 px (P1)', () => {
    /* Alternatívou bolo zmenšiť rozsah. Percento je ale dominanta riadku
       (kontrakt UI, bod 21), takže miesto dostala bunka, nie naopak. */
    expect(deklaracia('.rowPct b {', 'font-size')).toBe('26px');
  });
});

/* ═══════ 2. Meta riadok sa nesmie rezať na čísle (chyba 2) ════════════════ */

describe('2 — počet zapísaných prežije, nech je riadok akokoľvek úzky', () => {
  it('okno a čísla sú dva samostatné riadky, nie jeden orezávaný', () => {
    const html = riadok(zlava());
    /* Keby sa vrátil jeden riadok s `text-overflow`, obe hodnoty by boli
       v jednom textovom uzle a tieto dva obaly by neexistovali. */
    expect(html).toContain('22. 8. 2026 – 5. 9. 2026');
    expect(html).toContain('data-testid="row-written"');
  });

  it('celé „zapísané 948 z 1 180" je v jednom nedeliteľnom uzle', () => {
    const html = riadok(zlava());
    const bunka = /data-testid="row-written"[^>]*>([^<]*)</.exec(html);
    expect(bunka, 'uzol s číslami sa nenašiel').not.toBeNull();
    /* Práve tento reťazec snímkovač odrezal na „zapísané 948 z ". */
    expect(bunka![1]).toBe('zapísané 948 z 1 180');
  });

  it('uzol s číslami sa nikdy nezmenšuje — ustupuje odhad, nie počty', () => {
    /*
     * PRESMEROVANÉ 2. 9. 2026 (V6b, D139). V rebríku sa o jedno miesto bili
     * počty a odhad, takže sa to riešilo CSS (`.pickCounts { flex: 0 0 auto }`,
     * `.pickEst { text-overflow: ellipsis }`). V tabuľke sa nebijú vôbec —
     * odhad má VLASTNÝ stĺpec „Dobehne". Záruku preto nesie rozvrh stĺpcov
     * a `.nowrap` na hodnote, nie pravidlo o ustupovaní.
     */
    const zapis = discountColumns(null).find((column) => column.key === 'written');
    const odhad = discountColumns(null).find((column) => column.key === 'estimate');
    expect(zapis, 'stĺpec zápisu sa nenašiel').not.toBeUndefined();
    expect(odhad, 'stĺpec odhadu sa nenašiel').not.toBeUndefined();
    expect(zapis!.width).not.toBeUndefined();
    expect(deklaracia('.nowrap {', 'white-space')).toBe('nowrap');
  });

  it('bez odhadu sa riadok nekreslí prázdny ani s pomlčkou navyše (P7)', () => {
    const html = riadok(zlava({ estimate: null }));
    expect(html).toContain('zapísané 948 z 1 180');
    expect(html).not.toContain('class="est"');
  });

  it('meno zľavy sa NEREŽE — nedočítané meno je horšie než dlhší riadok', () => {
    /* PRESMEROVANÉ (V6b): v rebríku to bol jeden meta riadok, ktorému sa
       muselo zakázať `nowrap`. V tabuľke je meno vlastná bunka, takže sa
       tá istá záruka píše na `.rowName` — a `text-overflow` tam nesmie byť. */
    expect(deklaracia('.rowName {', 'overflow')).toBeNull();
    expect(deklaracia('.rowName {', 'text-overflow')).toBeNull();
    expect(deklaracia('.rowName {', 'white-space')).toBeNull();
  });
});

/* ═══════ 3. Tabuľka položiek sa zmestí do karty (chyba 3) ═════════════════ */

describe('3 — tabuľka POLOŽIEK nepreteká von z karty', () => {
  const html = renderToStaticMarkup(
    createElement(ItemsTable, {
      rows: [polozka(), polozka({ id: 2, status: 'ok', priceMismatch: true })],
      fallbackPercent: 25,
    }),
  );

  it('stĺpce sú päť a šírku im dáva colgroup, nie odhad prehliadača', () => {
    /*
     * Od 1. 9. 2026 je stĺpcov päť, nie štyri: pribudla „Referencia" ako
     * samostatný PRVÝ stĺpec (D122, D124 — jednotná sada). NIE JE to návrat
     * „Poznámky", ktorá tabuľku kedysi vytlačila z karty: poznámka bola voľný
     * text naťahujúci sa podľa najdlhšej vety, referencia je kód o jednotkách
     * znakov. Že sa piaty stĺpec nesmie vrátiť ako široký text, drží test
     * o dôvode v bunke stavu nižšie.
     */
    const hlavicky = html.match(/<th\b/g) ?? [];
    expect(hlavicky).toHaveLength(5);
    const stlpce = html.match(/<col\b/g) ?? [];
    expect(stlpce).toHaveLength(5);
    expect(html).toContain('data-col="reference"');
  });

  it('šírky stĺpcov dávajú presne 100 % — inak sa pevný rozvrh nezmestí', () => {
    const sirky = ['.colRef {', '.colName {', '.colPrice {', '.colPct {', '.colState {'].map(
      (selektor) => {
        const hodnota = deklaracia(selektor, 'width');
        expect(hodnota, `${selektor} nemá width`).not.toBeNull();
        return Number(hodnota!.replace('%', ''));
      },
    );
    expect(sirky.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('miesto na referenciu dal VÝHRADNE názov — merané stĺpce sa nezúžili', () => {
    /*
     * Toto je tá poistka, ktorá drží nález UX2 zavretý. Pretiekol vtedy stĺpec
     * názvu (td.name o 112 px) a odmerané minimá „Cena pri príprave", „Zľava"
     * a „Zapísané" boli presne to, čo tie nadpisy potrebujú. Keby si niekto na
     * ďalší stĺpec vzal percento z nich, pretečenie sa vráti — kým názov sa
     * v tejto tabuľke smie lámať (`white-space: normal` nižšie).
     */
    expect(deklaracia('.colPrice {', 'width')).toBe('16%');
    expect(deklaracia('.colPct {', 'width')).toBe('10%');
    expect(deklaracia('.colState {', 'width')).toBe('28%');
    // 46 % − 14 % pre referenciu.
    expect(deklaracia('.colName {', 'width')).toBe('32%');
    expect(deklaracia('.colRef {', 'width')).toBe('14%');
  });

  it('rozvrh je pevný a bunky sa smú lámať', () => {
    expect(deklaracia('.itemsScroll table {', 'table-layout')).toBe('fixed');
    expect(deklaracia('.itemsScroll :global(table.tbl th),', 'white-space')).toBe('normal');
  });

  it('prepis nowrap ide cez `table.tbl`, inak ho prebije globals.css', () => {
    /*
     * Naozajstná chyba z tohto priechodu: `.itemsScroll td` (0,1,1) prehralo
     * s `table.tbl td` (0,1,2) z `globals.css`, bunky ostali nowrap a tabuľka
     * pretiekla o 262 px. Selektor preto MUSÍ ísť cez tú istú tabuľku.
     */
    expect(CSS).toContain('.itemsScroll :global(table.tbl th),\n.itemsScroll :global(table.tbl td) {');
  });

  it('dôvod stojí v tej istej bunke ako stav, nie vo vlastnom stĺpci', () => {
    /* Piaty stĺpec „Poznámka" bol to, čo z karty vytŕčalo. */
    expect(html).not.toContain('Poznámka');
    const bunka = /<td data-l="Zapísané">([\s\S]*?)<\/td>/.exec(html);
    expect(bunka, 'bunka stavu sa nenašla').not.toBeNull();
    expect(bunka![1]).toContain('Shop neodpovedal');
  });

  it('stav nesie značku aj slovo, nielen farbu (§3.2)', () => {
    expect(html).toContain('class="sig warn"');
    expect(html).toContain('nepodarilo sa');
    /* `SigMark` kreslí `<svg>`; farba je až tretí kanál. */
    expect(html).toContain('<svg');
  });

  it('prázdna tabuľka kreslí pomlčky, nie nuly (P7)', () => {
    const prazdna = renderToStaticMarkup(
      createElement(ItemsTable, { rows: [], fallbackPercent: 25 }),
    );
    expect(prazdna).toContain('Zatiaľ sa nič nepokazilo.');
    expect(prazdna).toContain('—');
    expect(prazdna).not.toContain('>0<');
  });
});

/* ═══════ 4. Prázdna polovica zoznamu nesie údaje (chyba 4) ════════════════ */

describe('4 — čím je vyplnená pravá polovica zoznamu', () => {
  it('pásma zľavy na čele sa vypíšu tak, ako prišli — nič sa nedopočítava', () => {
    const html = renderToStaticMarkup(createElement(LeadTiers, { tiers: PASMA }));
    for (const pasmo of PASMA) {
      expect(html).toContain(pasmo.label);
      expect(html).toContain(`${pasmo.percent} %`);
    }
    /* Počty produktov sú zo servera, nie zo súčtu riadkov. */
    expect(html).toContain('412');
    expect(html).toContain('520');
    expect(html).toContain('248');
  });

  it('zľava s jedným percentom pásma nekreslí — nebola by to tabuľka, ale prázdny rám', () => {
    expect(
      renderToStaticMarkup(
        createElement(LeadTiers, { tiers: [{ ord: 1, label: 'Celý výber', percent: 20, itemsCount: 9 }] }),
      ),
    ).toBe('');
    expect(renderToStaticMarkup(createElement(LeadTiers, { tiers: [] }))).toBe('');
  });

  it('„Čo čaká na pozretie" nesie počty, mená zliav aj ďalší krok', () => {
    const html = renderToStaticMarkup(createElement(WatchSection, { queue: fronta() }));
    expect(html).toContain('Čo čaká na pozretie');
    expect(html).toContain('Jedenásť kusov eshop odmietol.');
    expect(html).toContain('Skúsiť znova sa dá z detailu zľavy.');
    /* Meno zľavy je odkaz na jej detail — inak by sa nedalo nič urobiť. */
    expect(html).toContain('href="/zlavy/42"');
  });

  it('neisté a zlyhané sú dve skupiny, nikdy jedno číslo (D45)', () => {
    const html = renderToStaticMarkup(createElement(WatchSection, { queue: fronta() }));
    expect(html).toContain('data-testid="watch-failed"');
    expect(html).toContain('data-testid="watch-uncertain"');
    /* 11 + 3 = 14 by bolo zliatie dvoch rôznych stavov. */
    expect(html).not.toContain('>14<');
  });

  it('každá skupina má značku aj slovo, nielen farbu (§3.2)', () => {
    const html = renderToStaticMarkup(createElement(WatchSection, { queue: fronta() }));
    expect(html).toContain('class="sig bad"');
    expect(html).toContain('nepodarilo sa');
    expect(html).toContain('class="sig warn"');
    expect(html).toContain('nevieme, či sa zapísalo');
  });

  it('keď niet čo pozrieť, sekcia sa nekreslí — prázdny rám s nulami by klamal', () => {
    const ticho = fronta({ attention: { uncertain: null, failed: null } });
    expect(renderToStaticMarkup(createElement(WatchSection, { queue: ticho }))).toBe('');

    const nuly = fronta({
      attention: {
        uncertain: { items: 0, campaigns: [], truncated: false, what: '', nextStep: '' },
        failed: { items: 0, campaigns: [], truncated: false, what: '', nextStep: '' },
      },
    });
    expect(renderToStaticMarkup(createElement(WatchSection, { queue: nuly }))).toBe('');
  });

  it('odhad celej fronty je označený ako odhad a pri neznalosti sa nehádže nula (P7)', () => {
    const html = renderToStaticMarkup(createElement(WatchSection, { queue: fronta() }));
    expect(html).toContain('celá fronta hotová');
    expect(html).toContain('class="est"');

    const bezOdhadu = renderToStaticMarkup(
      createElement(WatchSection, { queue: fronta({ estimate: null }) }),
    );
    expect(bezOdhadu).toContain('odhad dobehnutia zatiaľ nevieme');
  });
});
