/**
 * Aura Zľavy — PRESETY NA OBRAZOVKE (D112, K7; KONTRAKT-V4-2026-08-28 §5).
 *
 * Jedna vec je na tomto teste podstatná a všetko ostatné je vedľa nej drobnosť:
 *
 *   **SPUSTENIE PRESETU MUSÍ SKONČIŤ NA FORMULÁRI SO SKÚŠKOU NAPRÁZDNO,
 *   NIE PRI ZÁPISE.**
 *
 * Appka nemá prihlásenie (D98–D100), takže dry-run a potvrdenie sú JEDINÉ, čo
 * pred PRODUKČNÝM eshopom zostalo (I3). Preset drží percentá a filter, teda
 * presne tie hodnoty, ktoré dry-run overuje — a preset uložený minulý mesiac je
 * nad medzitým zmeneným katalógom INÁ množina produktov než tá, ktorú človek
 * videl. Keby klik na preset viedol k zápisu, appka by tie hodnoty potvrdila
 * sama sebou.
 *
 * Skupiny:
 *
 *  A. Preset → ADRESA formulára. Nikdy nie adresa API a nikdy nie „run".
 *  B. Predplnený formulár stále žiada skúšku naprázdno a ručný počet.
 *     Meria sa `queueBlockedReason()` (tá istá funkcia, akú volá obrazovka)
 *     a VYKRESLENÝ formulár, nie zdrojový text.
 *  C. Uloženie aktuálneho nastavenia — pásmo si nesie PRAVIDLO, počty nie.
 *  D. Riadok zoznamu je ODKAZ, nie tlačidlo zápisu; veta o tom, čo preset
 *     nerobí, je na obrazovke.
 *  E. I11 — čo sa nedá prečítať, sa prizná: nepoužitý preset, pásmo bez
 *     pravidla, percento mimo rozsahu z adresy.
 *  F. Zopakovanie zľavy prenáša pravidlo a okno, NIE zoznam produktov.
 *
 * Renderuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna DB, žiadna
 * sieť. Efekty (a teda aj načítavanie) sa pri serverovom vykreslení nespúšťajú,
 * preto majú `PresetRow` aj `TimelineBands` vlastné exporty: inak by tvrdenia
 * merali stav „ešte nič neprišlo".
 *
 * Vlastník: V4 (obrazovka Zľavy).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import NewDiscount, {
  queueBlockedReason,
  type NewDiscountInitial,
  type QueueGateState,
} from '@/components/campaigns/NewDiscount';
import DiscountPresets, { PresetRow } from '@/components/campaigns/DiscountPresets';
import { buildTiers, type SelectableRow } from '@/components/campaigns/discounts-model';
import { parsePreset } from '@/components/campaigns/presets-api';
import {
  PRESET_NOTE,
  parseDurationParam,
  parsePercentsParam,
  prefillNoteText,
  presetDraftFrom,
  presetPercents,
  presetPrefillHref,
  presetSaveBlockedReason,
  presetSummarySk,
  repeatDiscountHref,
  tierRuleOf,
  type PresetView,
} from '@/components/campaigns/presets-model';
import type { DiscountRow } from '@/components/campaigns/zlavy-api';
import {
  DEFAULT_CATALOG_FILTER,
  parseCatalogFilterQuery,
} from '@/components/products/catalog-filter';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const ROWS: SelectableRow[] = [
  { productId: 18342, name: 'Strieborné náušnice Lumen', price: '34.90', unitsSold: 0, discountedNow: false },
  { productId: 21170, name: 'Strieborný prsteň Aurora', price: '49.00', unitsSold: 1, discountedNow: false },
];

/** Preset tak, ako ho vracia `GET /api/presets` (`presetView()` na serveri). */
const PRESET: PresetView = {
  id: 7,
  name: 'Ležiaky jeseň',
  filterQuery: 'soldWindowDays=180&soldBuckets=none%2Clow',
  tiers: [
    { ord: 1, label: 'A · 0 predaných za 180 dní', percent: 25, rule: { soldWindowDays: 180, bucket: 'none' } },
    { ord: 2, label: 'B · 1–2 predané za 180 dní', percent: 12, rule: { soldWindowDays: 180, bucket: 'low' } },
  ],
  durationDays: 21,
  createdAt: '2026-08-20T08:00:00.000Z',
  lastUsedAt: null,
};

/** Parametre adresy, ktorú preset vyrobil. */
function paramsOf(href: string): URLSearchParams {
  const at = href.indexOf('?');
  expect(at).toBeGreaterThan(-1);
  return new URLSearchParams(href.slice(at + 1));
}

/* ═════════ A. Preset vedie na FORMULÁR, nie na zápis ══════════════════════ */

describe('A. spustenie presetu je adresa formulára novej zľavy (I3)', () => {
  const href = presetPrefillHref(PRESET);

  it('vedie na `/zlavy/nova`, teda na obrazovku so skúškou naprázdno', () => {
    expect(href.startsWith('/zlavy/nova?')).toBe(true);
  });

  it('nevedie na žiadne API a na nič, čo by preset „spustilo"', () => {
    /*
     * Keby tu niekedy vznikla adresa typu `/api/presets/7/run` alebo
     * `/api/campaigns`, preset by sa stal druhou zápisovou cestou — a tá by
     * hodnoty potvrdila sama sebou. Na serveri to isté stráži hlavička
     * `src/app/api/presets/_shared.ts`.
     */
    expect(href).not.toContain('/api/');
    expect(href).not.toContain('run');
    expect(href).not.toContain('confirm');
  });

  it('nesie filter, percentá pásiem, dĺžku okna a meno presetu', () => {
    const params = paramsOf(href);
    expect(params.get('filter')).toBe(PRESET.filterQuery);
    expect(params.get('pasma')).toBe('none:25,low:12');
    expect(params.get('dni')).toBe('21');
    expect(params.get('preset')).toBe('Ležiaky jeseň');
  });

  it('nenesie zoznam produktov — sada sa vyberá znova z dnešného katalógu', () => {
    expect(paramsOf(href).has('produkty')).toBe(false);
  });

  it('modul presetov nikde nesiaha na zápisové cesty', () => {
    for (const rel of [
      '../../src/components/campaigns/presets-model.ts',
      '../../src/components/campaigns/presets-api.ts',
      '../../src/components/campaigns/DiscountPresets.tsx',
    ]) {
      const src = read(rel);
      // Komentáre tie mená spomínať SMÚ (vysvetľujú, prečo tam nie sú),
      // takže sa merajú len skutočné volania.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      expect(code, `${rel} volá zápis kampane`).not.toContain('/api/campaigns');
      expect(code, `${rel} volá previewDiscount`).not.toContain('previewDiscount(');
      expect(code, `${rel} volá createDiscount`).not.toContain('createDiscount(');
      expect(code, `${rel} volá setReduction`).not.toContain('setReduction');
    }
  });
});

/* ═════════ B. Predplnený formulár = dry-run nanovo ════════════════════════ */

describe('B. predplnený formulár stále žiada skúšku naprázdno a potvrdenie (I3)', () => {
  /** Adresa presetu prečítaná TÝMI ISTÝMI parsermi, aké používa stránka. */
  function initialFromPreset(): NewDiscountInitial {
    const params = paramsOf(presetPrefillHref(PRESET));
    const filterQuery = params.get('filter');
    return {
      productIds: null,
      filter:
        filterQuery === null ? DEFAULT_CATALOG_FILTER : parseCatalogFilterQuery(filterQuery),
      expectedTotal: null,
      window: null,
      percents: parsePercentsParam(params.get('pasma') ?? undefined),
      windowDays: parseDurationParam(params.get('dni') ?? undefined),
      prefillFrom: { kind: 'preset', label: params.get('preset') ?? '' },
    };
  }

  const initial = initialFromPreset();
  const html = renderToStaticMarkup(createElement(NewDiscount, { initial }));

  it('adresa presetu sa prečíta na hodnoty formulára', () => {
    expect(initial.percents).toEqual({ none: 25, low: 12 });
    expect(initial.windowDays).toBe(21);
    expect(initial.filter.soldWindowDays).toBe(180);
    expect(initial.filter.soldBuckets).toEqual(['none', 'low']);
  });

  it('percentá presetu naozaj sadnú na pásma, ktoré z nich vzniknú', () => {
    const tiers = buildTiers(ROWS, initial.filter.soldWindowDays, initial.percents).tiers;
    expect(tiers.map((tier) => [tier.bucket, tier.percent])).toEqual([
      ['none', 25],
      ['low', 12],
    ]);
  });

  it('formulár povie, odkiaľ sú polia — a že sa tým NIČ nezapísalo', () => {
    expect(html).toContain('data-testid="prefill-note"');
    expect(html).toContain('Ležiaky jeseň');
    expect(html).toContain('Preset nič nezapísal');
  });

  it('na obrazovke stojí skúška naprázdno a zámok zaradenia', () => {
    expect(html).toContain('data-testid="dry-run"');
    expect(html).toContain('Skúška naprázdno');
    expect(html).toContain('Skúška nič nezapíše');
    /*
     * Pole ručného počtu je pri prázdnom výbere ZAMKNUTÉ a hovorí dôvod —
     * predplnený formulár teda nemá odomknutý ani jeden krok potvrdenia.
     */
    expect(html).toContain('data-testid="confirm-count-locked"');
    expect(html).toContain('data-testid="queue-blocked-reason"');
  });

  it('bez čerstvej skúšky sa z predplneného formulára zaradiť NEDÁ', () => {
    /*
     * Tá istá funkcia, akú volá obrazovka. Stav je „všetko ostatné hotové",
     * takže jediný dôvod zámku je chýbajúca skúška — presne to, čo by preset
     * musel obísť, keby chcel zapisovať.
     */
    const gate: QueueGateState = {
      itemsCount: 2,
      writesLocked: false,
      percentError: undefined,
      windowError: null,
      previewFresh: false,
      previewBlockers: 0,
      typed: '2',
    };
    expect(queueBlockedReason(gate)).toBe('Najprv spustite skúšku naprázdno pre tento výber.');
  });

  it('ani po skúške sa nezaradí bez ručne vpísaného počtu', () => {
    const gate: QueueGateState = {
      itemsCount: 2,
      writesLocked: false,
      percentError: undefined,
      windowError: null,
      previewFresh: true,
      previewBlockers: 0,
      typed: '',
    };
    expect(queueBlockedReason(gate)).toBe('Do poľa napíšte 2.');
  });

  it('veta o predplnení hovorí obe veci — odkiaľ aj že sa nič nezapísalo', () => {
    const fromPreset = prefillNoteText({ kind: 'preset', label: 'Ležiaky jeseň' });
    const fromCampaign = prefillNoteText({ kind: 'campaign', label: 'Zľava do 25 %' });
    for (const sentence of [fromPreset, fromCampaign]) {
      expect(sentence).not.toBeNull();
      expect(sentence).toContain('skúške naprázdno');
      expect(sentence).toContain('potvrdení');
    }
    expect(fromCampaign).toContain('vyberajú znova z aktuálneho katalógu');
    expect(prefillNoteText(null)).toBeNull();
    expect(prefillNoteText({ kind: 'preset', label: '   ' })).toBeNull();
  });
});

/* ═════════ C. Uloženie aktuálneho nastavenia ══════════════════════════════ */

describe('C. uloženie aktuálneho nastavenia ako preset', () => {
  const tiers = buildTiers(ROWS, 180, { none: 25, low: 12 }).tiers;

  it('pásmo si nesie PRAVIDLO (vedro + okno) — inak sa nedá predplniť', () => {
    const draft = presetDraftFrom({ name: 'Ležiaky jeseň', filter: { ...DEFAULT_CATALOG_FILTER, soldWindowDays: 180 }, tiers, windowDays: 21 });
    expect(draft).not.toBeNull();
    expect(draft!.tiers.map((tier) => tier.rule)).toEqual([
      { soldWindowDays: 180, bucket: 'none' },
      { soldWindowDays: 180, bucket: 'low' },
    ]);
    expect(draft!.durationDays).toBe(21);
    expect(draft!.filterQuery).toContain('soldWindowDays=180');
  });

  it('počty produktov sa NEUKLADAJÚ — vie ich až dry-run nad dnešným katalógom (I11)', () => {
    const draft = presetDraftFrom({ name: 'X', filter: DEFAULT_CATALOG_FILTER, tiers, windowDays: 14 });
    for (const tier of draft!.tiers) {
      expect(Object.keys(tier)).toEqual(['ord', 'label', 'percent', 'rule']);
    }
    expect(JSON.stringify(draft)).not.toContain('itemsCount');
  });

  it('fail-closed: bez mena, bez pásiem a s nemožným oknom sa neposiela nič', () => {
    expect(presetDraftFrom({ name: '  ', filter: DEFAULT_CATALOG_FILTER, tiers, windowDays: 14 })).toBeNull();
    expect(presetDraftFrom({ name: 'X', filter: DEFAULT_CATALOG_FILTER, tiers: [], windowDays: 14 })).toBeNull();
    expect(presetDraftFrom({ name: 'X', filter: DEFAULT_CATALOG_FILTER, tiers, windowDays: 0 })).toBeNull();
    expect(presetDraftFrom({ name: 'X', filter: DEFAULT_CATALOG_FILTER, tiers, windowDays: 91 })).toBeNull();
  });

  it('dôvod zámku je veta pre človeka, nie mlčanie', () => {
    expect(presetSaveBlockedReason({ name: '', tiers, windowDays: 14 })).toBe('Preset potrebuje meno.');
    expect(presetSaveBlockedReason({ name: 'X', tiers: [], windowDays: 14 })).toBe(
      'Bez výberu produktov nie je čo uložiť.',
    );
    expect(presetSaveBlockedReason({ name: 'X', tiers, windowDays: 200 })).toContain('1–90');
    expect(presetSaveBlockedReason({ name: 'X', tiers, windowDays: 14 })).toBeNull();
  });
});

/* ═════════ D. Panel na obrazovke ══════════════════════════════════════════ */

describe('D. panel presetov: odkaz, nie tlačidlo zápisu', () => {
  const rowHtml = renderToStaticMarkup(createElement(PresetRow, { preset: PRESET }));

  it('„Predplniť formulár" je ODKAZ na formulár, nie tlačidlo', () => {
    const at = rowHtml.indexOf('data-testid="preset-use-7"');
    expect(at).toBeGreaterThan(-1);
    const tag = rowHtml.slice(rowHtml.lastIndexOf('<', at), rowHtml.indexOf('>', at) + 1);
    expect(tag.startsWith('<a')).toBe(true);
    expect(tag).toContain('href="/zlavy/nova?');
  });

  it('mazanie je dvojkrokové a je to tlačidlo, nie odkaz', () => {
    expect(rowHtml).toContain('data-testid="preset-delete-7"');
    expect(rowHtml).not.toContain('data-testid="preset-delete-confirm-7"');
    const confirming = renderToStaticMarkup(
      createElement(PresetRow, { preset: PRESET, confirming: true }),
    );
    expect(confirming).toContain('data-testid="preset-delete-confirm-7"');
    expect(confirming).toContain('Naozaj zmazať');
  });

  it('riadok pomenuje preset aj jeho rozsah', () => {
    expect(rowHtml).toContain('Ležiaky jeseň');
    expect(rowHtml).toContain(presetSummarySk(PRESET));
    expect(presetSummarySk(PRESET)).toBe('2 pásma · do 25 % · 21 dní');
  });

  it('panel POVIE, čo preset nerobí — a hovorí to jednou vetou z jedného miesta', () => {
    const html = renderToStaticMarkup(createElement(DiscountPresets, {}));
    expect(html).toContain('data-testid="presets-note"');
    expect(html).toContain('Nič nezapisuje');
    expect(PRESET_NOTE).toContain('skúške naprázdno');
    expect(PRESET_NOTE).toContain('potvrdení');
  });

  it('bez aktuálneho nastavenia sa uložiť nedá ponúknuť; s ním áno', () => {
    const withoutDraft = renderToStaticMarkup(createElement(DiscountPresets, {}));
    expect(withoutDraft).not.toContain('data-testid="preset-save-row"');
    const withDraft = renderToStaticMarkup(
      createElement(DiscountPresets, {
        draft: {
          filter: DEFAULT_CATALOG_FILTER,
          tiers: buildTiers(ROWS, 180, { none: 25 }).tiers,
          windowDays: 14,
        },
      }),
    );
    expect(withDraft).toContain('data-testid="preset-save-row"');
    expect(withDraft).toContain('data-testid="preset-save"');
  });
});

/* ═════════ E. I11 — čo appka nevie, prizná ════════════════════════════════ */

describe('E. nevieme sa nepredstiera ako vieme (I11)', () => {
  it('nepoužitý preset je „ešte nepoužitý", nie dátum', () => {
    expect(renderToStaticMarkup(createElement(PresetRow, { preset: PRESET }))).toContain(
      'ešte nepoužitý',
    );
    expect(parsePreset({ id: 1, name: 'X' })?.lastUsedAt).toBeNull();
  });

  it('pásmo bez čitateľného pravidla sa NEHÁDŽE na iné pásmo — prizná sa', () => {
    const broken: PresetView = {
      ...PRESET,
      tiers: [
        { ord: 1, label: 'A', percent: 25, rule: { soldWindowDays: 180, bucket: 'none' } },
        { ord: 2, label: 'B', percent: 12 },
        { ord: 3, label: 'C', percent: 8, rule: { bucket: 'vymyslene' } },
      ],
    };
    const mapping = presetPercents(broken.tiers);
    expect(mapping.percents).toEqual({ none: 25 });
    expect(mapping.unmappedTiers).toBe(2);
    expect(renderToStaticMarkup(createElement(PresetRow, { preset: broken }))).toContain(
      'nemá čitateľné pravidlo',
    );
    expect(tierRuleOf(null)).toBeNull();
    expect(tierRuleOf({ bucket: 'none' })).toEqual({ bucket: 'none', soldWindowDays: null });
  });

  it('percento z adresy sa mimo 1–30 ZAHADZUJE, nie orezáva', () => {
    expect(parsePercentsParam('none:45,low:0,mid:12,zle:5,high')).toEqual({ mid: 12 });
    expect(parsePercentsParam(undefined)).toEqual({});
    expect(parsePercentsParam('none:12.5')).toEqual({});
  });

  it('dĺžka okna z adresy mimo 1–90 dní je „nevieme", teda `null`', () => {
    expect(parseDurationParam('21')).toBe(21);
    expect(parseDurationParam('0')).toBeNull();
    expect(parseDurationParam('91')).toBeNull();
    expect(parseDurationParam('tri')).toBeNull();
    expect(parseDurationParam(undefined)).toBeNull();
  });
});

/* ═════════ F. Zopakovať zľavu ═════════════════════════════════════════════ */

describe('F. zopakovanie minulej zľavy predplní, ale neskopíruje sadu', () => {
  const CAMPAIGN: DiscountRow = {
    id: 42,
    name: 'Zľava do 25 %',
    status: 'done',
    statusReason: null,
    percent: 25,
    dateFrom: '2026-07-01',
    dateTo: '2026-07-14',
    mode: 'eager',
    itemsTotal: 120,
    itemsOk: 120,
    itemsFailed: 0,
    itemsUncertain: 0,
    itemsPending: 0,
    late: false,
    createdAt: '2026-06-30T10:00:00.000Z',
    tiers: [
      { ord: 1, label: 'A · 0 predaných za 180 dní', percent: 25, itemsCount: 100, rule: { soldWindowDays: 180, bucket: 'none' } },
      { ord: 2, label: 'B · 1–2 predané za 180 dní', percent: 12, itemsCount: 20, rule: { soldWindowDays: 180, bucket: 'low' } },
    ],
    estimate: null,
  };

  it('prenáša pravidlo pásiem, percentá a dĺžku okna', () => {
    const params = paramsOf(repeatDiscountHref(CAMPAIGN));
    expect(params.get('pasma')).toBe('none:25,low:12');
    expect(params.get('dni')).toBe('14');
    expect(params.get('zopakovat')).toBe('Zľava do 25 %');
    expect(params.get('filter')).toContain('soldWindowDays=180');
  });

  it('NEPRENÁŠA zoznam produktov ani pôvodné okno v dátumoch', () => {
    const href = repeatDiscountHref(CAMPAIGN);
    expect(href).toContain('/zlavy/nova?');
    const params = paramsOf(href);
    expect(params.has('produkty')).toBe(false);
    expect(params.has('od')).toBe(false);
    expect(params.has('do')).toBe(false);
  });

  it('zľava bez pravidiel pásiem prenesie svoje jedno percento na všetky pásma', () => {
    const flat: DiscountRow = { ...CAMPAIGN, tiers: [] };
    const params = paramsOf(repeatDiscountHref(flat));
    expect(params.get('pasma')).toBe('none:25,low:25,mid:25,high:25');
    expect(params.has('filter')).toBe(false);
  });

  it('okno dlhšie než 90 dní sa nedopočítava — `dni` sa vynechá', () => {
    const long: DiscountRow = { ...CAMPAIGN, dateFrom: '2026-01-01', dateTo: '2026-06-30' };
    expect(paramsOf(repeatDiscountHref(long)).has('dni')).toBe(false);
  });
});
