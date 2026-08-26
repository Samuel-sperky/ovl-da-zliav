/**
 * Aura Zľavy — PREHĽAD: každá značka stavu je IKONA V TOM ISTOM UZLE (vlna 1,
 * pracovník A1, šprint 20. 8. 2026).
 *
 * PREČO TENTO SÚBOR EXISTUJE, KEĎ UŽ JE `ikony.spec.ts`
 * -----------------------------------------------------
 * `test/unit/ikony.spec.ts` stráži tú istú vec, ale s hrubosťou SÚBORU: pýta sa
 * „kreslí tento súbor aspoň jednu značku?". Prehľad má pritom v jednom súbore
 * (`StatusSection.tsx`) DVOCH tónovaných hostiteľov naraz — slovo verdiktu
 * v hlavičke sekcie a riadok kontrol pod dominantou. Keby značka zmizla len
 * z riadku kontrol, `ikony.spec.ts` by ostal ZELENÝ, lebo slovo verdiktu značku
 * má a súbor tým podmienku splní. Presne tak vznikol defekt, ktorý sa tu meria:
 * kontrola „Rozsah pilotný" o značku raz už prišla, keď sa vyprázdnilo
 * `.sig.lock::before`, a nič nespadlo — na obrazovke ostala len sivá farba
 * a slovo, teda dva kanály z troch.
 *
 * Tento súbor preto meria po VÝSKYTOCH a nad SKUTOČNE VYKRESLENÝM markupom
 * (`renderToStaticMarkup`, žiadny prehliadač, žiadna sieť).
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 *  A. **Meria sa výstup, nie zdroj.** Trieda `.sig lock` v zdroji nikde
 *     nestojí — skladá ju `sigClass(tone)` (`dashboard/live-status-model.ts`)
 *     z tónu, ktorý vracia `scopeCheck()` (`dashboard/overview-verdict.ts`)
 *     v pilotnom rozsahu. Kto by tu hľadal literál, dokáže si nepravdu; to je
 *     pasca, ktorá tento šprint už raz zdržala.
 *  B. **Tri kanály sa merajú ako tri.** FARBA je trieda tónu, ZNAČKA je
 *     `<svg class="ovl-ic">` vnútri toho istého uzla, SLOVO je text toho istého
 *     uzla. Test, ktorý by overil len prítomnosť triedy, prejde aj nad stavom
 *     bez značky.
 *  C. **Značka musí byť POTOMOK hostiteľa, nie súrodenec.** Preto sa markup
 *     naozaj parsuje na strom a `<svg>` sa hľadá vo VNÚTRI uzla. Značka o uzol
 *     vedľa by sa síce nakreslila, ale s vlastnou farbou a na inom mieste
 *     riadku — a `.sig` je `inline-flex` s `gap`, teda kontajner pre dve deti.
 *  D. **Prázdny zoznam hostiteľov nesmie prejsť.** Každé tvrdenie o „všetkých
 *     hostiteľoch" má pred sebou poistku, že sa vôbec nejakí našli. Bez nej by
 *     rozbitý parser svietil zeleno — tak vznikol zelený test o troch mŕtvych
 *     selektoroch (19. 8. 2026, bod A hlavičky `ikony.spec.ts`).
 *
 * SKENER JE OD 24. 8. 2026 SPOLOČNÝ
 * ---------------------------------
 * Vlastný parser markupu z tohto súboru (`parse`, `classOf`, `textOf`, `hosts`,
 * `hasMark`, `label`) sa zlúčil s dvomi takmer rovnakými kópiami A2 a A3 do
 * `test/helpers/znacky.ts` — dôvody a zoznam rozdielov sú v hlavičke toho
 * súboru. Meranie tým zosilnelo v jednom podstatnom bode: za značku sa už
 * nepočíta hocijaké `<svg>`, ale len ikona zo sady `ui/Icon.tsx`
 * (`<svg class="ovl-ic">`). Kus dekoratívnej grafiky v uzle tento test už
 * neupokojí. Poistky na počet hostiteľov (bod D) ostávajú tam, kde boli.
 *
 * Vlastník: A1, vlna 1 šprintu 20. 8. 2026.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import BlockersSection from '@/components/dashboard/BlockersSection';
import CampaignsSection from '@/components/dashboard/CampaignsSection';
import StatusSection from '@/components/dashboard/StatusSection';

import type { CampaignRow, InsightRow } from '@/components/dashboard/api';
import { liveCampaigns, queueProgress, type QueueProgress } from '@/components/dashboard/overview-model';
import {
  overviewChecks,
  overviewVerdict,
  type VerdictInput,
} from '@/components/dashboard/overview-verdict';
import type {
  BlockerRow,
  CatalogSyncView,
  StatusView,
} from '@/components/dashboard/status-api';

import {
  hostitelia,
  maZnacku,
  popis,
  text,
  uzly,
  znackaJePrva,
  type Uzol,
} from '../helpers/znacky';

const TODAY = '2026-08-12';

/* ══════════════════════════ 1. Drobný parser markupu ══════════════════════ */

/**
 * Parser markupu (`uzly`, `hostitelia`, `text`, `maZnacku`, `znackaJePrva`,
 * `popis`) je v `test/helpers/znacky.ts` — pozri hlavičku tohto súboru.
 * Tu ostávajú len snímky Prehľadu a tvrdenia nad nimi.
 */

/* ═══════════════════════════ 2. Snímky Prehľadu ═══════════════════════════ */

function sync(patch: Partial<CatalogSyncView> = {}): CatalogSyncView {
  return {
    loadedProducts: 2900,
    shopTotalProducts: 41082,
    complete: false,
    refreshing: false,
    lastReadAt: '2026-08-12T08:40:00.000Z',
    waiting: null,
    nextBatchAt: '2026-08-12T09:15:00.000Z',
    estimatedFinishAt: '2026-08-14T00:00:00.000Z',
    failedLastTime: false,
    ipBanned: false,
    ...patch,
  };
}

function status(patch: Partial<StatusView> = {}): StatusView {
  return {
    writes: { enabled: true, locked: false },
    apiKey: { present: true, expiresAt: '2026-08-13T09:00:00.000Z' },
    writeBudget: { budget: 200, spent: 100, remaining: 100, exhausted: false },
    scope: { pilot: true, maxProducts: 10 },
    catalog: { loadedProducts: 2900, shopTotalProducts: 41082 },
    blockers: [],
    blocked: false,
    unreadable: [],
    ...patch,
  };
}

function running(): QueueProgress {
  return queueProgress({
    snapshot: {
      budget: { day: TODAY, budget: 200, spent: 100, remaining: 100, exhausted: false },
      queue: { pending: 4580, total: 8000, done: 3420, campaigns: 1 },
      current: {
        campaignId: 1,
        name: 'Ležiaky striebro — jeseň',
        status: 'queued',
        dateFrom: '2026-09-04',
        dateTo: '2026-09-18',
        itemsTotal: 8000,
        itemsOk: 3408,
        itemsFailed: 12,
        itemsUncertain: 0,
        itemsPending: 4580,
        late: false,
      },
      estimate: { pending: 4580, perDay: 200, days: 23, date: '2026-09-02' },
      heartbeat: { lastTickAt: '2026-08-12T08:59:00.000Z', stale: false },
      gate: { paused: false, since: null },
    },
    campaigns: [],
    today: TODAY,
  });
}

function input(patch: Partial<VerdictInput> = {}): VerdictInput {
  return {
    status: status(),
    sync: sync(),
    heartbeat: { lastTickAt: '2026-08-12T08:59:00.000Z', stale: false },
    progress: running(),
    ...patch,
  };
}

function renderStatus(patch: Partial<VerdictInput> = {}): string {
  const view = input(patch);
  return renderToStaticMarkup(
    createElement(StatusSection, {
      verdict: overviewVerdict(view),
      checks: overviewChecks(view),
      progress: view.progress,
      budget: { spent: 100, budget: 200, remaining: 100 },
      calm: { live: 1, ready: 1, discounted: 2380 },
      gap: null,
      onChanged: (): void => {},
    }),
  );
}

function blocker(patch: Partial<BlockerRow> = {}): BlockerRow {
  return {
    id: 'key_missing',
    severity: 'blokuje',
    resolution: 'mimo_appky',
    what: 'Zápisy do shopu sú vypnuté.',
    nextStep: 'Zapnúť ich môže len správca počítača.',
    path: '/nastavenia',
    assumed: false,
    ...patch,
  };
}

/** Tri prekážky, tri úrovne závažnosti, tri spôsoby riešenia. */
function renderBlockers(): string {
  return renderToStaticMarkup(
    createElement(BlockersSection, {
      blockers: [
        blocker(),
        blocker({
          id: 'scope_pilot_cap',
          severity: 'informuje',
          resolution: 'sudo',
          what: 'V pilotnom režime prejde na jednu zľavu najviac 10 produktov.',
          nextStep: 'Prepnite rozsah na plný v Nastaveniach.',
          assumed: true,
        }),
        blocker({
          id: 'catalog_empty',
          severity: 'obmedzuje',
          resolution: 'sam',
          what: 'Katalóg je prázdny.',
          nextStep: 'Spustite načítanie katalógu v Produktoch.',
          path: '/produkty',
        }),
      ],
    }),
  );
}

function campaignRow(patch: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: 1,
    name: 'Ležiaky striebro — jeseň',
    status: 'running',
    percent: 20,
    dateFrom: '2026-08-04',
    dateTo: '2026-09-18',
    itemsTotal: 8000,
    itemsOk: 3408,
    // Zlyhané položky sú tu zámerne: bez nich zľava nemá PRÍZNAK (`.flag`)
    // a `CampaignsSection` by do merania nepriniesla ani jedného hostiteľa.
    itemsFailed: 12,
    itemsUncertain: 0,
    itemsPending: 4580,
    late: false,
    tiers: [],
    estimate: null,
    ...patch,
  };
}

function insight(patch: Partial<InsightRow> = {}): InsightRow {
  return {
    id: 'failed_items',
    tone: 'attention',
    text: 'Dvanásť položiek sa nezapísalo.',
    href: '/zlavy/1',
    action: null,
    ...patch,
  };
}

function renderCampaigns(): string {
  return renderToStaticMarkup(
    createElement(CampaignsSection, {
      campaigns: liveCampaigns([campaignRow()], TODAY),
      insights: [insight(), insight({ id: 'slow_movers', tone: 'info', text: 'Ležiaky v striebre.' })],
    }),
  );
}

/** Celý Prehľad naraz — všetky tri sekcie, ktoré vlastní A1. */
const PREHLAD = [renderStatus(), renderBlockers(), renderCampaigns()].join('\n');

/* ════════════ 3. Parser meria to, čo si myslí, že meria (bod D) ═══════════ */

describe('parser markupu', () => {
  it('nájde uzol aj s jeho vnútrom, nie len s atribútmi', () => {
    const najdene = hostitelia(
      '<div><span class="sig lock"><svg class="ovl-ic"></svg>Rozsah</span></div>',
    );
    expect(najdene).toHaveLength(1);
    expect(maZnacku(najdene[0]!)).toBe(true);
    expect(text(najdene[0]!)).toBe('Rozsah');
  });

  it('značka o uzol VEDĽA sa za značku hostiteľa nepočíta (bod C)', () => {
    const najdene = hostitelia('<span class="sig ok">Hotovo</span><svg class="ovl-ic"></svg>');
    expect(najdene).toHaveLength(1);
    expect(maZnacku(najdene[0]!)).toBe(false);
  });

  it('dekoratívne <svg> bez ikony zo sady sa za značku nepočíta', () => {
    // Od zlúčenia skenerov (24. 8. 2026) je značkou len `<svg class="ovl-ic">`.
    // Kus grafiky v uzle tento test už neupokojí.
    const najdene = hostitelia('<span class="sig ok"><svg class="deko"></svg>Hotovo</span>');
    expect(najdene).toHaveLength(1);
    expect(maZnacku(najdene[0]!)).toBe(false);
  });

  it('hašované meno z CSS modulu hostiteľom nie je', () => {
    expect(hostitelia('<span class="_flagCritical_1a2b3">x</span>')).toHaveLength(0);
  });
});

/* ══════════ 4. „Rozsah pilotný" má značku v každom stave rozsahu ══════════ */

describe('kontrola „Rozsah pilotný" nesie všetky tri kanály', () => {
  /** Uzol kontroly rozsahu z vykresleného riadku kontrol. */
  function uzolRozsahu(scope: StatusView['scope']): Uzol {
    const html = renderStatus({ status: status({ scope }) });
    const uzol = uzly(html).find((u) => u.atributy['data-check'] === 'rozsah');
    expect(uzol, 'kontrola rozsahu sa v riadku kontrol nenašla').toBeDefined();
    return uzol!;
  }

  it('v pilotnom rozsahu je farba, ZNAČKA aj slovo', () => {
    const uzol = uzolRozsahu({ pilot: true, maxProducts: 10 });
    // FARBA — trieda `sig lock` vzniká za behu zo `sigClass('lock')`; v zdroji
    // ten literál nikde nestojí (bod A hlavičky).
    expect(uzol.triedy).toContain('lock');
    // ZNAČKA — ikona zámku vo VNÚTRI toho istého uzla.
    expect(maZnacku(uzol), 'Rozsah pilotný ostal bez značky').toBe(true);
    // SLOVO — bez neho je stav pod deuteranopiou nečitateľný.
    expect(text(uzol)).toContain('Rozsah pilotný');
  });

  it('v plnom rozsahu a pri neznámom rozsahu tiež', () => {
    const plny = uzolRozsahu({ pilot: false, maxProducts: 41220 });
    expect(maZnacku(plny)).toBe(true);
    expect(text(plny)).toContain('Rozsah plný');

    const neznamy = uzolRozsahu({ pilot: null, maxProducts: null });
    expect(maZnacku(neznamy)).toBe(true);
    expect(text(neznamy)).toContain('Rozsah zľavy nevieme');
  });

  it('značka zámku je ikona, nie znak ani pozadie z CSS', () => {
    const uzol = uzolRozsahu({ pilot: true, maxProducts: 10 });
    expect(uzol.vnutro).toMatch(/<svg[^>]*class="[^"]*ovl-ic/);
    // Druhá kópia cesty ikony (maska v CSS) sa sem nesmie vrátiť.
    expect(uzol.vnutro).not.toMatch(/data:image\/svg/);
  });
});

/* ═══════ 5. Po VÝSKYTOCH: ani jeden hostiteľ na Prehľade bez značky ═══════ */

describe('každý stav na Prehľade má značku vo svojom uzle', () => {
  it('hostiteľov sa vôbec nejakých našlo (poistka, bod D)', () => {
    // Zmerané 20. 8. 2026: `StatusSection` dáva sedem hostiteľov (slovo
    // verdiktu, štyri kontroly, stav a príznak bežiacej zľavy), prekážky tri
    // a `CampaignsSection` tri — spolu trinásť. Hranica je pod tým zámerne:
    // tvrdenie má chytiť rozbitý parser, nie spadnúť pri každom ubratom riadku
    // (vlna 2 skracuje texty práve v týchto sekciách). Bez tejto poistky by
    // obe tvrdenia nižšie svietili zeleno nad prázdnym zoznamom.
    expect(hostitelia(renderStatus()).length).toBeGreaterThanOrEqual(6);
    expect(hostitelia(PREHLAD).length).toBeGreaterThanOrEqual(12);
  });

  it('ani jeden hostiteľ nie je len farba a slovo', () => {
    const bezZnacky = hostitelia(PREHLAD).filter((u) => !maZnacku(u)).map(popis);
    expect(bezZnacky, 'stav bez značky — chýba tretí kanál').toEqual([]);
  });

  it('ani jeden hostiteľ nie je len farba a značka', () => {
    const bezSlova = hostitelia(PREHLAD).filter((u) => text(u) === '').map(popis);
    expect(bezSlova, 'stav bez slova — pod deuteranopiou nečitateľný').toEqual([]);
  });

  it('značka stojí pred slovom, nie za ním (rovnaké x na každom riadku)', () => {
    const neskoro = hostitelia(PREHLAD).filter((u) => !znackaJePrva(u)).map(popis);
    expect(neskoro).toEqual([]);
  });
});
