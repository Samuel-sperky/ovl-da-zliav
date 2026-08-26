/**
 * Aura Zľavy — PREHĽAD: rad dlaždíc, stĺpec akcií a presah riadkov (UX5,
 * 24. 8. 2026).
 *
 * Tri chyby, ktoré snímkovač našiel na hotovej obrazovke a ktoré nemal kde
 * zachytiť žiadny test: všetky tri sú GEOMETRIA, teda vzťah medzi tým, čo
 * kreslí komponent, a tým, čo o tom hovorí `overview.module.css`.
 *
 *   1. **Dlaždica „Okno zľavy" sa lámala do dvoch riadkov.** Bunky mriežky sú
 *      rovnako vysoké, takže jedna zalomená hodnota zdvihla celý rad štyroch
 *      dlaždíc o riadok — rad vyzeral ako schod. Tri dlaždice nesú jeden údaj,
 *      štvrtá dva dátumy (`22. 8. 2026 – 5. 9. 2026` má v 18 px reze 200 px
 *      a bunka mala 186 px obsahu). Štvrtý stĺpec preto dostáva 1,35 dielu.
 *
 *   2. **„Zastaviť frontu" bolo užšie než dve tlačidlá nad ním.** Je to
 *      `<summary class="btn">` vnútri `<details>`, teda NIE JE položkou flexu
 *      stĺpca akcií — `align-items: stretch` naťahovalo obal a tlačidlo vnútri
 *      si držalo šírku textu.
 *
 *   3. **Riadok zľavy vyliezal 8 px von zo stĺpca.** `.campRow` má zámerný
 *      záporný okraj `0 -8px`, aby podfarbenie pod myšou nekončilo na
 *      písmenách. Presah je zámer, len nemal kam vytiecť: snímkovač ho hlásil
 *      ako „obsah je o 8 px širší než rám" aj ako tri presahy riadkov.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 *  A. **Meria sa vzťah, nie prítomnosť reťazca.** Test nehľadá „je tam
 *     1.35fr", ale rozbaľuje stĺpce mriežky na čísla a pýta sa, či je posledný
 *     ŠIRŠÍ než ostatné; a nepýta sa „je tam padding", ale či sa vodorovný
 *     vnútorný okraj stĺpca ROVNÁ zápornému okraju riadku. Obe tvrdenia sa
 *     dajú porušiť aj tak, že reťazec v súbore ostane.
 *
 *  B. **Trieda musí byť aj v HTML.** Pravidlo v CSS, ktoré nikto nenosí, je
 *     mŕtvy selektor — presne tak vznikol zelený test o troch mŕtvych triedach
 *     (19. 8. 2026). Každé tvrdenie o CSS má preto dvojča nad vykresleným
 *     HTML.
 *
 *  C. **Štvorpásmo a trojpásmo nie sú to isté.** `.figs` patrí LEN pásmu
 *     bežiacej fronty; pásmo pokojného stavu má tri dlaždice a so štyrmi
 *     stĺpcami by malo prázdne miesto. Test drží obe strany.
 *
 *  D. **`:global(.kpis)` v selektore je nutnosť, nie ozdoba.** Samotná `.figs`
 *     má rovnakú špecifickosť ako `.kpis` z `globals.css` a v zlepenom hárku
 *     rozhoduje poradie súborov — pri prvom pokuse vyhral globals a rad sa
 *     lámal ďalej. Toto test tiež stráži.
 *
 * Vlastník: UX5 (Prehľad).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import CampaignsSection from '@/components/dashboard/CampaignsSection';
import StatusSection from '@/components/dashboard/StatusSection';
import styles from '@/components/dashboard/overview.module.css';
import type { CampaignRow } from '@/components/dashboard/api';
import type { LiveCampaign, QueueProgress } from '@/components/dashboard/overview-model';
import type { CheckMark, Verdict } from '@/components/dashboard/overview-verdict';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const MODUL = read('../../src/components/dashboard/overview.module.css');
const GLOBALS = read('../../src/app/globals.css');

/* ═══════════════════════ 0. Čítanie CSS ako čísel ═════════════════════════ */

/** História v hlavičkách nie je pravidlo — komentáre sa nemerajú. */
function bezKomentarov(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Telá všetkých pravidiel s presne týmto selektorom — aj tých v `@media`.
 * Vracia pole, nie prvý nález: keby sa pravidlo omylom zdvojilo, test o tom
 * má vedieť, a nie ticho merať to prvé.
 */
function telaPravidiel(css: string, selektor: string): string[] {
  const re = new RegExp(`(?:^|[{};])\\s*${escapeRe(selektor)}\\s*\\{([^{}]*)\\}`, 'g');
  return [...bezKomentarov(css).matchAll(re)].map((m) => (m[1] ?? '').trim());
}

/** Hodnota jednej vlastnosti v tele pravidla; `null`, keď tam nie je. */
function vlastnost(telo: string, meno: string): string | null {
  const m = new RegExp(`(?:^|;)\\s*${escapeRe(meno)}\\s*:\\s*([^;]+)`).exec(telo);
  return m === null ? null : (m[1] ?? '').trim();
}

/**
 * `minmax(0, 1fr) … minmax(0, 1.35fr)` → `[1, 1, 1, 1.35]`.
 *
 * Zámerne to nerozbaľuje `repeat()`: pásmo čísel má stĺpce vypísané po jednom
 * práve preto, aby sa dali prečítať ako čísla a porovnať medzi sebou.
 */
function dielyStlpcov(hodnota: string): number[] {
  return [...hodnota.matchAll(/([\d.]+)fr/g)].map((m) => Number(m[1]));
}

/** Vodorovná zložka skratky `0 -8px` / `9px 8px` / `8px` v pixeloch. */
function vodorovne(skratka: string): number {
  const casti = skratka.trim().split(/\s+/);
  const strana = casti.length === 1 ? casti[0] : casti[1];
  const m = /^(-?[\d.]+)px$/.exec(strana ?? '');
  if (m === null) {
    if ((strana ?? '') === '0') return 0;
    throw new Error(`nie je pixelová dĺžka: ${skratka}`);
  }
  return Number(m[1]);
}

/* ═══════════════════════════ 1. Vzorky ════════════════════════════════════ */

const VERDICT: Verdict = {
  kind: 'ok',
  tone: 'ok',
  headline: 'Všetko v poriadku',
  word: 'v poriadku',
  detail: 'Nič nezastavuje ani nebrzdí zápis.',
};

const CHECKS: readonly CheckMark[] = [];

/** Fronta, ktorá zapisuje — jediný stav so štyrmi dlaždicami a s „Zastaviť frontu". */
function running(patch: Partial<QueueProgress> = {}): QueueProgress {
  return {
    mode: 'running',
    done: 962,
    total: 1480,
    percent: 65,
    pending: 518,
    campaignId: 7,
    campaignName: 'Letné dočistenie skladu — oceľ',
    sentence: null,
    tiersLabel: '3 pásma · 30 / 25 / 15 %',
    finishDay: '2026-08-27',
    dateFrom: '2026-08-22',
    dateTo: '2026-09-05',
    failed: 11,
    pausedSince: null,
    stalled: false,
    ...patch,
  };
}

/** Pokojný stav — tri dlaždice, teda pásmo BEZ `.figs`. */
function calm(): QueueProgress {
  return running({
    mode: 'calm',
    campaignId: null,
    campaignName: null,
    tiersLabel: null,
    finishDay: null,
    dateFrom: null,
    dateTo: null,
  });
}

function renderStatus(progress: QueueProgress): string {
  return renderToStaticMarkup(
    createElement(StatusSection, {
      verdict: VERDICT,
      checks: CHECKS,
      progress,
      budget: { spent: 128, budget: 200, remaining: 72 },
      calm: { live: 2, ready: 1, discounted: 1328 },
      gap: null,
      onChanged: (): void => {},
    }),
  );
}

function campaignRow(): CampaignRow {
  return {
    id: 7,
    name: 'Letné dočistenie skladu — oceľ',
    status: 'running',
    percent: 30,
    dateFrom: '2026-08-22',
    dateTo: '2026-09-05',
    itemsTotal: 1180,
    itemsOk: 948,
    itemsFailed: 11,
    itemsUncertain: 0,
    itemsPending: 232,
    late: false,
    tiers: [],
    estimate: null,
  };
}

function liveCampaign(): LiveCampaign {
  return {
    row: campaignRow(),
    sentence: {
      state: 'zapisuje sa',
      tone: 'live',
      flags: [],
      text: 'zapisuje sa',
    },
    percentLabel: '3 pásma',
    writing: true,
    percent: 80,
  };
}

function renderCampaigns(): string {
  return renderToStaticMarkup(
    createElement(CampaignsSection, { campaigns: [liveCampaign()], insights: [] }),
  );
}

/* ══════════════ 2. Poistka: meranie vôbec niečo našlo ═════════════════════ */

describe('meranie má nad čím bežať', () => {
  it('oba hárky aj obe vykreslenia niečo obsahujú', () => {
    expect(bezKomentarov(MODUL).length).toBeGreaterThan(2_000);
    expect(bezKomentarov(GLOBALS).length).toBeGreaterThan(10_000);
    expect(renderStatus(running())).toContain('queue-figures');
    expect(renderCampaigns()).toContain('overview-live');
  });

  it('triedy modulu existujú (inak by tvrdenia nižšie merali `undefined`)', () => {
    for (const trieda of [styles.figs, styles.liveCol, styles.mid, styles.actions]) {
      expect(typeof trieda).toBe('string');
      expect(trieda.length).toBeGreaterThan(0);
    }
  });
});

/* ═════════════ 3. Rad štyroch dlaždíc je rad, nie schod ═══════════════════ */

describe('pásmo čísel — štvrtá bunka nesie dva dátumy a je širšia', () => {
  it('pásmo bežiacej fronty nesie triedu, ktorá stĺpce prerozdeľuje', () => {
    const html = renderStatus(running());
    expect(html).toContain(styles.figs);
    // Dlaždice sú naozaj štyri — inak by sa rozdelenie stĺpcov nedalo posúdiť.
    expect(html.split('class="kpi dense"').length - 1).toBe(4);
  });

  it('pásmo pokojného stavu ju NEMÁ — tri dlaždice, tri stĺpce', () => {
    const html = renderStatus(calm());
    expect(html.split('class="kpi dense"').length - 1).toBe(3);
    expect(html).not.toContain(styles.figs);
  });

  it('štvrtý stĺpec je širší než tri pred ním', () => {
    const tela = telaPravidiel(MODUL, ':global(.kpis).figs');
    expect(tela.length, 'základné pravidlo + jedno v @media').toBe(2);

    const diely = dielyStlpcov(vlastnost(tela[0] ?? '', 'grid-template-columns') ?? '');
    expect(diely.length, 'pásmo má štyri stĺpce').toBe(4);
    const [a, b, c, d] = diely as [number, number, number, number];
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(d, 'dátumové okno musí dostať viac než dlaždica s jedným číslom').toBeGreaterThan(a);
    // 200 px hodnoty do 186 px bunky sa nezmestí; rezerva musí byť aspoň
    // pätina, inak sa rad zlomí znova pri prvom dlhšom rozsahu.
    expect(d / a).toBeGreaterThanOrEqual(1.2);
  });

  it('v úzkom okne sa pásmo skladá, nie stláča', () => {
    const tela = telaPravidiel(MODUL, ':global(.kpis).figs');
    const uzke = dielyStlpcov(vlastnost(tela[1] ?? '', 'grid-template-columns') ?? '');
    expect(uzke.length).toBe(2);
  });

  it('pravidlo prebíja `.kpis` z globals aj bez !important', () => {
    // `.kpis` má štyri ROVNAKÉ stĺpce — to je presne to, čo sa má prebiť.
    const kpis = vlastnost(telaPravidiel(GLOBALS, '.kpis')[0] ?? '', 'grid-template-columns');
    expect(kpis).toContain('auto-fit');
    expect(new Set(dielyStlpcov(kpis ?? '')).size).toBe(1);

    // Rovnaká špecifickosť by prehrala poradím súborov, preto dvojica tried.
    expect(MODUL).toContain(':global(.kpis).figs');
    expect(bezKomentarov(MODUL)).not.toContain('!important');
  });
});

/* ═════════════ 4. Stĺpec tlačidiel má jednu šírku ═════════════════════════ */

describe('stĺpec akcií — tri tlačidlá pod sebou, jedna šírka', () => {
  it('„Zastaviť frontu" je summary vnútri details, ostatné sú položky flexu', () => {
    const html = renderStatus(running());
    expect(html).toContain('Zastaviť frontu');
    expect(html).toMatch(/<summary class="btn ghost">Zastaviť frontu<\/summary>/);
    expect(html).toContain('Nová zľava');
    expect(html).toContain('Detail zľavy');
  });

  it('summary dostáva blokový rámec, inak si drží šírku textu', () => {
    const telo = telaPravidiel(MODUL, '.actions :global(.stopq > summary.btn)');
    expect(telo.length).toBe(1);
    // `inline-flex` (predvolená hodnota `.btn`) by šírku obalu nevyplnil.
    expect(vlastnost(telo[0] ?? '', 'display')).toBe('flex');
  });

  it('a text v ňom stojí v strede ako v ostatných dvoch', () => {
    const telo = telaPravidiel(MODUL, '.actions :global(.btn)');
    expect(telo.length).toBe(1);
    expect(vlastnost(telo[0] ?? '', 'justify-content')).toBe('center');
  });

  it('stĺpec naťahuje svoje položky — bez toho by sa šírky rozišli', () => {
    const telo = telaPravidiel(MODUL, '.actions');
    expect(telo.length).toBe(1);
    expect(vlastnost(telo[0] ?? '', 'align-items')).toBe('stretch');
    expect(vlastnost(telo[0] ?? '', 'flex-direction')).toBe('column');
  });
});

/* ═════════════ 5. Presah podfarbenia má kam vytiecť ═══════════════════════ */

describe('riadok zľavy nevylezie zo stĺpca', () => {
  it('stĺpec „Beží teraz" nesie triedu s priestorom pre presah', () => {
    const html = renderCampaigns();
    expect(html).toContain('overview-live');
    expect(html).toContain(styles.liveCol);
    expect(html).toContain('live-row');
  });

  it('vnútorný okraj stĺpca sa rovná zápornému okraju riadku', () => {
    const riadok = telaPravidiel(MODUL, '.campRow');
    expect(riadok.length).toBe(1);
    const presah = -vodorovne(vlastnost(riadok[0] ?? '', 'margin') ?? '');
    expect(presah, 'riadok má presahovať — inak sa nemá čo strážiť').toBeGreaterThan(0);

    for (const selektor of ['.liveCol', '.mid']) {
      const telo = telaPravidiel(MODUL, selektor);
      expect(telo.length, selektor).toBe(1);
      expect(vodorovne(vlastnost(telo[0] ?? '', 'padding') ?? ''), `${selektor} padding`).toBe(
        presah,
      );
      // Záporný okraj vracia OBSAHOVÝ rám na pôvodné miesto: stĺpce mriežky
      // ani medzera medzi nimi sa nesmú pohnúť o jediný pixel.
      expect(vodorovne(vlastnost(telo[0] ?? '', 'margin') ?? ''), `${selektor} margin`).toBe(
        -presah,
      );
    }
  });

  it('celý presah sa zmestí do vnútorného okraja karty', () => {
    const riadok = telaPravidiel(MODUL, '.campRow');
    const presah = -vodorovne(vlastnost(riadok[0] ?? '', 'margin') ?? '');
    const sec = vodorovne(vlastnost(telaPravidiel(GLOBALS, '.sec')[0] ?? '', 'padding') ?? '');
    expect(sec).toBeGreaterThanOrEqual(presah);
  });
});
