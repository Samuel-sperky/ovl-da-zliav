/**
 * Aura Zľavy — OMRVINKOVÁ CESTA A ODKAZY NASTAVENÍ (D138, V6a).
 *
 * Tento súbor stráži tri veci a každá z nich sa už raz v tomto repe pokazila
 * ticho — bez pádu, bez chybovej hlášky, len obrazovka prestala hovoriť pravdu.
 *
 *  A. **Posledná omrvinka nesmie byť odkaz.** Odkaz na stránku, na ktorej
 *     človek stojí, čítačke sľubuje pohyb, ktorý sa nestane, a myši ponúka
 *     klik, po ktorom sa nič nezmení. Pravidlo je v komponente, nie v
 *     obrazovke — `breadcrumbSteps()` cestu poslednému kroku zahodí, aj keď
 *     mu ju volajúci dá.
 *
 *  B. **Oddeľovač musí byť pre čítačku neviditeľný.** Bez `aria-hidden`
 *     prečíta VoiceOver medzi krokmi názov znaku. A nesmie to byť pomlčka:
 *     „—" (U+2014) má v tejto appke jediný význam — „nevieme" (I11).
 *
 *  C. **Odkaz do prázdna.** 27. 8. 2026 zmazalo D99 `SignOut.tsx` a rozcestník
 *     Nastavení mesiac ponúkal odkaz na sekciu, ktorá neexistuje. Nenašiel to
 *     test, ale preklik — `nastavenia-v12.spec.ts` si kotvu `odhlasenie`
 *     z kontroly VÝSLOVNE vyňal s tým, že „kryje ju e2e", a e2e ju nekryla.
 *     Tu sa preto meria oboje: či odkaz vedie na existujúcu ROUTU (súbor
 *     `page.tsx`/`route.ts` v strome `src/app`) a či na jeho kotvu naozaj
 *     niekto kreslí sekciu s tým `id`.
 *
 * KTO STRÁŽI ČO (aby sa výnimky znovu nestali dierami)
 * ----------------------------------------------------
 *  · `nastavenia-v12.spec.ts` vykresľuje šesť sekcií a meria ich `id` na
 *    živom markupe. Zvyšných päť kotiev (`covie`, `pripojenie`, `historia`,
 *    `cervena`, plus overenie celého zoznamu) meria oddiel D tohto súboru —
 *    štyri z nich vykreslením, takže to nie je grep nad zdrojom.
 *  · Existenciu routy nemeria nikto iný v repe; je to celý oddiel C.
 *  · Skutočný vzhľad omrvinky (výška, kontrast) je Samuelov preklik (D141).
 *
 * Vykresľuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna databáza,
 * žiadna sieť. Efekty klienta sa nespúšťajú, takže sa meria markup, nie dáta.
 *
 * Vlastník: V6a.
 */
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import AuditPanel from '@/components/audit/AuditPanel';
import { TABS } from '@/components/layout/Nav';
import type { KeyMetaView, QueueView, SettingsView } from '@/components/settings/api';
import BudgetSection from '@/components/settings/BudgetSection';
import DiagnosticsSection from '@/components/settings/DiagnosticsSection';
import DomainForm from '@/components/settings/DomainForm';
import FeatureIndex, { APP_CAPABILITIES } from '@/components/settings/FeatureIndex';
import KeysSection from '@/components/settings/KeysSection';
import LockedFeatures from '@/components/settings/LockedFeatures';
import PanicButton from '@/components/settings/PanicButton';
import SafeguardsSection from '@/components/settings/SafeguardsSection';
import ScopeModeForm from '@/components/settings/ScopeModeForm';
import SettingsIndex from '@/components/settings/SettingsIndex';
import SettingsSubPage from '@/components/settings/SettingsSubPage';
import { SETTINGS_CSS } from '@/components/settings/styles';
import WritesSection from '@/components/settings/WritesSection';
import {
  SETTINGS_ANCHORS,
  SETTINGS_PAGES,
  SETTINGS_ROOT,
  hrefForAnchor,
  settingsTrail,
  subPagePath,
} from '@/components/settings/sub-pages';
import {
  BREADCRUMB_NAV_LABEL,
  BREADCRUMB_SEPARATOR,
  Breadcrumb,
  breadcrumbSteps,
} from '@/components/ui/Breadcrumb';

/** Rozcestník volá `useRouter()` kvôli prekladu starých kotiev. */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
}));

const noop = () => {};

/** Pomlčka „nevieme" (I11). Oddeľovač omrvinky ňou byť NESMIE. */
const POMLCKA = '—';

/* Vzorka len na to, aby sa sekcie dali VYKRESLIŤ — čísla nič netvrdia. */
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

function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element);
}

/** Blok omrvinky z markupu stránky. `null` = na stránke nie je. */
function omrvinka(markup: string): string | null {
  const found = markup.match(
    new RegExp(`<nav[^>]*aria-label="${BREADCRUMB_NAV_LABEL}"[\\s\\S]*?</nav>`),
  );
  return found === null ? null : found[0];
}

/** Koľkokrát sa vzor v texte vyskytuje. */
function pocet(text: string, vzor: RegExp): number {
  return text.match(new RegExp(vzor.source, `${vzor.flags.replace('g', '')}g`))?.length ?? 0;
}

/* ═════════════ A. Kroky cesty — pravidlo je v komponente ══════════════════ */

describe('breadcrumbSteps — posledný krok nie je odkaz', () => {
  it('zahodí cestu poslednému kroku, aj keď mu ju volajúci dá', () => {
    const steps = breadcrumbSteps([
      { label: 'Nastavenia', href: '/nastavenia' },
      { label: 'Čo smie robiť', href: '/nastavenia/co-smie' },
    ]);
    expect(steps).toHaveLength(2);
    expect(steps[0]).toEqual({
      label: 'Nastavenia',
      href: '/nastavenia',
      current: false,
      separated: false,
    });
    expect(steps[1]).toEqual({
      label: 'Čo smie robiť',
      href: null,
      current: true,
      separated: true,
    });
  });

  it('prázdny `href` NIE JE cesta — odkaz na aktuálnu adresu je klik do ničoho', () => {
    const steps = breadcrumbSteps([
      { label: 'Koreň', href: '' },
      { label: 'Medzikrok' },
      { label: 'Tu som', href: '/tu' },
    ]);
    expect(steps.map((s) => s.href)).toEqual([null, null, null]);
    expect(steps.map((s) => s.current)).toEqual([false, false, true]);
  });

  it('oddeľovač má každý krok okrem prvého', () => {
    const steps = breadcrumbSteps([
      { label: 'A', href: '/a' },
      { label: 'B', href: '/b' },
      { label: 'C' },
    ]);
    expect(steps.map((s) => s.separated)).toEqual([false, true, true]);
  });

  it('jediný krok je súčasne aktuálny — a teda bez cesty', () => {
    expect(breadcrumbSteps([{ label: 'Sám', href: '/sam' }])).toEqual([
      { label: 'Sám', href: null, current: true, separated: false },
    ]);
  });
});

/* ═════════════ B. Markup — čítačka, oddeľovač, jeden krok ═════════════════ */

describe('Breadcrumb — čo z toho prečíta čítačka', () => {
  const markup = render(
    createElement(Breadcrumb, {
      items: [
        { label: 'Nastavenia', href: '/nastavenia' },
        { label: 'Medzikrok', href: '/nastavenia/medzi' },
        { label: 'Čo smie robiť' },
      ],
      testId: 'omrvinka-test',
    }),
  );

  it('meranie vôbec niečo našlo', () => {
    /* Bez tejto poistky by tvrdenia nižšie svietili nad prázdnym reťazcom —
       presne tak vznikol zelený test o troch mŕtvych selektoroch. */
    expect(markup.length).toBeGreaterThan(80);
    expect(markup).toContain('data-testid="omrvinka-test"');
  });

  it('je to orientačný bod `nav` s vlastným menom, nie hlavná navigácia', () => {
    expect(markup).toMatch(new RegExp(`<nav[^>]*aria-label="${BREADCRUMB_NAV_LABEL}"`));
    // Hlavná navigácia (`Nav.tsx`) má meno „Hlavná navigácia"; dva orientačné
    // body s tým istým menom by čítačka nerozlíšila.
    expect(BREADCRUMB_NAV_LABEL).not.toBe('Hlavná navigácia');
  });

  it('je to zoznam `ol`/`li` a rolu si drží aj bez odrážok', () => {
    expect(markup).toMatch(/<ol[^>]*role="list"/);
    // Toľko `li`, koľko krokov — oddeľovač NIE JE položka zoznamu, inak by
    // čítačka hlásila päť krokov namiesto troch.
    expect(pocet(markup, /<li\b/)).toBe(3);
  });

  it('aktuálna stránka je `aria-current="page"` a NIE odkaz', () => {
    expect(pocet(markup, /aria-current="page"/)).toBe(1);
    expect(markup).toMatch(/<span[^>]*aria-current="page"[^>]*>Čo smie robiť<\/span>/);
    expect(markup).not.toMatch(/<a[^>]*aria-current/);
    // Odkazy sú presne dva — oba kroky pred aktuálnym.
    const hrefy = [...markup.matchAll(/<a[^>]*href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefy).toEqual(['/nastavenia', '/nastavenia/medzi']);
  });

  it('oddeľovač je pre čítačku neviditeľný a nie je to pomlčka', () => {
    expect(BREADCRUMB_SEPARATOR).not.toBe(POMLCKA);
    expect(markup).not.toContain(POMLCKA);
    // Dva kroky za prvým = dva oddeľovače a každý v `aria-hidden` obale.
    expect(pocet(markup, new RegExp(BREADCRUMB_SEPARATOR))).toBe(2);
    expect(pocet(markup, new RegExp(`<span[^>]*aria-hidden="true"[^>]*>${BREADCRUMB_SEPARATOR}`))).toBe(
      2,
    );
  });

  it('krok bez cesty sa nekreslí ako mŕtvy odkaz', () => {
    const bezCesty = render(
      createElement(Breadcrumb, {
        items: [{ label: 'Koreň', href: '/' }, { label: 'Bez cesty' }, { label: 'Tu som' }],
      }),
    );
    expect(pocet(bezCesty, /<a\b/)).toBe(1);
    expect(bezCesty).toContain('Bez cesty');
  });

  it('jednokroková cesta sa nekreslí — nie je to cesta von', () => {
    expect(render(createElement(Breadcrumb, { items: [{ label: 'Sám', href: '/sam' }] }))).toBe('');
    expect(render(createElement(Breadcrumb, { items: [] }))).toBe('');
  });
});

/* ═════════ C. Podstránky Nastavení — jedna cesta von, nie dve ═════════════ */

describe('Podstránky Nastavení — omrvinka nahradila „← Nastavenia"', () => {
  it('cesta je dvojkroková: rozcestník → táto stránka', () => {
    for (const page of SETTINGS_PAGES) {
      const trail = settingsTrail(page.slug);
      expect(trail, `cesta na ${page.slug}`).toEqual([
        { label: SETTINGS_ROOT.label, href: SETTINGS_ROOT.path },
        { label: page.title },
      ]);
    }
  });

  it('neznámy slug nedostane vymyslený krok — zostane len rozcestník', () => {
    // Podstránka s neznámym slugom sa nevykreslí vôbec (`pageBySlug` je
    // fail-closed); omrvinka si ju preto nesmie domyslieť ani názvom.
    expect(settingsTrail('nic-take' as never)).toEqual([
      { label: SETTINGS_ROOT.label, href: SETTINGS_ROOT.path },
    ]);
  });

  it('rozcestník sa menuje tým ISTÝM slovom, ktoré kreslí prvý krok cesty', () => {
    const index = render(createElement(SettingsIndex));
    expect(index).toContain(`<h1 class="page">${SETTINGS_ROOT.label}</h1>`);
  });

  for (const page of SETTINGS_PAGES) {
    it(`/${page.slug} má omrvinku a vedie ňou na rozcestník`, () => {
      const markup = render(createElement(SettingsSubPage, { slug: page.slug }));
      const nav = omrvinka(markup);
      expect(nav, `na ${page.slug} nie je omrvinka`).not.toBeNull();
      expect(markup).toContain('data-testid="settings-breadcrumb"');
      expect(nav).toMatch(
        new RegExp(`<a[^>]*href="${SETTINGS_ROOT.path}"[^>]*>${SETTINGS_ROOT.label}</a>`),
      );
      expect(nav).toContain(`aria-current="page"`);
      expect(nav).toContain(page.title);
    });
  }

  it('stará cesta von je ZMAZANÁ aj s CSS (D139) — dve by sa rozišli', () => {
    /*
     * Meria sa VÝSTUP, nie zdrojový text. Blok `<style>` a komentáre v CSS sa
     * odstrihnú zámerne: v tomto repe smie autor v komentári napísať, prečo
     * stará trieda zanikla, a test mu to nesmie zakázať (tá pasca sa tu už
     * raz stala vo vlne 1 šprintu 20).
     */
    const markupy = SETTINGS_PAGES.map((page) =>
      render(createElement(SettingsSubPage, { slug: page.slug })).replace(
        /<style>[\s\S]*?<\/style>/g,
        ' ',
      ),
    ).join('\n');
    expect(markupy).not.toContain('sub-back');
    expect(markupy).not.toContain('← Nastavenia');
    // Mŕtvy selektor v CSS je horší než žiadny: pri ďalšej oprave vyzerá ako
    // to, čo obrazovku naozaj kreslí (K11).
    expect(SETTINGS_CSS.replace(/\/\*[\s\S]*?\*\//g, ' ')).not.toMatch(/\.sub-back(?![\w-])/);
  });

  it('navigácia zostáva ŠTVORPOLOŽKOVÁ — omrvinka nepridala piatu oblasť', () => {
    /*
     * Omrvinka žije POD štvrtým tabom, nie vedľa neho: „Nastavenia › …" je
     * druhý riadok tej istej oblasti. Kontrakt V6 piatu oblasť vylúčil (§5)
     * a `Nav.tsx` má v hlavičke napísané „PRESNE ŠTYRI TABY" — do dnes to
     * ale nemeral ani jeden unit test.
     */
    expect(TABS.map((tab) => tab.href)).toEqual(['/', '/produkty', '/zlavy', '/nastavenia']);
    for (const tab of TABS) {
      expect(routaExistuje(tab.href), `tab ${tab.label} vedie do prázdna`).toBe(true);
    }
    // A rozcestník ponúka práve štyri karty (bod 14: červená zóna medzi ne
    // nepatrí, hoci podstránka je piata).
    expect(SETTINGS_PAGES.filter((page) => page.onIndex)).toHaveLength(4);
    const index = render(createElement(SettingsIndex));
    expect(pocet(index, /class="set-card"/)).toBe(4);
  });
});

/* ═══════════ D. Žiadny odkaz Nastavení nevedie do prázdna ═════════════════ */

/** Cesty, ktoré appka naozaj obsluhuje — odvodené zo stromu `src/app`. */
function routy(): readonly string[] {
  const koren = resolve(process.cwd(), 'src/app');
  const out: string[] = [];
  const chod = (dir: string, useky: readonly string[]) => {
    for (const zapis of readdirSync(dir, { withFileTypes: true })) {
      if (zapis.isDirectory()) {
        // Zoskupenie `(nazov)` Next z adresy vypúšťa, do cesty teda nepatrí.
        const dalsie = /^\(.+\)$/.test(zapis.name) ? useky : [...useky, zapis.name];
        chod(join(dir, zapis.name), dalsie);
      } else if (zapis.name === 'page.tsx' || zapis.name === 'route.ts') {
        out.push(`/${useky.join('/')}`);
      }
    }
  };
  chod(koren, []);
  return out;
}

const ROUTY = routy();

/** Obsluhuje appka túto adresu? Dynamický úsek `[id]` prijme čokoľvek. */
function routaExistuje(href: string): boolean {
  const cesta = href.split('#')[0].split('?')[0];
  const chcem = (cesta === '' ? '/' : cesta).split('/');
  return ROUTY.some((routa) => {
    const mam = routa.split('/');
    if (mam.length !== chcem.length) return false;
    return mam.every((usek, i) => (/^\[.+\]$/.test(usek) ? chcem[i] !== '' : usek === chcem[i]));
  });
}

/** Vnútorné odkazy z markupu. Vonkajšie (`https:`, `mailto:`) sa netýkajú. */
function odkazy(markup: string): readonly string[] {
  return [...markup.matchAll(/href="([^"]*)"/g)]
    .map((m) => m[1])
    .filter((href) => href.startsWith('/'));
}

describe('odkazy Nastavení vedú na routy, ktoré existujú', () => {
  it('meranie vôbec niečo našlo', () => {
    expect(ROUTY.length).toBeGreaterThan(10);
    expect(ROUTY).toContain('/nastavenia');
    expect(ROUTY).toContain('/');
    // Poistka proti príliš tolerantnému porovnávaniu: vymyslená cesta padne.
    expect(routaExistuje('/nastavenia/tato-stranka-neexistuje')).toBe(false);
    expect(routaExistuje('/zlavy/ABC123')).toBe(true);
  });

  it('každá podstránka Nastavení má svoj `page.tsx`', () => {
    for (const page of SETTINGS_PAGES) {
      expect(routaExistuje(subPagePath(page.slug)), `chýba routa ${page.slug}`).toBe(true);
    }
  });

  it('každá kotva sa preloží na existujúcu routu a kotvu si ponechá', () => {
    for (const anchor of SETTINGS_ANCHORS) {
      const href = hrefForAnchor(`#${anchor.id}`);
      expect(href, `kotva ${anchor.id}`).toContain(`#${anchor.id}`);
      expect(routaExistuje(href), `kotva ${anchor.id} vedie na neexistujúcu routu`).toBe(true);
    }
  });

  it('každý odkaz v zozname funkcií („Čo appka vie") niekam vedie', () => {
    // `APP_CAPABILITIES` drží kotvy AJ celé cesty (`/produkty`, `/`) a všetky
    // idú cez `hrefForAnchor()`. Toto je zoznam, ktorý appka o sebe tvrdí.
    expect(APP_CAPABILITIES.length).toBeGreaterThan(5);
    for (const row of APP_CAPABILITIES) {
      const href = hrefForAnchor(row.href);
      expect(routaExistuje(href), `funkcia s odkazom ${row.href} vedie do prázdna`).toBe(true);
    }
  });

  it('každý odkaz na rozcestníku a na podstránkach vedie na existujúcu routu', () => {
    const obrazovky: readonly { kde: string; markup: string }[] = [
      { kde: 'rozcestník', markup: render(createElement(SettingsIndex)) },
      ...SETTINGS_PAGES.map((page) => ({
        kde: `/${page.slug}`,
        markup: render(createElement(SettingsSubPage, { slug: page.slug })),
      })),
    ];
    let najdene = 0;
    for (const { kde, markup } of obrazovky) {
      for (const href of odkazy(markup)) {
        najdene += 1;
        expect(routaExistuje(href), `${kde}: odkaz ${href} vedie do prázdna`).toBe(true);
      }
    }
    // Rozcestník má štyri karty a každá podstránka omrvinku; menej než toľko
    // znamená, že sa meranie rozbilo, nie že je všetko v poriadku.
    expect(najdene).toBeGreaterThanOrEqual(4 + SETTINGS_PAGES.length);
  });

  it('a kotva, na ktorú odkaz vedie, má sekciu, ktorá sa naozaj vykreslí', () => {
    /*
     * Toto je druhá polovica pasce z 27. 8. 2026. Routa môže existovať a odkaz
     * aj tak skončí v prázdne, keď na cieľovej stránke nikto sekciu s tým `id`
     * nekreslí — presne to sa stalo kotve `odhlasenie` po zmazaní
     * `SignOut.tsx`.
     *
     * Zoznam nižšie je ÚPLNÝ: vykreslí sa každý komponent, ktorý v Nastaveniach
     * vlastní nejakú sekciu, a potom sa prejde CELÉ `SETTINGS_ANCHORS`. Žiadna
     * kotva nie je z kontroly vyňatá — presne tá výnimka („kryje ju e2e")
     * bola tá diera. Meria sa vykreslený markup, nie grep nad zdrojom.
     */
    const markup = [
      render(createElement(FeatureIndex)),
      render(
        createElement(DomainForm, {
          shopDomain: 'https://sperky-eshop.sk',
          domainConfirmedAt: '2026-08-10T09:12:00.000Z',
          onSaved: noop,
        }),
      ),
      render(createElement(KeysSection, { writeKey: KEY, ordersKey: KEY, onStored: noop })),
      render(createElement(ScopeModeForm, { settings: SETTINGS, onChanged: noop })),
      render(createElement(WritesSection, { status: null, settings: SETTINGS })),
      render(createElement(BudgetSection, { settings: SETTINGS, queue: QUEUE })),
      render(createElement(AuditPanel)),
      render(createElement(DiagnosticsSection)),
      render(createElement(LockedFeatures)),
      render(createElement(SafeguardsSection, { settings: SETTINGS, onChanged: noop })),
      render(createElement(PanicButton, { keyPresent: true, onWiped: noop })),
    ].join('\n');

    expect(SETTINGS_ANCHORS.length).toBeGreaterThan(10);
    for (const anchor of SETTINGS_ANCHORS) {
      expect(markup, `chýba sekcia s kotvou ${anchor.id} (${anchor.label})`).toContain(
        `id="${anchor.id}"`,
      );
    }
  });
});
