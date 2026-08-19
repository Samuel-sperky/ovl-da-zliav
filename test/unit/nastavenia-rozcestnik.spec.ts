/**
 * Aura Zľavy — NASTAVENIA AKO ROZCESTNÍK (kontrakt UI 13. 8. 2026, body 13–15).
 *
 * Rozdelenie jednej dlhej stránky na štyri podstránky má dve tiché úmrtia,
 * a obe tento súbor stráži:
 *
 *  A. **Odkaz do prázdna.** Po appke vedie na `/nastavenia#rozsah` a jemu
 *     podobné niekoľko odkazov — z prekážok, z pravidiel AI aj zo zoznamu
 *     funkcií. Keď sa kotva presunie na podstránku a preklad sa neopraví, klik
 *     skončí na rozcestníku bez vysvetlenia a používateľ prestane odkazom
 *     veriť. Preto sa každá kotva musí dať preložiť na cestu, ktorá ju má.
 *  B. **Karta, ktorá upokojuje bez krytia.** Stav karty je tvrdenie o
 *     produkčnom eshope. Keď sa údaj nedá prečítať, veta to musí povedať —
 *     nikdy sa nedopĺňa nula ani „všetko v poriadku" (P7).
 *
 * Ďalej sa tu drží to, čo sa rozdelením NESMIE zmeniť: poradie kotiev a fakt,
 * že červená zóna sa na rozcestník nedostane ani ako dlaždica (bod 14).
 *
 * Vlastník: V12.
 */
import { describe, expect, it } from 'vitest';

import type { BlockerWire, KeyMetaView, QueueView, SettingsView } from '@/components/settings/api';
import { APP_CAPABILITIES, isAnchor } from '@/components/settings/FeatureIndex';
import {
  cardBlocker,
  cardState,
  countSk,
  type CardFacts,
} from '@/components/settings/index-cards';
import { TONE_SIG_CLASS } from '@/components/settings/blockers-view';
import { PAGE_NEEDS } from '@/components/settings/SettingsSubPage';
import { SETTINGS_CSS } from '@/components/settings/styles';
import {
  INDEX_PAGES,
  SETTINGS_ANCHORS,
  SETTINGS_PAGES,
  hrefForAnchor,
  pageBySlug,
  subPagePath,
  subPagePathForAnchor,
} from '@/components/settings/sub-pages';

/* ═══════════════════════════ vzorka ═══════════════════════════════════════ */

const SETTINGS: SettingsView = {
  shopDomain: 'https://sperky-eshop.sk',
  domainConfirmedAt: '2026-08-10T09:12:00.000Z',
  eagerWriteDefault: true,
  writesLocked: false,
  writesLockedReason: null,
  onboardingDoneAt: '2026-08-10T09:20:00.000Z',
  scopeMode: 'pilot',
  maxProducts: 10,
  maxProductsPerCampaign: 10,
  pilotMaxProducts: 10,
  scopeFailClosed: false,
  dailyWriteBudget: 200,
};

const KEY: KeyMetaView = {
  present: true,
  last4: '4f21',
  savedAt: '2026-08-10T09:15:00.000Z',
  expiresAt: '2026-08-20T00:00:00.000Z',
  secondsLeft: 120_000,
  verifyStatus: 'valid',
};

const QUEUE: QueueView = {
  budget: { day: '2026-08-18', budget: 200, spent: 21, remaining: 179, exhausted: false },
  queue: { pending: 0, total: 21, done: 21, campaigns: 1 },
  estimate: null,
  heartbeat: { lastTickAt: '2026-08-18T12:11:00.000Z', staleMs: 4_000, stale: false },
};

const EMPTY_FACTS: CardFacts = {
  settings: null,
  writeKey: null,
  ordersKey: null,
  queue: null,
  blockers: null,
};

function blocker(over: Partial<BlockerWire> = {}): BlockerWire {
  return {
    id: 'writes_disabled',
    area: 'zapisy',
    severity: 'blokuje',
    subject: 'operacia',
    productIds: [],
    what: 'Ostrý zápis je vypnutý.',
    nextStep: 'Zapne ho správca počítača.',
    path: null,
    resolution: 'mimo_appky',
    passableNow: false,
    clearsAt: null,
    assumed: false,
    ...over,
  };
}

/* ══════════ A. Štruktúra: poradie sa rozdelením nezmenilo ═════════════════ */

describe('štruktúra podstránok', () => {
  it('ploché poradie kotiev je presne to, ktoré držala jedna dlhá stránka', () => {
    expect(SETTINGS_ANCHORS.map((a) => a.id)).toEqual([
      'covie',
      'pripojenie',
      'kluce',
      'rozsah',
      'zapisy',
      'rozpocet',
      'historia',
      'diagnostika',
      'zamknute',
      'poistky',
      'odhlasenie',
      'cervena',
    ]);
  });

  it('na rozcestníku sú štyri karty a červená zóna medzi nimi nie je', () => {
    expect(INDEX_PAGES).toHaveLength(4);
    expect(INDEX_PAGES.map((p) => p.slug)).not.toContain('cervena-zona');
    // …a pritom stránka existuje. Nie je skrytá, len sa na ňu nedá kliknúť
    // z rozcestníka (bod 14).
    expect(pageBySlug('cervena-zona')).not.toBeNull();
  });

  it('každá podstránka má nadpis, vetu a aspoň jednu kotvu', () => {
    for (const page of SETTINGS_PAGES) {
      expect(page.title.length, page.slug).toBeGreaterThan(3);
      expect(page.lead.length, page.slug).toBeGreaterThan(20);
      expect(page.groups.flatMap((g) => g.anchors).length, page.slug).toBeGreaterThan(0);
    }
  });

  it('žiadna podstránka nesťahuje viac, než kreslí', () => {
    // „Čo appka vie" je statická tabuľka. Keby sa raz začala načítavať, bolo by
    // to päť volaní za obrazovku, ktorá sa nemení.
    expect(PAGE_NEEDS['co-vie']).toEqual([]);
    for (const page of SETTINGS_PAGES) expect(PAGE_NEEDS[page.slug]).toBeDefined();
  });
});

/* ══════════ B. Odkaz do prázdna — preklad starých kotiev ═════════════════ */

describe('staré odkazy `/nastavenia#…` vedú tam, kde kotva naozaj je', () => {
  it('šesť kotiev, na ktoré appka odkazuje, sa preloží na podstránku', () => {
    // Zoznam je z `grep -o "/nastavenia#[a-z]*"` naprieč `src/`. Kto pridá
    // siedmy odkaz, nech ho pridá sem — inak sa jeho rozbitie nezistí.
    expect(subPagePathForAnchor('#rozsah')).toBe('/nastavenia/co-smie#rozsah');
    expect(subPagePathForAnchor('#rozpocet')).toBe('/nastavenia/co-smie#rozpocet');
    expect(subPagePathForAnchor('#kluce')).toBe('/nastavenia/napojenie#kluce');
    expect(subPagePathForAnchor('#pripojenie')).toBe('/nastavenia/napojenie#pripojenie');
    expect(subPagePathForAnchor('#historia')).toBe('/nastavenia/historia#historia');
    expect(subPagePathForAnchor('#zamknute')).toBe('/nastavenia/historia#zamknute');
  });

  it('kotva sa prijme aj bez mriežky a každá zo zoznamu má svoju stránku', () => {
    for (const anchor of SETTINGS_ANCHORS) {
      const path = subPagePathForAnchor(anchor.id);
      expect(path, `kotva ${anchor.id} nemá podstránku`).not.toBeNull();
      expect(path).toContain(`#${anchor.id}`);
    }
  });

  it('neznáma kotva sa nehádže na náhodnú stránku', () => {
    // Zlá podstránka je horšia než žiadna: človek by uveril, že tam sekcia je.
    expect(subPagePathForAnchor('#neexistuje')).toBeNull();
    expect(subPagePathForAnchor('#')).toBeNull();
    expect(subPagePathForAnchor('')).toBeNull();
  });

  it('odkaz na iný tab prejde nezmenený', () => {
    expect(hrefForAnchor('/produkty')).toBe('/produkty');
    expect(hrefForAnchor('/')).toBe('/');
  });

  it('zoznam funkcií nevedie ani jedným odkazom do prázdna', () => {
    for (const row of APP_CAPABILITIES) {
      if (!isAnchor(row.href)) continue;
      expect(subPagePathForAnchor(row.href), `odkaz ${row.href}`).not.toBeNull();
    }
  });

  it('cesta na podstránku sa skladá na jednom mieste', () => {
    expect(subPagePath('co-smie')).toBe('/nastavenia/co-smie');
  });
});

/* ══════════ C. Stav karty — prekážka prebíja, neznáme sa prizná ══════════ */

describe('stav karty', () => {
  it('prekážka zo servera prebíja pokojný fakt a veta sa neprepisuje', () => {
    const state = cardState('co-smie', { ...EMPTY_FACTS, settings: SETTINGS, blockers: [blocker()] });
    expect(state.fromBlocker).toBe(true);
    expect(state.sentence).toBe('Ostrý zápis je vypnutý.');
    /*
     * `mimo_appky` → tón poruchy a slovo o tom, že sa to rieši mimo appky.
     *
     * Znenie prepísané 19. 8. 2026 pri zjednotení slovníkov. Nastavenia mali
     * dovtedy vlastné slová v druhej osobe („appka s tým nespraví nič",
     * „vyriešiš to tu v appke"), Prehľad neosobné a tab Zľavy tretie. Slovník
     * je odteraz jeden (`ui/blocker-look.ts`) a je neosobný, ako káže štýl
     * textov appky — teda znenie Prehľadu.
     */
    expect(state.tone).toBe('critical');
    expect(state.word).toBe('rieši sa mimo appky');
  });

  it('berie sa PRVÁ prekážka z oblastí karty — poradie servera sa neprehadzuje', () => {
    const rows = [
      blocker({ id: 'key_missing', area: 'kluc', what: 'Kľúč chýba.' }),
      blocker({ id: 'scope_pilot_cap', area: 'rozsah', what: 'Pilotný strop.' }),
      blocker({ id: 'write_budget_low', area: 'rozpocet', what: 'Rozpočet dochádza.' }),
    ];
    expect(cardBlocker('co-smie', rows)?.what).toBe('Pilotný strop.');
    expect(cardBlocker('napojenie', rows)?.what).toBe('Kľúč chýba.');
  });

  it('karta „Čo appka vie" prekážky nemá — je to zoznam, nie stav', () => {
    const rows = [blocker({ id: 'key_missing', area: 'kluc' })];
    expect(cardBlocker('co-vie', rows)).toBeNull();
    expect(cardState('co-vie', { ...EMPTY_FACTS, blockers: rows }).fromBlocker).toBe(false);
  });

  it('bez prekážky hovorí karta, čo je nastavené — nie že je všetko v poriadku', () => {
    const state = cardState('co-smie', { ...EMPTY_FACTS, settings: SETTINGS, queue: QUEUE });
    expect(state.sentence).toContain('Rozsah pilotný');
    expect(state.sentence).toContain('10 produktov');
    expect(state.sentence).toContain('21 z 200');
    expect(state.sentence).not.toMatch(/v poriadku|OK|všetko/i);
    expect(state.word).toBeNull();
  });

  it('nedočítaný údaj sa prizná a nedopĺňa sa nula', () => {
    const scope = cardState('co-smie', EMPTY_FACTS);
    expect(scope.sentence).toContain('nepodarilo prečítať');
    expect(scope.tone).toBe('idle');

    // Rozsah sa prečítal, rozpočet nie — prizná sa práve tá chýbajúca polovica.
    const half = cardState('co-smie', { ...EMPTY_FACTS, settings: SETTINGS });
    expect(half.sentence).toContain('Rozpočet zápisov na dnes appka nepozná');
    expect(half.sentence).not.toContain('0 z');
  });

  it('zelená je len tam, kde appka niečo naozaj overila', () => {
    const good = cardState('napojenie', { ...EMPTY_FACTS, writeKey: KEY });
    expect(good.tone).toBe('good');
    expect(good.sentence).toBe('Kľúč na zápis platí do 20.08.2026.');

    // Uložený kľúč bez známej platnosti NIE JE dôvod na zelenú.
    const noExpiry = cardState('napojenie', {
      ...EMPTY_FACTS,
      writeKey: { ...KEY, expiresAt: null, secondsLeft: null },
    });
    expect(noExpiry.tone).toBe('idle');

    // Nedočítaný stav kľúča už vôbec nie.
    expect(cardState('napojenie', EMPTY_FACTS).tone).toBe('idle');
    expect(cardState('napojenie', EMPTY_FACTS).sentence).toContain('nepodarilo prečítať');
  });

  it('chýbajúci kľúč je porucha, nie pokojná informácia', () => {
    const state = cardState('napojenie', {
      ...EMPTY_FACTS,
      writeKey: { ...KEY, present: false, last4: null, expiresAt: null, secondsLeft: null },
    });
    expect(state.tone).toBe('critical');
    expect(state.sentence).toBe('Kľúč na zápis nie je uložený.');
  });

  it('história hovorí meraný čas, alebo priznanie — nikdy „pred chvíľou"', () => {
    const known = cardState('historia', { ...EMPTY_FACTS, queue: QUEUE });
    expect(known.sentence).toContain('18.08.2026 14:11');
    expect(known.sentence).not.toMatch(/pred |chvíľou|nedávno/i);

    expect(cardState('historia', EMPTY_FACTS).sentence).toBe(
      'Posledný krok fronty appka nepozná.',
    );
  });

  it('karta „Čo appka vie" hovorí aj to, čo appka NEDOSTANE', () => {
    const state = cardState('co-vie', EMPTY_FACTS);
    expect(state.sentence).toMatch(/^Appka vie \d+ (vec|veci|vecí)\. \d+ (údaj|údaje|údajov) z eshopu nedostane\.$/);
  });

  it('počty sa skloňujú — obrazovka, ktorá píše „4 údajov", nevie ani počítať', () => {
    const forms = ['údaj', 'údaje', 'údajov'] as const;
    expect(countSk(1, forms)).toBe('1 údaj');
    expect(countSk(2, forms)).toBe('2 údaje');
    expect(countSk(4, forms)).toBe('4 údaje');
    expect(countSk(5, forms)).toBe('5 údajov');
    expect(countSk(11, forms)).toBe('11 údajov');
    // Nula je „údajov", nie „údaj".
    expect(countSk(0, forms)).toBe('0 údajov');
  });
});

/* ═══════════ D19 — geometria rozcestníka stojí na tokenoch palety ═════════ */

describe('D19 — Nastavenia používajú akcent, nie surový teal', () => {
  it('žiadna farba nie je natvrdo napísaná', () => {
    expect(SETTINGS_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('akcent sa berie cez `--accent`, nie cez `--teal`', () => {
    // Vlna F oddelila akcent od primitívu rodiny: `--teal` je surová farba
    // (v svetlej téme je príliš svetlá na text), `--accent` je rola. Karta,
    // odkaz aj zvýraznenie sú AKCIE a aktívny stav — presne to, na čo je
    // akcent vyhradený (R5). Stav nesmie kódovať nikdy.
    expect(SETTINGS_CSS).not.toContain('var(--teal)');
    expect(SETTINGS_CSS).toContain('var(--accent)');
  });

  it('zlatá sa na popisky nepoužíva', () => {
    expect(SETTINGS_CSS).not.toContain('var(--gold');
  });

  it('stav karty nie je nikdy len farba — nesie triedu so značkou aj text', () => {
    // `TONE_SIG_CLASS` mapuje tón na `.sig …`, a `.sig::before` je GLYF.
    // Veta karty je tretí kanál.
    for (const tone of ['critical', 'attention', 'good', 'idle'] as const) {
      expect(TONE_SIG_CLASS[tone]).toMatch(/^sig\b/);
    }
  });
});
