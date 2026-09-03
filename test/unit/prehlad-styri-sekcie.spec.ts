/**
 * @vitest-environment jsdom
 *
 * Aura Zľavy — PREHĽAD MÁ ŠTYRI SEKCIE A STAV ODIŠIEL NA NASTAVENIA
 * (V7, D152, D166, kritérium K2; 3. 9. 2026).
 *
 * PREČO TENTO SÚBOR EXISTUJE
 * ──────────────────────────
 * Samuel označil „priveľa vecí na obrazovke" ako jednu zo štyroch príčin,
 * pre ktoré je V6 nečitateľná. D152 z toho urobil počet: **štyri sekcie**
 * (KPI riadok · graf · tabuľka · bežiace zľavy) a stavový pás s prekážkami
 * odchádza na Nastavenia.
 *
 * Počet sekcií je presne ten druh vlastnosti, ktorý sa stratí bez merania:
 * každá jedna sekcia má vlastné zelené testy, takže PIATA sekcia nezhodí ani
 * jedno tvrdenie v repe. Rovnako sa nedá grepom dokázať, že pás naozaj odišiel
 * — `Overview.tsx` ho stačí prestať importovať a vykresliť ho odinakiaľ.
 *
 * ČO SA MERIA
 * ───────────
 *  A. **Vykreslené poradie koreňa obrazovky.** Nie počet `<section>`, ale
 *     ZOZNAM detí koreňa v poradí: hlavička · tichý riadok · prepínač okna ·
 *     KPI rad · graf · tabuľka · zľavy. Piata sekcia, prehodené poradie aj
 *     zmiznutá sekcia padnú tu.
 *  B. **Pás, sekcia „Stav" ani prekážky na Prehľade NIE SÚ.**
 *  C. **Tichý odkaz** — jeden riadok, len keď niečo horí, tri kanály v jednom
 *     uzle a PRESNE JEDEN odkaz.
 *  D. **Odkaz niekam vedie.** Routa existuje (`test/helpers/routy.ts`) A kotva
 *     `#stav` sa naozaj vykreslí. Je to zapísaná pasca z 27. 8. 2026: routa
 *     `/nastavenia` existovala, sekcia `#odhlasenie` nie, a rozcestník mesiac
 *     ponúkal odkaz do prázdna. Rovnako sa preveria VŠETKY odkazy Prehľadu.
 *  E. **Obsah sa presunom nezahodil.** Sekcia Nastavení kreslí pás AJ prekážky
 *     a prekážky NIE SÚ pod rozklikom — to je bod 1 hlavičky `StatusBand` a je
 *     to jediná vec, ktorá z presunu môže spraviť schovanie.
 *
 * ČO TENTO SÚBOR NEMERIA
 * ──────────────────────
 * Vnútro sekcií. KPI rad má `prehlad-kpi-zapojenie`, graf
 * `prehlad-graf-tri-krivky`, tabuľku `prehlad-tabulka`, zľavy `prehlad`.
 * Tu sa meria ROZVRH — teda to, čo žiadny z nich nevidí.
 *
 * Odpovede servera sú v §A a §B zámerne CHYBOVÉ: appka je bez `shop_write`
 * kľúča a jej IP je zabanovaná, takže prázdny stav je BEŽNÝ stav (R4) a rozvrh
 * musí platiť práve v ňom. §E jednu odpoveď (`/api/status`) dá — bez prekážky
 * by sa nedalo zmerať, že prekážky nie sú pod rozklikom.
 *
 * Vlastník: V7, krok 4/4 (rozvrh štyroch sekcií a presun stavu).
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Overview, {
  OVERVIEW_TROUBLE_LINK,
  OVERVIEW_TROUBLE_PATH,
  TroubleLine,
} from '@/components/dashboard/Overview';
import AppStateSection from '@/components/settings/AppStateSection';
import type { Verdict } from '@/components/dashboard/overview-verdict';
import { odkazyZMarkupu, routaExistuje } from '../helpers/routy';

/* ═══════════════════════════ 1. Prostredie ═══════════════════════════════ */

/**
 * Odpoveď stavu s JEDNOU zastavujúcou prekážkou. Surový tvar, aký posiela
 * `GET /api/status` — nie hotový `StatusView`: keby sa test o parser oprel,
 * merala by sa cesta, ktorú appka v prehliadači nepoužíva.
 */
const STATUS_S_PREKAZKOU = {
  ok: true,
  data: {
    writes: { enabled: true, locked: false },
    apiKey: { present: false, expiresAt: null },
    writeBudget: { budget: 1000, spent: 0 },
    scope: { mode: 'pilot', maxProducts: 10, failClosed: false },
    catalog: { loadedProducts: 2900, shopTotalProducts: 41_348 },
    blockers: [
      {
        id: 'key_missing',
        severity: 'blokuje',
        resolution: 'sam',
        what: 'Kľúč na zápis do shopu nie je vložený.',
        nextStep: 'Vložte kľúč v Nastaveniach.',
        path: '/nastavenia',
        assumed: false,
      },
    ],
    summary: { blocked: true },
    unreadable: [],
  },
};

let container: HTMLElement;
let root: Root;
const povodnyFetch = globalThis.fetch;

/** Adresy, ktoré majú odpovedať platne. Všetko ostatné je chyba (R4). */
let odpovede: Record<string, unknown> = {};

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  odpovede = {};

  globalThis.fetch = vi.fn((input: unknown) => {
    const url = String(input);
    const hit = Object.keys(odpovede).find((prefix) => url.startsWith(prefix));
    const body =
      hit === undefined
        ? { ok: false, error: { code: 'db_down', message: 'Nedostupné.' } }
        : odpovede[hit];
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as unknown as Response);
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

/** Vykreslí komponent a nechá dobehnúť efekty aj prísľuby načítaní. */
async function otvor(component: Parameters<typeof createElement>[0]): Promise<void> {
  await act(async () => {
    root.render(createElement(component));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const strom = (): Element | null => container.querySelector('[data-testid="overview"]');
const je = (testId: string): Element | null =>
  container.querySelector(`[data-testid="${testId}"]`);

/* ═════════════════ A. Rozvrh: štyri sekcie v poradí D152 ═════════════════ */

describe('A — Prehľad má ŠTYRI sekcie a stoja v poradí D152', () => {
  /**
   * Poradie sa neopisuje slovami, ale zoznamom: hlavička, tichý riadok,
   * prepínač okna a potom ŠTYRI sekcie. Kto pridá piatu, prepíše tento zoznam
   * a musí pri tom povedať, ktorá zo štyroch odchádza (D152).
   */
  const PORADIE = [
    'overview-header',
    'overview-trouble',
    'overview-sold-window',
    'overview-kpi',
    'discount-split',
    'overview-products',
    'overview-campaigns',
  ];

  it('meranie má nad čím bežať — obrazovka sa vykreslila', async () => {
    await otvor(Overview);
    expect(strom()).not.toBeNull();
    expect((strom()?.children.length ?? 0) > 0).toBe(true);
  });

  it('deti koreňa sú presne tie a v tomto poradí', async () => {
    await otvor(Overview);
    const deti = [...(strom()?.children ?? [])].map((el) => el.getAttribute('data-testid'));
    expect(deti).toEqual(PORADIE);
  });

  it('sekcie sú ŠTYRI — hlavička, riadok ani prepínač sekcia nie sú', async () => {
    await otvor(Overview);
    const deti = [...(strom()?.children ?? [])].map((el) => el.getAttribute('data-testid'));
    const sekcie = deti.filter(
      (id) => id !== null && !['overview-header', 'overview-trouble', 'overview-sold-window'].includes(id),
    );
    expect(sekcie).toHaveLength(4);
  });
});

/* ═══════════ B. Pás, sekcia „Stav" a prekážky tu už nie sú ═══════════════ */

describe('B — stavový pás a prekážky na Prehľade NIE SÚ (D152)', () => {
  it('ani pás, ani sekcia „Stav", ani prekážky', async () => {
    await otvor(Overview);
    expect(je('overview-status-band')).toBeNull();
    expect(je('overview-status')).toBeNull();
    expect(je('overview-blockers')).toBeNull();
  });

  it('a nekreslia sa ani pri prekážke zo servera — presun nie je podmienený', async () => {
    odpovede = { '/api/status': STATUS_S_PREKAZKOU };
    await otvor(Overview);
    expect(je('overview-blockers')).toBeNull();
    expect(je('overview-status-band')).toBeNull();
  });
});

/* ═══════════════════ C. Jeden tichý odkaz, keď niečo horí ════════════════ */

describe('C — tichý riadok verdiktu', () => {
  const verdict = (patch: Partial<Verdict> = {}): Verdict => ({
    kind: 'stopped',
    tone: 'warn',
    word: 'zápis stojí',
    headline: 'Zápis stojí',
    detail: '1 prekážka zastavuje zápis.',
    ...patch,
  });

  it('keď je zeleno, riadok sa nekreslí VÔBEC', () => {
    const html = renderToStaticMarkup(
      createElement(TroubleLine, {
        verdict: verdict({ kind: 'ok', tone: 'ok', word: 'v poriadku' }),
      }),
    );
    expect(html).toBe('');
  });

  it('inak nesie farbu, ZNAČKU aj slovo v jednom uzle a jednu vetu detailu', () => {
    const html = renderToStaticMarkup(createElement(TroubleLine, { verdict: verdict() }));
    const uzol = /<span class="sig warn"[^>]*>(.*?)<\/span>/s.exec(html);
    expect(uzol, 'uzol verdiktu sa nevykreslil').not.toBeNull();
    expect(uzol?.[1]).toContain('<svg');
    expect(uzol?.[1]).toContain('zápis stojí');
    expect(html).toContain('1 prekážka zastavuje zápis.');
  });

  it('a PRESNE JEDEN odkaz — tichý riadok nie je rozcestník', () => {
    const html = renderToStaticMarkup(createElement(TroubleLine, { verdict: verdict() }));
    expect(html.match(/<a /g) ?? []).toHaveLength(1);
    expect(html).toContain(`href="${OVERVIEW_TROUBLE_PATH}"`);
    expect(html).toContain(OVERVIEW_TROUBLE_LINK);
  });

  it('bez kľúča (R4) je riadok na obrazovke, lebo verdikt nie je zelený', async () => {
    await otvor(Overview);
    expect(je('overview-trouble')).not.toBeNull();
    expect(je('trouble-verdict')?.querySelector('svg')).not.toBeNull();
  });
});

/* ══════════════ D. Odkaz vedie na routu, ktorá kotvu naozaj má ═══════════ */

describe('D — ani jeden odkaz Prehľadu nevedie do prázdna', () => {
  it('cesta tichého odkazu je routa, ktorú appka obsluhuje', () => {
    expect(OVERVIEW_TROUBLE_PATH).toContain('#stav');
    expect(routaExistuje(OVERVIEW_TROUBLE_PATH)).toBe(true);
  });

  it('a kotva `#stav` sa na cieľovej stránke naozaj vykreslí', () => {
    /*
     * Druhá polovica pasce z 27. 8. 2026: routa existovala, sekcia nie.
     * Sekcia si dáta ťahá sama, takže tu kreslí kostru — a kotva MUSÍ byť aj
     * v nej, inak by odkaz do prvej odpovede skončil v prázdne.
     */
    const html = renderToStaticMarkup(createElement(AppStateSection));
    expect(html).toContain('id="stav"');
  });

  it('každý odkaz na vykreslenom Prehľade vedie na existujúcu routu', async () => {
    await otvor(Overview);
    const odkazy = odkazyZMarkupu(container.innerHTML);
    // Poistka proti prázdnemu cyklu: aspoň tichý odkaz a odkaz sekcie zliav.
    expect(odkazy.length).toBeGreaterThanOrEqual(2);
    for (const href of odkazy) {
      expect(routaExistuje(href), `odkaz ${href} vedie do prázdna`).toBe(true);
    }
  });
});

/* ══════════ E. Obsah sa presunom nezahodil ani neschoval ═════════════════ */

describe('E — Nastavenia kreslia pás AJ prekážky, a prekážky nie sú pod rozklikom', () => {
  it('sekcia stavu nesie pás aj prekážky', async () => {
    odpovede = { '/api/status': STATUS_S_PREKAZKOU };
    await otvor(AppStateSection);
    expect(je('app-state-section')).not.toBeNull();
    expect(je('overview-status-band')).not.toBeNull();
    expect(je('overview-blockers')).not.toBeNull();
    expect(je('overview-blockers')?.textContent).toContain('Kľúč na zápis do shopu nie je vložený.');
  });

  it('prekážky NIE SÚ vnútri rozkliku (bod 1 hlavičky `StatusBand`)', async () => {
    odpovede = { '/api/status': STATUS_S_PREKAZKOU };
    await otvor(AppStateSection);
    const pas = je('overview-status-band');
    const prekazky = je('overview-blockers');
    expect(pas?.tagName).toBe('DETAILS');
    expect(prekazky).not.toBeNull();
    expect(pas?.contains(prekazky as Node)).toBe(false);
  });

  it('a pás sa pri nezelenom verdikte otvorí sám', async () => {
    odpovede = { '/api/status': STATUS_S_PREKAZKOU };
    await otvor(AppStateSection);
    expect((je('overview-status-band') as HTMLDetailsElement | null)?.open).toBe(true);
  });

  /*
   * „Nežiadali sme" a „nevieme" sú dve rôzne vety. Meria sa to na SERVEROVOM
   * renderi, kde efekty nebežia: v prehliadači prvá odpoveď dobehne v tom
   * istom kole a kostra sa nedá zachytiť inak než zdržaním, ktoré by test
   * merať nemal.
   */
  it('kým prvá odpoveď nedobehla, kreslí sa kostra — nie pás so pomlčkami', () => {
    const html = renderToStaticMarkup(createElement(AppStateSection));
    expect(html).toContain('data-story="nacitava"');
    expect(html).not.toContain('overview-status-band');
    expect(html).not.toContain('—');
  });
});
