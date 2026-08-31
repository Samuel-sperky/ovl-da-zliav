/**
 * Aura Zľavy — SNÍMKOVAČ: vymyslené odpovede appky.
 *
 * Snímkovač nespúšťa server ani databázu. Obrazovky sú ale klientské a čísla si
 * ťahajú samy, takže jediné miesto, kde sa dá appka „naplniť", je `fetch`.
 * Tento modul je preto ROUTER nad tým, čo by odpovedali čítacie endpointy.
 *
 * TRI PRAVIDLÁ, KTORÉ TU PLATIA
 * -----------------------------
 *  1. **Nič skutočné.** Doména, názvy produktov, mená zliav aj čísla sú
 *     vymyslené. V snímke nesmie byť ani jeden ostrý údaj — a už vôbec nie
 *     kľúč, heslo či ich časť.
 *  2. **Nič prázdne.** Prázdna obrazovka nedokáže ukázať, čo je na nej
 *     rozbité. Fixtúry sú preto zaplnené: 240 riadkov katalógu, päť zliav
 *     v rôznych stavoch, trinásť dní predaja, plná história.
 *  3. **Tvar sa neháda.** Každá odpoveď je otypovaná pohľadovým typom appky
 *     (`CatalogSearchView`, `DiscountRow`, `StatusPayload`, …), takže `tsc`
 *     povie, keď sa fixtúra rozíde s tým, čo obrazovka číta.
 *
 * Prekážky sa NEPÍŠU ručne — skladá ich `toStatusPayload()`, teda ten istý
 * kód ako na serveri. Ručne napísaná veta by na snímke vyzerala ako veta
 * appky, hoci by ju appka nikdy nevyrobila.
 *
 * Vlastník: snímkovač (`scripts/snimky.ts`).
 */
import type { AuditPage, AuditRow } from '@/components/audit/api';
import type {
  DiscountDetailData,
  DiscountItemView,
  DiscountRow,
  PerformanceView,
} from '@/components/campaigns/zlavy-api';
import type { QueueSnapshotView, RetryPlanView } from '@/components/campaigns/queue-model';
import type { CatalogSearchView, ProductWritesView } from '@/components/products/catalog-api';
import type { CatalogStatusView } from '@/components/products/catalog-status';
import type { KeyMetaView, QueueView, SettingsView } from '@/components/settings/api';
import { toStatusPayload, type StatusPayload } from '@/lib/status/snapshot';

import { DNES, chvila, den, okamih } from './datumy';
import { KATALOG } from './katalog';

/** Vymyslený eshop. Skutočná doména do snímky nepatrí. */
export const DOMENA = 'https://ukazka-sperky.sk';

const KATALOG_SPOLU = 41_220;

/* ═══════════════════════════ 1. Nastavenia a kľúče ════════════════════════ */

export const NASTAVENIA: SettingsView = {
  shopDomain: DOMENA,
  domainConfirmedAt: okamih(-60 * 24 * 12),
  eagerWriteDefault: true,
  writesLocked: false,
  writesLockedReason: null,
  onboardingDoneAt: okamih(-60 * 24 * 12),
  scopeMode: 'plny',
  maxProducts: 150,
  maxProductsPerCampaign: 150,
  pilotMaxProducts: 10,
  scopeFailClosed: false,
  dailyWriteBudget: 200,
};

/**
 * Kľúč na zápis. `last4` je vymyslená štvorica — nie je to časť skutočného
 * kľúča a ani ňou nesmie byť.
 *
 * PLATNOSŤ MUSÍ BYŤ MOŽNÁ. Do 26. 8. tu stálo `+16 dní` a `savedAt` päť dní
 * dozadu — teda 384 hodín platnosti pri kľúči, ktorému eshop dáva 48 (R2/D69,
 * `KeysSection.tsx:190`). Karta Kľúčov tak na jednej snímke tvrdila „Zápis
 * platí 48 hodín" a hneď pod tým „383 h 59 min", a rovnaké nemožné číslo
 * nieslo pätku ľavého pruhu na VŠETKÝCH obrazovkách. Snímka stavu, v ktorom
 * appka nikdy nemôže byť, sa nedá posudzovať.
 */
export const KLUC: KeyMetaView = {
  present: true,
  last4: '7Q2X',
  savedAt: okamih(-60 * 8),
  expiresAt: okamih(60 * 40),
  secondsLeft: 40 * 60 * 60,
  verifyStatus: 'valid',
};

/** Kľúč na objednávky — 30 dní, teda vlastné TTL, nie kópia zápisového. */
export const KLUC_OBJEDNAVKY: KeyMetaView = {
  present: true,
  last4: 'B4M9',
  savedAt: okamih(-60 * 24 * 4),
  expiresAt: okamih(60 * 24 * 26),
  secondsLeft: 26 * 24 * 60 * 60,
  verifyStatus: 'valid',
};

/* ═══════════════════════════ 2. Stav appky ════════════════════════════════ */

export const STAV: StatusPayload = toStatusPayload({
  now: new Date(),
  snapshot: {
    now: new Date(),
    writes: { enabled: true },
    // Rovnaká platnosť ako `KLUC` — chróm appky a karta Kľúčov nesmú hovoriť
    // dve rôzne veci o tom istom kľúči.
    apiKey: { present: true, expiresAt: chvila(60 * 40) },
    writeBudget: { budget: 200, spent: 128, day: DNES },
    scope: { mode: 'plny', maxProducts: 150, failClosed: false },
    catalog: {
      loadedProducts: KATALOG_SPOLU,
      shopTotalProducts: KATALOG_SPOLU,
      missingProductIds: [],
      estimatedDaysLeft: 0,
    },
    catalogReads: { usedThisMinute: 3, usedThisUtcDay: 96 },
  },
  unreadable: [],
  writeLock: { writesLocked: false, writesLockedReason: null, writesLockedAt: null },
  effectiveMaxProducts: 150,
  catalogLastFetchedAt: chvila(-60 * 9),
});

/* ═══════════════════════════ 3. Katalóg ═══════════════════════════════════ */

export const KATALOG_STAV: CatalogStatusView = {
  loadedProducts: KATALOG_SPOLU,
  shopTotalProducts: KATALOG_SPOLU,
  percent: 100,
  complete: true,
  refreshing: false,
  lastFetchedAt: okamih(-60 * 9),
  lastReadAt: okamih(-60 * 9),
  pagesDone: 412,
  pagesTotal: 412,
  pagesLeft: 0,
  perPage: 100,
  reads: {
    day: DNES,
    limit: 240,
    used: 96,
    remaining: 144,
    exhausted: false,
    resetAt: `${den(1)}T00:00:00.000Z`,
    minuteLimit: 24,
    usedThisMinute: 3,
    known: true,
  },
  waiting: null,
  nextBatchAt: okamih(30),
  estimatedDaysLeft: 0,
  estimatedFinishAt: null,
  lastError: null,
};

function katalogStranka(url: URL): CatalogSearchView {
  const page = Number(url.searchParams.get('page') ?? '1');
  const perPage = Number(url.searchParams.get('perPage') ?? '50');
  const od = (page - 1) * perPage;

  return {
    data: KATALOG.slice(od, od + perPage),
    page,
    perPage: perPage as CatalogSearchView['perPage'],
    total: KATALOG.length,
    soldWindowDays: 30,
    soldFrom: den(-30),
    soldTo: DNES,
    counts: {
      total: KATALOG.length,
      sold: { none: 96, low: 74, mid: 48, high: 22 },
      // Snímky stoja na dočítanom okne: vedrá dávajú v súčte celý katalóg.
      soldUnknown: 0,
      neverDiscounted: 132,
      discountedNow: 27,
      shopDiscountedNow: 9,
      enrichedRows: 41,
      soldWindowDays: 30,
    },
    catalogTotal: KATALOG_SPOLU,
    dataAsOf: okamih(-60 * 9),
    lockedFilters: {},
    discountSource: 'own_writes',
    totalSource: 'mirror',
    lookup: {
      requested: false,
      outcome: 'not_requested',
      shopTotal: null,
      addedFromShop: 0,
      notFetched: 0,
      readsUsed: 0,
      at: null,
      error: null,
    },
    capabilities: [
      {
        id: 'shop_filters',
        available: false,
        note: 'Presné filtre eshopu vie iba kľúč so scope product:read.',
      },
    ],
  };
}

/* ═══════════════════════════ 4. Fronta a rozpočet ═════════════════════════ */

const FRONTA_SPOLU = 1_480;
const FRONTA_HOTOVO = 962;

/**
 * Odpoveď `/api/queue`. Číta ju Prehľad, Zľavy, chróm aj Nastavenia — a každý
 * cez vlastný parser, ktorý si z tela berie inú podmnožinu. Tvar je preto
 * ZJEDNOTENIE všetkých troch pohľadov: `QueueSnapshotView` (Zľavy), `QueueView`
 * (Nastavenia) a polia, ktoré navyše číta Prehľad (`status`, `dateFrom`,
 * `dateTo` bežiacej zľavy). Presne tak sa správa aj skutočná route.
 */
type FrontaWire = Omit<QueueSnapshotView, 'current'> &
  QueueView & {
    readonly current:
      | (NonNullable<QueueSnapshotView['current']> & {
          readonly status: string;
          readonly dateFrom: string;
          readonly dateTo: string;
        })
      | null;
  };

const FRONTA: FrontaWire = {
  budget: { day: DNES, budget: 200, spent: 128, remaining: 72, exhausted: false },
  queue: {
    pending: FRONTA_SPOLU - FRONTA_HOTOVO,
    total: FRONTA_SPOLU,
    done: FRONTA_HOTOVO,
    campaigns: 2,
  },
  items: {
    total: FRONTA_SPOLU,
    pending: FRONTA_SPOLU - FRONTA_HOTOVO,
    done: FRONTA_HOTOVO,
    ok: 948,
    failed: 11,
    uncertain: 3,
    otherResolved: 0,
    campaigns: 2,
  },
  current: {
    campaignId: 42,
    name: 'Letné dočistenie skladu — oceľ',
    status: 'queued',
    dateFrom: den(-2),
    dateTo: den(12),
    itemsTotal: 1_180,
    itemsOk: 948,
    itemsFailed: 11,
    itemsUncertain: 3,
    itemsPending: 218,
    late: false,
  },
  estimate: { pending: 518, perDay: 200, days: 3, date: den(3) },
  limits: {
    shopPerUtcDay: 240,
    shopPerMinute: 20,
    configuredPerDay: 200,
    belowShopCap: true,
    nextResetAt: `${den(1)}T00:00:00.000Z`,
    secondsToReset: 8 * 3600,
  },
  keyStatus: {
    present: true,
    expiresAt: okamih(60 * 24 * 16),
    secondsLeft: 16 * 24 * 60 * 60,
    usable: true,
    expired: false,
  },
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
  heartbeat: { lastTickAt: okamih(-1), staleMs: 60_000, stale: false },
};

/* ═══════════════════════════ 5. Zľavy ═════════════════════════════════════ */

function zlava(patch: Partial<DiscountRow> & Pick<DiscountRow, 'id' | 'name'>): DiscountRow {
  return {
    status: 'done',
    statusReason: null,
    percent: 20,
    dateFrom: den(-30),
    dateTo: den(-2),
    mode: 'scheduled',
    itemsTotal: 120,
    itemsOk: 120,
    itemsFailed: 0,
    itemsUncertain: 0,
    itemsPending: 0,
    late: false,
    createdAt: okamih(-60 * 24 * 40),
    tiers: [],
    estimate: null,
    ...patch,
  };
}

export const ZLAVY: readonly DiscountRow[] = [
  zlava({
    id: 42,
    name: 'Letné dočistenie skladu — oceľ',
    status: 'queued',
    percent: 25,
    dateFrom: den(-2),
    dateTo: den(12),
    mode: 'eager',
    itemsTotal: 1_180,
    itemsOk: 948,
    itemsFailed: 11,
    itemsUncertain: 3,
    itemsPending: 218,
    createdAt: okamih(-60 * 30),
    tiers: [
      { ord: 1, label: 'Ležiaky nad rok', percent: 30, itemsCount: 412 },
      { ord: 2, label: 'Pomaly sa točiace', percent: 25, itemsCount: 520 },
      { ord: 3, label: 'Zvyšok kolekcie', percent: 15, itemsCount: 248 },
    ],
    estimate: { pending: 218, perDay: 200, days: 2, date: den(2) },
  }),
  zlava({
    id: 41,
    name: 'Náušnice so zirkónmi — týždeň',
    status: 'done',
    percent: 15,
    dateFrom: den(-5),
    dateTo: den(2),
    itemsTotal: 148,
    itemsOk: 148,
    createdAt: okamih(-60 * 24 * 7),
  }),
  zlava({
    id: 40,
    name: 'Prívesky a retiazky — jesenná príprava',
    status: 'scheduled',
    percent: 20,
    dateFrom: den(9),
    dateTo: den(23),
    itemsTotal: 300,
    itemsOk: 0,
    itemsPending: 300,
    createdAt: okamih(-60 * 24 * 2),
    estimate: { pending: 300, perDay: 200, days: 2, date: den(4) },
  }),
  zlava({
    id: 39,
    name: 'Piercingy — krátka akcia',
    status: 'done',
    percent: 10,
    dateFrom: den(-21),
    dateTo: den(-14),
    itemsTotal: 64,
    itemsOk: 62,
    itemsFailed: 2,
    createdAt: okamih(-60 * 24 * 24),
  }),
  zlava({
    id: 38,
    name: 'Prstene — výpredaj veľkostí',
    status: 'done',
    percent: 30,
    dateFrom: den(-45),
    dateTo: den(-31),
    itemsTotal: 96,
    itemsOk: 96,
    createdAt: okamih(-60 * 24 * 50),
  }),
];

/**
 * Vlastné zápisy appky na JEDEN produkt (`/api/insights/product/:id`, I11).
 *
 * Fixtúra tu do 26. 8. chýbala, a keďže `NEZNAME` nikto nečítal, chýbala
 * potichu: bočný panel na Produktoch dostal `404`, vykreslil päť pomlčiek
 * a vetu „Zápisy sa nepodarilo načítať." — a tak to aj odfotil. Panel má pri
 * tom v appke päť riadkov s dátumami a percentami, teda presne tú časť, ktorú
 * sa na snímke posudzuje najviac.
 *
 * Dva zápisy: jeden dobehnutý z minulej zľavy a jeden čakajúci v pripravovanej
 * zľave — aby panel ukázal aj „V pripravovanej zľave", nie iba minulosť.
 */
function zapisyProduktu(productId: number): ProductWritesView {
  return {
    productId,
    today: DNES,
    writes: [
      {
        itemId: 8_412,
        campaignId: 38,
        campaignName: 'Prstene — výpredaj veľkostí',
        status: 'ok',
        percent: 30,
        dateFrom: den(-45),
        dateTo: den(-31),
        at: okamih(-60 * 24 * 45),
      },
      {
        itemId: 9_910,
        campaignId: 40,
        campaignName: 'Prívesky a retiazky — jesenná príprava',
        status: 'pending',
        percent: 20,
        dateFrom: den(9),
        dateTo: den(23),
        at: null,
      },
    ],
  };
}

function polozky(): readonly DiscountItemView[] {
  return KATALOG.slice(0, 24).map((row, i) => {
    const zlyhala = i === 5;
    const neista = i === 11;
    return {
      id: 9_000 + i,
      productId: row.productId,
      position: i + 1,
      status: zlyhala ? 'failed' : neista ? 'uncertain' : i < 18 ? 'ok' : 'pending',
      percent: i < 8 ? 30 : i < 16 ? 25 : 15,
      nameAtWrite: row.name,
      priceAtPreview: row.price,
      priceAtWrite: i < 18 ? row.price : null,
      priceMismatch: i === 3,
      hasAttributes: row.hasAttributes,
      attemptCount: zlyhala ? 3 : 1,
      httpStatus: zlyhala ? 422 : i < 18 ? 200 : null,
      errorCode: zlyhala ? 'shop_rejected' : null,
      errorMessage: zlyhala ? 'Eshop odmietol zmenu ceny pre tento kus.' : null,
      finishedAt: i < 18 ? okamih(-60 * (20 - i)) : null,
    };
  });
}

function historia(pocet: number): readonly AuditRow[] {
  // Kódy sú tie, ktoré appka naozaj pozná (`AUDIT_EVENT_LABELS`). Vymyslený
  // kód by tabuľka preložila na „iná udalosť appky" a snímka by hlásila
  // chudobný slovník, ktorý v skutočnosti bohatý je.
  const typy = [
    'campaign_created',
    'write_ok',
    'write_failed',
    'key_stored',
    'catalog_refreshed',
    'write_uncertain',
    'scope_mode_changed',
    'campaign_confirmed',
  ] as const;

  return Array.from({ length: pocet }, (_, i): AuditRow => {
    const typ = typy[i % typy.length]!;
    const zle = typ === 'write_failed';
    return {
      id: 5_400 - i,
      ts: okamih(-i * 37),
      actor: i % 3 === 0 ? 'user' : 'scheduler',
      userId: i % 3 === 0 ? 1 : null,
      eventType: typ,
      ok: zle ? false : true,
      campaignId: 42,
      campaignItemId: 9_000 + i,
      productId: KATALOG[i % KATALOG.length]!.productId,
      operationId: `op-${5_400 - i}`,
      requestId: `req-${5_400 - i}`,
      httpStatus: zle ? 422 : 200,
      message: zle ? 'Eshop odmietol zmenu ceny pre tento kus.' : null,
    };
  });
}

const HISTORIA = historia(40);

const VYKON: PerformanceView = {
  available: true,
  started: true,
  startsOn: null,
  unit: 'ks',
  spanDays: 14,
  recent: { from: den(-14), to: DNES, units: 214 },
  prior: { from: den(-28), to: den(-14), units: 168 },
  coverage: { from: den(-92), to: DNES, syncEnabled: true },
  locked: {
    revenue: 'Tržby v eurách appka nečíta — kľúč na objednávky ich neposkytuje.',
    lastYear: 'Porovnanie s vlaňajškom appka nemá — história siaha 92 dní dozadu.',
  },
};

/* ═══════════════════════════ 6. Predaj ════════════════════════════════════ */

const DNI_PREDAJA = Array.from({ length: 13 }, (_, i) => {
  const posun = -12 + i;
  const zaklad = 9 + Math.round(4 * Math.sin(i / 2));
  return { day: den(posun), units: posun === 0 ? 4 : zaklad, status: 'complete' };
});

const PREDAJ = {
  today: DNES,
  coverage: {
    syncEnabled: true,
    from: den(-92),
    to: DNES,
    daysCovered: 92,
    lastSyncedAt: okamih(-60 * 6),
    hasData: true,
  },
  products: KATALOG.slice(0, 40).map((row) => {
    // Fixtúra má predaj vždy zmeraný; `null` („nevieme", D121) sa do snímok
    // nekreslí, preto sa tu zrovná na nulu VEDOME a len tu.
    const units = row.unitsSold ?? 0;
    return {
      productId: row.productId,
      unitsSold: units,
      unitsPerDay: Number((units / 30).toFixed(2)),
      recentUnits: Math.round(units * 0.6),
      previousUnits: Math.round(units * 0.4),
    };
  }),
  days: DNI_PREDAJA,
};

const NAVRHY = {
  findings: [
    {
      id: 'lezaky',
      tone: 'attention',
      text: '132 kusov sa za tridsať dní nepredalo ani raz.',
      href: '/produkty',
      action: { label: 'Pozrieť ležiaky', href: '/produkty' },
    },
    {
      id: 'konciaca',
      tone: 'info',
      text: 'Zľava „Náušnice so zirkónmi" končí o dva dni.',
      href: '/zlavy/41',
      action: { label: 'Otvoriť zľavu', href: '/zlavy/41' },
    },
    {
      id: 'rozpocet',
      tone: 'info',
      text: 'Z dnešného rozpočtu ostáva 72 zápisov.',
      href: '/nastavenia/co-smie',
      action: null,
    },
  ],
};

/* ═══════════════════════════ 7. Router ════════════════════════════════════ */

/** Obálka, akú vracajú všetky čítacie endpointy appky. */
function ok(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Cesty, na ktoré snímkovač odpoveď nemá.
 *
 * Hlavička tu sľubovala, že sa „vypíšu do konzoly prehliadača" — nevypisovali.
 * Zoznam nikto nečítal (`NEZNAME` sa v celom repe nikde inde nevyskytuje),
 * takže chýbajúca fixtúra bola TICHÁ: obrazovka dostala `404 no_fixture`,
 * vykreslila prázdny stav a snímka vyzerala ako pravda o appke. Zápis preto
 * ide aj do `console.error`, ktorý snímkovač už zbiera a vypisuje pod
 * „ČO VYZERÁ ROZBITO".
 */
export const NEZNAME: string[] = [];

/** Kedy naposledy odišla požiadavka na appku (ms). Snímkovač podľa toho čaká. */
let poslednaOtazka = Date.now();

/** Čas poslednej požiadavky — dovtedy sa nefotí, obrazovka sa ešte skladá. */
export function poslednyDotaz(): number {
  return poslednaOtazka;
}

function odpoved(url: URL, method: string): Response | null {
  const cesta = url.pathname;

  if (cesta === '/api/status') return ok(STAV);
  if (cesta === '/api/settings') return ok(NASTAVENIA);
  if (cesta === '/api/queue') return ok(FRONTA);
  if (cesta === '/api/key') {
    return ok(url.searchParams.get('kind') === 'orders_read' ? KLUC_OBJEDNAVKY : KLUC);
  }
  if (cesta === '/api/catalog/sync') return ok({ catalog: KATALOG_STAV });
  if (cesta === '/api/catalog/search') return ok(katalogStranka(url));
  if (cesta === '/api/catalog/details' || cesta === '/api/catalog/extras') {
    return ok({
      rows: [],
      notFilled: [],
      capability: { state: 'locked' },
      readsUsed: 0,
      at: okamih(0),
      error: null,
    });
  }
  if (cesta === '/api/catalog/prices') {
    return ok({
      bins: [
        { from: 0, to: 10, count: 8_420 },
        { from: 10, to: 20, count: 12_180 },
        { from: 20, to: 40, count: 11_940 },
        { from: 40, to: 80, count: 6_310 },
        { from: 80, to: null, count: 2_370 },
      ],
      rows: KATALOG_SPOLU,
      withoutPrice: 0,
      minPrice: 1.5,
      maxPrice: 189,
      oldestFetchedAt: okamih(-60 * 48),
      newestFetchedAt: okamih(-60 * 9),
    });
  }
  if (cesta === '/api/campaigns') return ok({ data: ZLAVY, total: ZLAVY.length, budget: FRONTA.budget });
  if (cesta === '/api/sales') return ok(PREDAJ);
  // Hlavička o pokrytí patrí do odpovede rovnako ako rad po dňoch: číta ju
  // veta o pokrytí na Produktoch aj v sprievodcovi. Je to tá istá hodnota, akú
  // vracia `/api/sales` — dva endpointy nad jedným meraním si nesmú
  // protirečiť ani vo fixtúrach.
  if (cesta === '/api/insights/sales-daily') {
    return ok({ today: DNES, coverage: PREDAJ.coverage, days: DNI_PREDAJA });
  }
  if (cesta === '/api/ai/insights') return ok(NAVRHY);
  if (cesta === '/api/audit') {
    return ok({ data: [...HISTORIA], page: 1, perPage: 40, total: 512 } satisfies AuditPage);
  }

  const detail = /^\/api\/campaigns\/(\d+)$/.exec(cesta);
  if (detail !== null) {
    const id = Number(detail[1]);
    const kampan = ZLAVY.find((r) => r.id === id) ?? ZLAVY[0]!;
    return ok({
      campaign: kampan,
      tiers: kampan.tiers,
      estimate: kampan.estimate,
      items: polozky(),
      itemsTotal: kampan.itemsTotal,
      auditTrail: HISTORIA.slice(0, 8).map((r) => ({
        id: r.id,
        ts: r.ts,
        actor: r.actor,
        eventType: r.eventType,
        ok: r.ok,
        productId: r.productId,
        httpStatus: r.httpStatus,
        message: r.message,
      })),
    } satisfies DiscountDetailData);
  }

  const zopakovanie = /^\/api\/campaigns\/(\d+)\/retry-failed$/.exec(cesta);
  if (zopakovanie !== null && method === 'GET') {
    const id = Number(zopakovanie[1]);
    const kampan = ZLAVY.find((r) => r.id === id) ?? ZLAVY[0]!;
    return ok({
      campaignId: kampan.id,
      name: kampan.name,
      percent: kampan.percent,
      possible: true,
      blockedBy: null,
      what: 'Zopakovať sa dá 11 kusov, ktoré eshop odmietol.',
      nextStep: 'Skúška naprázdno ukáže ceny; zaradenie si vypýta potvrdenie.',
      productIds: KATALOG.slice(0, 11).map((r) => r.productId),
      items: {
        total: kampan.itemsTotal,
        retryable: 11,
        notWritten: 11,
        uncertain: 3,
        pending: kampan.itemsPending,
        ok: kampan.itemsOk,
        skipped: 0,
      },
      window: { from: kampan.dateFrom, to: kampan.dateTo, today: DNES },
    } satisfies RetryPlanView);
  }

  const zapisy = /^\/api\/insights\/product\/(\d+)$/.exec(cesta);
  if (zapisy !== null) return ok(zapisyProduktu(Number(zapisy[1])));

  if (/^\/api\/insights\/campaign\/\d+\/performance$/.test(cesta)) return ok(VYKON);
  if (/^\/api\/insights\/campaign\/\d+\/items$/.test(cesta)) return ok({ data: [], total: 0 });

  // Zápisové cesty snímkovač neobsluhuje — na snímkach sa nič neodosiela.
  if (method !== 'GET') return ok({});

  return null;
}

/**
 * Nasadí náhradný `fetch`. Všetko mimo `/api/` prepadne na pôvodný — snímky
 * si tak vedia dotiahnuť vlastné súbory, ale von zo stroja nejde nič.
 */
export function nasadFetch(): void {
  const povodny = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (vstup: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw =
      typeof vstup === 'string' ? vstup : vstup instanceof URL ? vstup.href : vstup.url;
    const url = new URL(raw, 'http://snimky.local');
    if (!url.pathname.startsWith('/api/')) return povodny(vstup, init);

    poslednaOtazka = Date.now();
    const res = odpoved(url, init?.method ?? 'GET');
    if (res !== null) return res;

    const chybajuca = `${init?.method ?? 'GET'} ${url.pathname}`;
    NEZNAME.push(chybajuca);
    console.error(`chýba fixtúra: ${chybajuca} — obrazovka dostala 404 a kreslí prázdny stav`);
    return new Response(JSON.stringify({ ok: false, error: { code: 'no_fixture', message: '' } }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}
