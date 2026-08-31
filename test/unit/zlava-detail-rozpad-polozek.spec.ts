/**
 * Aura Zľavy — ROZPAD POLOŽIEK ZĽAVY: SKUTOČNÉ ZAPOJENIE (nález U6, 31. 8. 2026).
 *
 * @vitest-environment jsdom
 *
 * ČO SA TU DOKAZUJE A PREČO TO NEJDE INAK
 * ───────────────────────────────────────
 * `GET /api/insights/campaign/[id]/items` existoval od 24. 8. 2026, mal svoje
 * testy (`neznamy-stav-polozky.spec.ts`) a **nula konzumentov**. Testy nad
 * route-om teda dokazovali, že odpoveď je pravdivá — nie že sa niekomu dostane
 * pred oči. Presne tá trieda pasce, ktorú CLAUDE.md pomenúva: kód prejde
 * testami a v produkcii sa nezavolá nikdy.
 *
 * Detail zľavy si čísla ťahá v efekte, takže `renderToStaticMarkup` ho zastihne
 * v stave „Načítavam zľavu…" a o dotaze nedokáže nič. Tento súbor má preto
 * vlastné prostredie a obrazovku naozaj vykreslí — rovnaký dôvod aj rovnaký
 * postup ako `produkty-kpi-zapojenie.spec.ts`.
 *
 * Tvrdenia:
 *
 *  1. obrazovka na endpoint naozaj SIAHNE (a práve raz za načítanie),
 *  2. dlaždica „Čaká na zápis" ukáže MERANÝ počet, nie odčítanie zo súhrnu —
 *     preto vzorka posiela `itemsPending: 7` a rozpad `pending: 3`; keby sa
 *     dlaždica vrátila k odčítaniu, tvrdenie padne,
 *  3. stavy bez dlaždice (preskočené, nenájdené, prerušené) sú NA POVRCHU
 *     s počtami — do dnešného dňa neboli na obrazovke nikde,
 *  4. nulový stav sa nevypisuje (P2), takže riadok hovorí o tom, čo sa stalo,
 *  5. položka v stave mimo číselníka je priznaná POČTOM a jej surový kód sa na
 *     obrazovku nedostane (K10),
 *  6. keď rozpad zlyhá, dlaždica má POMLČKU a sekcia to povie vetou — nikdy
 *     nula a nikdy odčítané číslo (P7, I11),
 *  7. na render ceste nepadne ani jedno volanie mimo lokálnych `/api/*` (K8).
 *
 * Vlastník: úloha MRTVE-ENDPOINTY, 31. 8. 2026.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscountDetail } from '@/components/campaigns/DiscountDetail';
import { parseItemBreakdown } from '@/components/campaigns/zlavy-api';

/* ═══════════════════════════ 1. Vzorka ════════════════════════════════════ */

const ID = 7;

/**
 * Súhrn zľavy tak, ako ho posiela `/api/campaigns/[id]`. `itemsPending: 7` je
 * ODČÍTANIE servera (`20 − 12 − 1 − 0`) — do dnešného dňa to bolo číslo
 * v dlaždici „Čaká na zápis", hoci naozaj čakajú tri položky.
 */
const detailPayload = () => ({
  ok: true,
  data: {
    campaign: {
      id: ID,
      name: 'Letné dočistenie skladu',
      status: 'running',
      statusReason: null,
      percent: 20,
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
      mode: 'eager',
      itemsTotal: 20,
      itemsOk: 12,
      itemsFailed: 1,
      itemsUncertain: 0,
      itemsPending: 7,
      late: false,
      createdAt: '2026-08-01T08:00:00.000Z',
      tiers: [],
      estimate: null,
    },
    tiers: [],
    estimate: null,
    items: [],
    itemsTotal: 20,
    itemsOffset: 0,
    auditTrail: [],
  },
});

/** Rozpad so štyrmi stavmi mimo dlaždíc; `blocked` je nula a vypísať sa NESMIE. */
const breakdownPayload = () => ({
  ok: true,
  data: {
    campaignId: ID,
    total: 20,
    tally: {
      pending: 3,
      skipped: 2,
      ok: 12,
      failed: 1,
      uncertain: 0,
      interrupted: 1,
      not_found: 1,
      blocked: 0,
    },
    unrecognized: 0,
  },
});

/** Ten istý súhrn, ale štyri položky sú v stave, ktorý appka nepozná. */
const breakdownWithUnknown = () => ({
  ok: true,
  data: {
    campaignId: ID,
    total: 20,
    tally: {
      pending: 3,
      skipped: 0,
      ok: 12,
      failed: 1,
      uncertain: 0,
      interrupted: 0,
      not_found: 0,
      blocked: 0,
    },
    unrecognized: 4,
  },
});

/* ═══════════════════════════ 2. Prostredie ════════════════════════════════ */

let container: HTMLElement;
let root: Root;
let calls: string[];
const povodnyFetch = globalThis.fetch;

/** Čo odpovie `/api/insights/campaign/7/items` — nastavuje si každý test sám. */
let itemsBody: unknown = null;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  calls = [];
  itemsBody = breakdownPayload();

  const json = (body: unknown): Response =>
    ({ json: () => Promise.resolve(body) }) as unknown as Response;

  globalThis.fetch = vi.fn((input: unknown) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith(`/api/campaigns/${ID}?`)) return Promise.resolve(json(detailPayload()));
    if (url === `/api/insights/campaign/${ID}/items`) return Promise.resolve(json(itemsBody));
    /*
     * Stav fronty, výkon výberu a panel opakovania tento test nemeria — ale
     * ODPOVEDAŤ musia. `fetchQueue()` je v tom istom `Promise.all` ako detail,
     * takže prísľub, ktorý nedobehne, by celú obrazovku nechal v stave
     * „Načítavam zľavu…" a tvrdenia nižšie by nemali čo merať. Chybová obálka
     * je tu presnejšia než vymyslené telo: obrazovka na ňu má vlastné
     * „nepodarilo sa prečítať" a nič si nedomýšľa.
     */
    return Promise.resolve(json({ ok: false, error: { code: 'nemerane', message: 'Nemerané.' } }));
  }) as unknown as typeof globalThis.fetch;

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.fetch = povodnyFetch;
  vi.restoreAllMocks();
});

/** Vykreslí detail a nechá dobehnúť efekty aj prísľuby. */
async function otvor(): Promise<void> {
  await act(async () => {
    root.render(createElement(DiscountDetail, { id: ID }));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

/** Text jedného útvaru s rozpustenými medzerami — to, čo človek prečíta. */
function textOf(testId: string): string {
  const node = container.querySelector(`[data-testid="${testId}"]`);
  expect(node, `útvar ${testId} sa nevykreslil`).not.toBeNull();
  return (node!.textContent ?? '').replace(/\s+/g, ' ').trim();
}

const itemsCalls = (): string[] =>
  calls.filter((url) => url === `/api/insights/campaign/${ID}/items`);

/* ═══════════════ 3. Obrazovka ten endpoint naozaj číta ════════════════════ */

describe('detail zľavy siaha na rozpad položiek po stavoch', () => {
  it('načítanie obrazovky vyvolá PRÁVE JEDEN dotaz na rozpad', async () => {
    await otvor();
    expect(itemsCalls().length).toBe(1);
  });

  it('na render ceste nepadne nič mimo lokálnych `/api/*` (K8)', async () => {
    await otvor();
    expect(calls.length).toBeGreaterThan(0);
    for (const url of calls) expect(url.startsWith('/api/'), url).toBe(true);
  });
});

/* ══════════ 4. „Čaká na zápis" je meraný počet, nie odčítanie ═════════════ */

describe('dlaždica „Čaká na zápis" berie MERANÝ počet (U6)', () => {
  it('ukáže 3 z rozpadu, nie 7 z odčítania v súhrne', async () => {
    await otvor();
    const tile = textOf('tile-pending');
    expect(tile).toContain('Čaká na zápis');
    expect(tile).toContain('3');
    // 7 = `items_total − ok − failed − uncertain`. Keby sa dlaždica vrátila
    // k odčítaniu, štyri dopadnuté položky by znova „čakali".
    expect(tile).not.toContain('7');
  });

  it('dominanta nepovie „vybavenú", kým čaká čo i len jedna položka', async () => {
    await otvor();
    expect(textOf('detail-progress')).not.toContain('fronta má túto zľavu vybavenú');
  });
});

/* ═════════════ 5. Stavy bez dlaždice sú na povrchu s počtami ══════════════ */

describe('osem stavov sa už nezlieva do štyroch kolónok', () => {
  it('preskočené, nenájdené a prerušené majú na obrazovke svoj počet', async () => {
    await otvor();
    const line = textOf('detail-items-other');
    expect(line).toContain('preskočené 2');
    expect(line).toContain('shop produkt nenašiel 1');
    expect(line).toContain('prerušené 1');
  });

  it('stav na nule sa nevypisuje — riadok hovorí o tom, čo sa stalo (P2)', async () => {
    await otvor();
    expect(textOf('detail-items-other')).not.toContain('appka zápis nepustila');
  });

  it('riadok NEOPAKUJE stavy, ktoré už majú dlaždicu (D15)', async () => {
    await otvor();
    const line = textOf('detail-items-other');
    // Slová dlaždíc `ok`, `pending`, `failed` a `uncertain` zo slovníka
    // `ITEM_SENTENCES`. Keby zoznam prestal vylučovať otabuľkované stavy,
    // sekcia Položky by bola štvorica dlaždíc napísaná ešte raz, slovami.
    for (const slovo of ['zlacnené', 'ešte sa nezapisovalo', 'nevieme, či sa zapísalo']) {
      expect(line.includes(slovo), `riadok opakuje dlaždicu: ${slovo}`).toBe(false);
    }
  });

  it('surový kód stavu sa na obrazovku nedostane (K10)', async () => {
    await otvor();
    /*
      * Meria sa TEXT, nie markup: `data-state='uncertain'` na pruhu a na
      * dlaždici je hák pre CSS, nie slovo pre človeka. Kód stavu sa nesmie
      * dostať do toho, čo sa dá prečítať.
      */
    const citatelne = (container.textContent ?? '').replace(/\s+/g, ' ');
    for (const kod of ['not_found', 'interrupted', 'skipped', 'uncertain', 'pending']) {
      expect(citatelne.includes(kod), `kód ${kod} presvitá na povrch`).toBe(false);
    }
  });

  it('bez neznámych stavov sa o nich nepíše ani veta', async () => {
    await otvor();
    expect(container.querySelector('[data-testid="detail-items-unknown"]')).toBeNull();
  });
});

/* ══════════════ 6. Neznámy stav je priznaný počtom ═══════════════════════ */

describe('položka v stave mimo číselníka sa priznáva', () => {
  it('počet je na povrchu a hovorí, že appka nevie, čo sa s nimi stalo', async () => {
    itemsBody = breakdownWithUnknown();
    await otvor();
    const line = textOf('detail-items-unknown');
    expect(line).toContain('4');
    expect(line).toContain('nepozná');
  });
});

/* ══════════════ 7. Keď sa rozpad prečítať nedá: pomlčka ═══════════════════ */

describe('nečitateľný rozpad je pomlčka a veta, nikdy nula (P7, I11)', () => {
  beforeEach(() => {
    itemsBody = { ok: false, error: { code: 'db_down', message: 'Nedostupné.' } };
  });

  it('dlaždica má pomlčku — ani nulu, ani odčítané číslo', async () => {
    await otvor();
    const tile = textOf('tile-pending');
    expect(tile).toContain('—');
    expect(tile).not.toContain('7');
    expect(tile).not.toContain('3');
    expect(tile).not.toContain('0');
  });

  it('sekcia Položky to POVIE, nemlčí o tom', async () => {
    await otvor();
    expect(textOf('detail-items-breakdown')).toContain('sa nepodarilo prečítať');
  });

  it('dlaždica pri neznámom počte nefarbí — pomlčka nie je poplach', async () => {
    await otvor();
    // Selektor si vyžaduje `data-any` — `data-state='pending'` nesie aj úsek
    // pruhu nad dlaždicami a ten o farbe dlaždice nehovorí nič.
    const tile = container.querySelector('[data-state="pending"][data-any]');
    expect(tile?.getAttribute('data-any')).toBe('nie');
  });
});

/* ══════════════ 8. Parser: rozpad sa berie celý, alebo vôbec ══════════════ */

describe('parseItemBreakdown neprepustí rozpad, ktorý nesedí', () => {
  const telo = (over: Record<string, unknown> = {}) => ({
    campaignId: ID,
    total: 6,
    tally: {
      pending: 1,
      skipped: 0,
      ok: 3,
      failed: 2,
      uncertain: 0,
      interrupted: 0,
      not_found: 0,
      blocked: 0,
    },
    unrecognized: 0,
    ...over,
  });

  it('sedí → prejde a počty sa preberú tak, ako prišli', () => {
    const view = parseItemBreakdown(telo());
    expect(view).not.toBeNull();
    expect(view?.total).toBe(6);
    expect(view?.tally['pending']).toBe(1);
    expect(view?.unrecognized).toBe(0);
  });

  it('súčet, ktorý nesedí s `total`, je horší než chýbajúci → `null`', () => {
    expect(parseItemBreakdown(telo({ total: 9 }))).toBeNull();
  });

  it('nečitateľný počet nie je nula → celý rozpad je `null`', () => {
    const zle = telo();
    (zle.tally as Record<string, unknown>)['skipped'] = 'dva';
    expect(parseItemBreakdown(zle)).toBeNull();
  });

  it('bez kľúča `pending` sa dlaždica nemá z čoho kresliť → `null`', () => {
    const zle = telo();
    delete (zle.tally as Record<string, unknown>)['pending'];
    expect(parseItemBreakdown(zle)).toBeNull();
  });

  it('chýbajúci `unrecognized` je „nevieme", nie nula → `null`', () => {
    const zle = telo();
    delete (zle as Record<string, unknown>)['unrecognized'];
    expect(parseItemBreakdown(zle)).toBeNull();
  });

  it('deviaty stav z budúcej migrácie sa NESTRATÍ — príde ako ďalší kľúč', () => {
    const view = parseItemBreakdown(
      telo({
        total: 8,
        tally: { ...telo().tally, writing: 2 },
      }),
    );
    expect(view?.tally['writing']).toBe(2);
  });
});
