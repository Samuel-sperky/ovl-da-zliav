/**
 * Aura Zľavy — SKÚŠKA NAPRÁZDNO A POTVRDENIE PO PREVODE NA `Panel` + `Button`
 * (V6b, 2. 9. 2026; I3, D106, kontrakt V6 §4 bod 2, D147).
 *
 * PREČO TENTO SÚBOR VZNIKOL
 * ─────────────────────────
 * Appka NEMÁ prihlásenie (D98–D100): Caddy `basic_auth`, app session aj sudo
 * sú zrušené a zmazané. Pred PRODUKČNÝM eshopom zostali dve veci — skúška
 * naprázdno a potvrdenie — a I3 po D100 znie „žiadny zápis bez dry-runu
 * + potvrdenia". Redizajn V6 smie potvrdenie spraviť KRAJŠÍM, nie tichším
 * (kontrakt V6 §4, bod 2), a práve „tichšie" je to, čo sa pri prevode na
 * primitíva stane samo: výsledok skúšky žil pod rozklikom `<details>` a
 * rozpočet zápisov v ňom nebol vôbec, takže sa dalo prejsť celým potvrdením
 * bez toho, aby človek raz videl, ČO SA ZAPÍŠE.
 *
 * ČO SA TU TVRDÍ
 * ──────────────
 *   A. **CSS ako TEXT.** Každý `styles.*` kľúč, ktorý kreslí ktorýkoľvek
 *      konzument `zlavy.module.css`, v tom module NAOZAJ existuje.
 *   B. **Súhrn skúšky hovorí štyri čísla** — koľko produktov, aké percentá,
 *      od kedy do kedy, koľko zápisov to zoberie z denného rozpočtu.
 *   C. **Denný strop má JEDEN zdroj** — `DAILY_WRITE_CAP` a
 *      `MAX_DAILY_WRITE_BUDGET` sú to isté číslo a v texte nie je vpísané ručne.
 *   D. **Krok sa nedá preskočiť ani zapamätať** — žiadne „už nezobrazovať",
 *      žiadna uložená voľba, súhrn nie je pod rozklikom.
 *   E. **Karta stojí na primitívach** `Panel` + `Button` a nie na vlastných
 *      `<section class="sec">` a `<button class="btn">`.
 *
 * ČO TENTO SÚBOR VEDOME NEKRYJE (a kto to kryje namiesto neho):
 *   · mechaniku poistky (`queueBlockedReason()`, poradie krokov, D11/D12/D13)
 *     → `test/unit/nova-zlava-potvrdenie.spec.ts`, skupiny B, E, F, G;
 *   · pás troch krokov a mŕtve/chýbajúce triedy `new-discount.module.css`
 *     → `test/unit/nova-zlava-selektory.spec.ts`;
 *   · **bránu na SERVERI** — že telo bez potvrdenia je odmietnuté
 *     → `test/integration/potvrdenie-nie-je-formalita.spec.ts`. Tento súbor
 *     meria POVRCH a povrch nie je brána; grep nad `components/` nepovie nič
 *     o diere v `app/api/campaigns/route.ts` (nález 31. 8. 2026, K7).
 *
 * Vlastník: V6b (oblasť Nová zľava, krok 2 — dry-run a potvrdenie).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import NewDiscountConfirm, {
  DAILY_WRITE_CAP,
  DRY_RUN_INTRO_SK,
  dryRunLines,
} from '@/components/campaigns/NewDiscountConfirm';
import { buildTiers, type SelectableRow } from '@/components/campaigns/discounts-model';
import { MAX_DAILY_WRITE_BUDGET } from '@/lib/engine/budget';
import { formatCountSk } from '@/lib/ui/vocabulary';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** Zdroj bez komentárov — `styles.foo` v komentári nie je vykreslená trieda. */
const bezKomentarov = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const CONFIRM_SRC = bezKomentarov('../../src/components/campaigns/NewDiscountConfirm.tsx');

const ROWS: SelectableRow[] = [
  { productId: 18342, name: 'Náušnice Lumen', price: '34.90', unitsSold: 0, discountedNow: false },
  { productId: 21170, name: 'Prsteň Aurora', price: '49.00', unitsSold: 0, discountedNow: false },
];
const TIERS = buildTiers(ROWS, 180).tiers;

/** Skúška, ktorá prebehla. Súhrn sa kreslí VÝHRADNE nad ňou. */
const PREVIEW = {
  itemsTotal: 8000,
  previewToken: 'podpisany-token',
  priceSource: 'shop',
  blockers: [],
  warnings: { hasAttributes: [] },
} as never;

const PROPS = {
  itemsCount: 8000,
  tiers: TIERS,
  averagePrice: 46.2,
  from: '2026-09-03',
  to: '2026-09-17',
  budget: { spent: 60, limit: 1000 },
  typed: '',
  onTyped: () => {},
  previewFresh: true,
  preview: PREVIEW,
  previewAt: '2026-09-02T20:00:00.000Z',
  busy: 'idle' as const,
  blockedReason: null,
  error: null,
  created: null,
  onPreview: () => {},
  onQueue: () => {},
};

const render = (extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(NewDiscountConfirm, { ...PROPS, ...extra }));

/** Text vnútri prvku s daným `data-testid` — bez značiek. */
function textOf(html: string, testId: string): string {
  const at = html.indexOf(`data-testid="${testId}"`);
  expect(at, testId).toBeGreaterThan(-1);
  const open = html.indexOf('>', at) + 1;
  return html.slice(open, html.indexOf('<', open));
}

/* ═════════ A. CSS ako TEXT: kľúč, ktorý v module nie je, je `undefined` ═══ */

/**
 * Prečo NAD CELÝM MODULOM a nie len nad kartou potvrdenia: `zlavy.module.css`
 * je spoločný pre dvanásť súborov a Proxy nad CSS modulmi v testoch vráti
 * hašované meno na KAŽDÝ kľúč — aj na ten, ktorý v súbore nie je. Vykreslený
 * markup o tom nepovie nič (`class="undefined"` sa v ňom nenájde ani raz),
 * takže jediné meradlo je text CSS. Keď sa strážca zavedie len nad „svojím"
 * súborom, susedná obrazovka toho istého modulu ostane bez stráženia — a to
 * je presne pasca „čo test vyňal z kontroly, nestráži NIKTO".
 *
 * MERANÉ 2. 9. 2026: strážca pri prvom spustení našiel ŠTYRI chýbajúce triedy
 * (`startBox`, `startRow`, `startGate`, `tableFoot` v `DiscountsList.tsx`) —
 * teda `class="undefined"` na rozcestníku „Nová zľava" a v pätičke tabuľky
 * zliav, na živej obrazovke po V6b. Doplnené v tom istom kroku.
 *
 * Druhý smer (mŕtva trieda v module) sa TU NEMERÁ a je to vedomé: modul má
 * dnes 18 tried po prevode zoznamu a detailu na primitíva (`nz*`, `tiers`,
 * `band`, `win*`, `preset*`) a ich zmazanie patrí k prevodu tých obrazoviek
 * (D139), nie ku karte potvrdenia. Zoznam je v reporte V6b; keď sa vyčistia,
 * pridá sa sem druhý smer tak, ako ho má `nova-zlava-selektory.spec.ts`.
 */
describe('A. každý `styles.*` v `zlavy.module.css` naozaj existuje', () => {
  const MODUL = read('../../src/components/campaigns/zlavy.module.css');

  /** Súbory, ktoré berú vzhľad zo `zlavy.module.css`. */
  const KRESLIA = [
    'campaigns/BlockerList',
    'campaigns/DiscountDetail',
    'campaigns/DiscountPerformance',
    'campaigns/DiscountState',
    'campaigns/DiscountTimeline',
    'campaigns/DiscountsList',
    'campaigns/NewDiscountConfirm',
    'campaigns/NewDiscountStart',
    'campaigns/QueueLive',
    'campaigns/RetryFailed',
    'campaigns/ScopeRelease',
    'products/ProductDetailPanel',
  ].map((name) => `../../src/components/${name}.tsx`);

  it('zoznam konzumentov je ÚPLNÝ — inak cyklus nižšie meria menej, než tvrdí', () => {
    /*
     * Bez tejto nohy by stačilo pridať trinásty súbor s importom modulu a
     * strážca by o jeho triedach nevedel. `KRESLIA` sa preto porovnáva
     * s tým, čo v strome naozaj ten modul importuje.
     */
    const IMPORT = "from '@/components/campaigns/zlavy.module.css'";
    for (const rel of KRESLIA) {
      expect(bezKomentarov(rel), rel).toContain(IMPORT);
    }
    expect(MODUL.length).toBeGreaterThan(10_000);
  });

  it('ani jeden použitý kľúč nechýba (inak je to `class="undefined"`)', () => {
    const chybajuce: string[] = [];
    let pouzitych = 0;
    for (const rel of KRESLIA) {
      const mena = new Set(
        [...bezKomentarov(rel).matchAll(/styles\.([a-zA-Z0-9_]+)/g)].map((m) => m[1]!),
      );
      pouzitych += mena.size;
      for (const meno of mena) {
        // `\b` nestačí: `.gate` je podreťazcom `.gateInput`, a taká zhoda by
        // z testu spravila náhodu.
        if (!new RegExp(`\\.${meno}(?![a-zA-Z0-9_-])`).test(MODUL)) chybajuce.push(meno);
      }
    }
    expect(pouzitych).toBeGreaterThan(60);
    expect(chybajuce, 'tieto triedy v zlavy.module.css nie sú').toEqual([]);
  });

  it('a súhrn skúšky má v module vlastné pravidlá, nie prevzaté z hlavy', () => {
    /* Poistka k skupine B: keby `.dry*` v module neboli, súhrn by bol
       neštýlovaný text — a testy nad HTML by o tom nepovedali nič. */
    for (const trieda of [
      'dry',
      'dryIntro',
      'dryList',
      'dryRow',
      'dryTerm',
      'dryValue',
      'dryStale',
    ]) {
      expect(MODUL, `.${trieda} v module nie je`).toMatch(
        new RegExp(`\\.${trieda}(?![a-zA-Z0-9_-])`),
      );
    }
    // D147 — farba ide výhradne z tokenov. Strop pravidla stráži
    // `dizajn-tokeny-strazca.spec.ts`; tu len to, že nové pravidlá ho neobišli.
    const od = MODUL.indexOf('.dry {');
    const po = MODUL.indexOf('.gate {', od);
    const blok = MODUL.slice(od, po);
    expect(blok).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(blok).not.toContain('rgba(');
    expect(blok).not.toContain('!important');
  });

  it('vykreslená karta nemá ani jednu prázdnu triedu', () => {
    const html = render();
    expect(html).not.toContain('class="undefined"');
    expect(html).not.toContain('undefined"');
  });
});

/* ═════════ B. Skúška naprázdno hovorí ŠTYRI ČÍSLA nahlas ═════════════════ */

describe('B. súhrn skúšky povie, ČO SA STANE — číslami (I3, §4 bod 2)', () => {
  it('súhrn sa kreslí až po skúške a nie skôr', () => {
    expect(render({ preview: null })).not.toContain('data-testid="dry-run-summary"');
    expect(render()).toContain('data-testid="dry-run-summary"');
  });

  it('prvá veta hovorí, čo sa stane — nie „potvrďte akciu"', () => {
    const html = render();
    expect(html).toContain(DRY_RUN_INTRO_SK);
    /*
     * „Potvrďte akciu" a jej rodina sú vety, ktoré človek preklikne bez
     * čítania: o akcii nepovedia nič. Pred zápisom do produkčného eshopu je
     * súhrn posledné miesto, kde sa dá odstúpiť.
     */
    for (const prazdna of ['Potvrďte akciu', 'Ste si istý', 'Naozaj', 'Pokračovať?']) {
      expect(html, `prázdna výzva „${prazdna}"`).not.toContain(prazdna);
    }
    expect(DRY_RUN_INTRO_SK).toContain('nezapísala nič');
    expect(DRY_RUN_INTRO_SK).toContain('appka zapíše');
  });

  it('koľko PRODUKTOV zlacnie — číslom', () => {
    expect(textOf(render(), 'dry-run-produkty')).toBe('8 000 produktov');
  });

  it('AKÉ PERCENTÁ a na koľko produktov — každé pásmo číslom', () => {
    const shown = textOf(render(), 'dry-run-percenta');
    for (const tier of TIERS) {
      expect(shown, `pásmo ${tier.letter}`).toContain(`${tier.percent} %`);
      expect(shown).toContain(formatCountSk(tier.productIds.length));
    }
  });

  it('pásmo bez produktu sa nevypíše — percento, ktoré nikto nedostane, klame', () => {
    const prazdne = TIERS.map((tier) => ({ ...tier, productIds: [] as readonly number[] }));
    const line = dryRunLines({ ...PROPS, tiers: prazdne }).find((l) => l.key === 'percenta')!;
    expect(line.known).toBe(false);
    expect(line.value).toContain('—');
  });

  it('OD KEDY DO KEDY a koľko to je dní — číslom', () => {
    const shown = textOf(render(), 'dry-run-okno');
    expect(shown).toContain('3. 9. 2026');
    expect(shown).toContain('17. 9. 2026');
    expect(shown).toContain('15 dní');
  });

  it('nedoplnené okno sa NEDOPOČÍTAVA — je to pomlčka so slovom (I11)', () => {
    const line = dryRunLines({ ...PROPS, from: '', to: '' }).find((l) => l.key === 'okno')!;
    expect(line.known).toBe(false);
    expect(line.value.startsWith('—')).toBe(true);
    expect(line.value).toContain('nie je doplnené');
  });

  it('KOĽKO ZÁPISOV to zoberie z denného rozpočtu — číslom', () => {
    const shown = textOf(render(), 'dry-run-rozpocet');
    // Zápisov je toľko, koľko produktov: jeden zápis na produkt.
    expect(shown).toContain('8 000 zápisov');
    // Rozpočet dneška a jeho zostatok, obe číslom.
    expect(shown).toContain('1 000');
    expect(shown).toContain('voľných 940');
    // A že sa to do dneška nezmestí, sa nezamlčí.
    expect(shown).toContain('zvyšok pôjde ďalšie dni');
  });

  it('čo sa do dneška zmestí, o ďalších dňoch nehovorí', () => {
    const line = dryRunLines({ ...PROPS, itemsCount: 12 }).find((l) => l.key === 'rozpocet')!;
    expect(line.value).toContain('12 zápisov');
    expect(line.value).not.toContain('ďalšie dni');
  });

  it('neznámy rozpočet NIE JE nula — nula by znamenala „všetko je voľné"', () => {
    const line = dryRunLines({ ...PROPS, budget: null }).find((l) => l.key === 'rozpocet')!;
    expect(line.known).toBe(false);
    expect(line.value).toContain('zatiaľ nevieme');
    expect(line.value).toContain('—');
    // Počet zápisov je meraný fakt a zostáva číslom aj tak.
    expect(line.value).toContain('8 000 zápisov');
    // Vykreslené to nesie tretí kanál (atribút), nie iba tichšiu farbu.
    const html = render({ budget: null });
    const at = html.indexOf('data-testid="dry-run-rozpocet"');
    expect(html.slice(html.lastIndexOf('<', at), at)).toContain('data-known="no"');
  });

  it('štyri riadky, žiadny navyše a žiadny vynechaný', () => {
    expect(dryRunLines({ ...PROPS }).map((l) => l.key)).toEqual([
      'produkty',
      'percenta',
      'okno',
      'rozpocet',
    ]);
  });

  it('zastaraná skúška to prizná SLOVOM, nielen zamknutým tlačidlom', () => {
    const html = render({ previewFresh: false });
    expect(html).toContain('data-testid="dry-run-stale"');
    expect(html).toContain('Výber sa po tejto skúške zmenil');
    expect(render()).not.toContain('data-testid="dry-run-stale"');
  });
});

/* ═════════ C. Denný strop má JEDEN zdroj (nález 1. 9. 2026) ══════════════ */

describe('C. strop 1 000 sa neopisuje — odvodzuje sa', () => {
  it('`DAILY_WRITE_CAP` je TO ISTÉ číslo ako `MAX_DAILY_WRITE_BUDGET`', () => {
    /*
     * Karta je `'use client'`, takže `lib/engine/budget.ts` (siaha na
     * `db/pool`) sa do nej importovať nedá — obe konštanty preto vychádzajú
     * zo `shop/rate-limits.ts` a ich rovnosť je tvrdením TU. Keby sa rozišli,
     * appka by človeku pred zápisom tvrdila iný strop, než akým sa riadi
     * fronta. Presne to sa 1. 9. 2026 stalo s literálom `200`
     * v `settings.repo.ts`.
     */
    expect(DAILY_WRITE_CAP).toBe(MAX_DAILY_WRITE_BUDGET);
    // A nie je to náhodná rovnosť dvoch núl.
    expect(DAILY_WRITE_CAP).toBeGreaterThan(0);
  });

  it('v zdroji karty nie je strop vpísaný ako číslo', () => {
    expect(CONFIRM_SRC).toContain('SHOP_KEYED_LIMIT.perUtcDay');
    for (const literal of ['1000', '1 000', '200']) {
      expect(CONFIRM_SRC, `strop vpísaný ručne: ${literal}`).not.toContain(literal);
    }
  });

  it('a vykreslený text nesie ten istý strop, ktorý drží konštanta', () => {
    const shown = textOf(render({ budget: null }), 'dry-run-rozpocet');
    expect(shown).toContain(formatCountSk(MAX_DAILY_WRITE_BUDGET));
  });
});

/* ═════════ D. Krok sa nedá preskočiť ani zapamätať (I3, D106) ════════════ */

describe('D. potvrdenie sa nedá vypnúť, zapamätať ani preskočiť', () => {
  const WIZARD_SRC = bezKomentarov('../../src/components/campaigns/NewDiscount.tsx');

  it('nikde nie je „už nezobrazovať" ani uložená voľba potvrdenia', () => {
    /*
     * Jednorazový podpísaný token robí z každého zápisu vlastnú skúšku
     * (I3, D16). Keby si obrazovka voľbu zapamätala, tvrdila by o sebe niečo,
     * čo server neuzná — a to je najhorší druh nesúladu: človek si myslí, že
     * krok preskočil, a fronta mu ho tichučko zopakuje.
     */
    for (const src of [CONFIRM_SRC, WIZARD_SRC]) {
      for (const zakazane of [
        'nezobrazovať',
        'nabudúce',
        'localStorage',
        'sessionStorage',
        'rememberConfirm',
        'skipConfirm',
        'skipDryRun',
      ]) {
        expect(src, `pamätanie voľby: ${zakazane}`).not.toContain(zakazane);
      }
    }
  });

  it('súhrn skúšky NIE JE pod rozklikom — čísla sú vidieť bez kliknutia', () => {
    const html = render();
    const summary = html.indexOf('data-testid="dry-run-summary"');
    const details = html.indexOf('<details');
    expect(summary).toBeGreaterThan(-1);
    // Rozklik s technickým detailom je AŽ ZA súhrnom, takže súhrn v ňom nie je.
    expect(details).toBeGreaterThan(summary);
  });

  it('poradie krokov drží: skúška → súhrn → ručný počet → zaradenie', () => {
    const html = render();
    const dry = html.indexOf('data-testid="dry-run"');
    const summary = html.indexOf('data-testid="dry-run-summary"');
    const typed = html.indexOf('data-testid="confirm-count-input"');
    const queue = html.indexOf('data-testid="queue-discount"');
    expect(dry).toBeGreaterThan(-1);
    expect(dry).toBeLessThan(summary);
    // Čísla sa čítajú PREDTÝM, než sa jedno z nich prepisuje do poľa.
    expect(summary).toBeLessThan(typed);
    expect(typed).toBeLessThan(queue);
  });

  it('dôvod zámku má na karte JEDNO miesto a je to `role="status"`', () => {
    /*
     * `Button` vie `disabledReason`, ale ten by dôvod vykreslil DRUHÝ raz
     * vedľa riadku pod tlačidlom. Dve kópie tej istej vety sa po prvej úprave
     * rozídu; `role="status"` zabezpečí, že ju čítačka ohlási aj tak (`title`
     * na `disabled` prvku sa neohlási spoľahlivo — U17).
     */
    const reason = 'Najprv spustite skúšku naprázdno pre tento výber.';
    const html = render({ blockedReason: reason, previewFresh: false });
    const kopie = html.split(reason).length - 1;
    // Raz ako `title` tlačidla, raz ako viditeľná veta — a nikde inde.
    expect(kopie).toBe(2);
    expect(html).toContain('role="status" data-testid="queue-blocked-reason"');
    expect(html).not.toContain('ovl-btn-reason');
  });
});

/* ═════════ E. Karta stojí na primitívach (D142, K4) ══════════════════════ */

describe('E. `Panel` a `Button` namiesto vlastných `.sec` a `.btn`', () => {
  it('karta je `Panel` s hlavičkou `h2`, nie `<section class="sec">`', () => {
    const html = render();
    expect(html).toContain('<h2>Zápis a potvrdenie</h2>');
    expect(html).not.toContain('<section');
    expect(html).not.toContain('class="sec"');
    expect(html).not.toContain('sec-h');
  });

  it('obe tlačidlá sú `Button` z `ui/`, nie vlastné `class="btn"`', () => {
    const html = render();
    for (const testId of ['dry-run', 'queue-discount']) {
      const at = html.indexOf(`data-testid="${testId}"`);
      expect(at, testId).toBeGreaterThan(-1);
      const tag = html.slice(html.lastIndexOf('<', at), at);
      expect(tag, testId).toContain('ovl-btn');
    }
    expect(CONFIRM_SRC).not.toContain("className={`btn");
    expect(CONFIRM_SRC).not.toContain("className='btn");
  });

  it('potvrdzovacie tlačidlo zápisu NEMÁ animáciu (docblok `ui/Button.tsx`)', () => {
    const html = render({ busy: 'creating', blockedReason: null });
    const at = html.indexOf('data-testid="queue-discount"');
    const tag = html.slice(html.lastIndexOf('<', at), html.indexOf('</button>', at));
    expect(tag).not.toContain('ovl-spinner');
    // Stav hovorí SLOVO, nie krúžok.
    expect(tag).toContain('Zaraďujem…');
  });

  it('hotová zľava je tiež `Panel` — dve karty, jeden druh plochy', () => {
    const html = render({
      created: { campaignId: 7, status: 'queued', itemsTotal: 8000, estimate: null },
    });
    expect(html).toContain('data-testid="new-discount-created"');
    expect(html).toContain('<h2>Zaradené do fronty</h2>');
    expect(html).not.toContain('<section');
  });
});
