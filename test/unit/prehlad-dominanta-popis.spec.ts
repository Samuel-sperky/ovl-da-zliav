/**
 * Aura Zľavy — PREHĽAD: čo dominanta o svojom čísle TVRDÍ (nález X5,
 * audit 25. 8. 2026, tím UX).
 *
 * PREČO EXISTUJE TENTO SÚBOR
 * --------------------------
 * Najväčšie číslo celej appky je zlomok fronty v dominante Prehľadu a pod ním
 * stojí jeho popis. Číslo je `progress.done`, teda `total − pending`
 * (`app/api/queue/route.ts`) — položky, ktoré fronta VYBAVILA, vrátane
 * `failed`, `uncertain`, `skipped` a `interrupted`. Do 26. 8. 2026 ho popis
 * nazýval „zapísaných položiek", takže pri dvanástich zlyhaných položkách
 * obrazovka tvrdila o dvanástich produktoch, že v shope zlacnené sú, hoci
 * appka vie, že nie sú. `design/v3/ARCHITEKTURA.md §3.2` hovorí opak doslova
 * („Pruh počíta spracované, nie úspešné") a pokojný stav tej istej sekcie to
 * isté číslo označuje ako „Spracované položky" — jedno číslo v jednej sekcii
 * malo dva rôzne popisy.
 *
 * ČO SA TU MERIA (a čo NIE)
 * -------------------------
 *
 *  A. **Že sa meria dominanta.** Najprv sa tvrdí, že vytiahnuté číslo je
 *     naozaj `formatCountSk(done)`. Bez toho by sa test o popise mohol chytiť
 *     ľubovoľného `.sub` na obrazovke.
 *
 *  B. **Že popis netvrdí zápis, kým `done` obsahuje nezapísané položky.**
 *     Vzorka má `failed > 0`, takže tvrdenie „zapísaných" je preukázateľne
 *     nepravdivé. Meria sa KOREŇ slova, nie celá formulácia: prepísať popis
 *     na „spracovaných položiek fronty" má prejsť, vrátiť doň zápis nie.
 *
 *  C. **Že koreň zápisu je stále koreňom zápisu.** Tvrdenie B by po
 *     premenovaní slovníka mohlo svietiť zeleno nad slovom, ktoré appka už
 *     nepoužíva. Preto sa najprv overí, že ten istý koreň naozaj nesú tie dva
 *     popisy na tej istej obrazovke, ktoré o zápise hovoriť MAJÚ („Zostáva
 *     zapísať" nad `pending`, „Dnes zapísaných" nad rozpočtom). Keď sa
 *     slovník posunie, padne toto tvrdenie, nie tie ostatné ticho.
 *
 *  D. **Že obe miesta nazývajú to isté číslo tým istým slovom.** Bežiaca
 *     fronta a pokojný stav kreslia rovnaké `done`. Test porovnáva ich korene,
 *     takže spoločné premenovanie prejde a rozchod nie — presne to je defekt,
 *     ktorý X5 opisuje.
 *
 * NEMERIA sa reťazce v `.tsx`. Renderuje sa `renderToStaticMarkup`, žiadny
 * prehliadač, žiadna sieť, žiadna databáza.
 *
 * Vlastník: tím UX, audit 30 (nález X5).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import StatusSection from '@/components/dashboard/StatusSection';
import type { CalmNumbers, QueueProgress } from '@/components/dashboard/overview-model';
import type { CheckMark, Verdict } from '@/components/dashboard/overview-verdict';
import { formatCountSk } from '@/lib/ui/vocabulary';

/* ═════════════════════════════ vzorky ═════════════════════════════════════ */

/** Odvodenie z ARCHITEKTURA §3.2: 3 420 spracovaných, z toho 12 zlyhalo. */
const DONE = 3420;
const TOTAL = 8000;
const FAILED = 12;

const VERDICT: Verdict = {
  kind: 'ok',
  tone: 'ok',
  word: 'Zapisuje',
  headline: 'Fronta zapisuje.',
  detail: 'Nič nezastavuje ani nebrzdí zápis.',
};

const CHECKS: readonly CheckMark[] = [];

const CALM: CalmNumbers = { live: 1, ready: 1, discounted: 2380 };

/** Fronta zapisuje a dvanásť položiek sa nepodarilo — `done` ich obsahuje. */
function running(): QueueProgress {
  return {
    mode: 'running',
    done: DONE,
    total: TOTAL,
    percent: 42.75,
    pending: TOTAL - DONE,
    campaignId: 7,
    campaignName: 'Ležiaky striebro — jeseň',
    sentence: null,
    tiersLabel: '3 pásma · 30 / 20 / 15 %',
    finishDay: '2026-09-02',
    dateFrom: '2026-09-04',
    dateTo: '2026-09-18',
    failed: FAILED,
    pausedSince: null,
    stalled: null,
  };
}

/** Ten istý počet spracovaných položiek, len fronta práve nezapisuje. */
function calm(): QueueProgress {
  return { ...running(), mode: 'calm', percent: 0, pending: 0, stalled: false };
}

function render(progress: QueueProgress): string {
  return renderToStaticMarkup(
    createElement(StatusSection, {
      verdict: VERDICT,
      checks: CHECKS,
      progress,
      budget: { spent: 100, budget: 200, remaining: 100 },
      calm: CALM,
      gap: null,
      onChanged: (): void => {},
    }),
  );
}

/* ═════════════════════════════ pomôcky ════════════════════════════════════ */

/** Číslo v displejovom slote dominanty (bez menovateľa). */
function dominantValue(html: string): string {
  const hit = /data-testid="queue-number"[^>]*>([^<]*)/.exec(html);
  expect(hit, 'dominanta sa nevykreslila').not.toBeNull();
  return (hit as RegExpExecArray)[1];
}

/** Popis pod dominantou — prvý `.sub` za jej číslom. */
function dominantCaption(html: string): string {
  const hit = /data-testid="queue-number"[\s\S]*?<span class="sub">([\s\S]*?)<\/span>/.exec(html);
  expect(hit, 'dominanta nemá popis').not.toBeNull();
  return (hit as RegExpExecArray)[1];
}

/** Všetky dlaždice pásma čísel ako `popis → hodnota`. */
function figures(html: string): Map<string, string> {
  const out = new Map<string, string>();
  const pattern =
    /<div class="kpi dense"><div class="k">([\s\S]*?)<\/div><div class="v"[^>]*>([\s\S]*?)<\/div>/g;
  for (const hit of html.matchAll(pattern)) out.set(hit[1], hit[2]);
  return out;
}

/** Bez diakritiky a malými písmenami — koreň sa porovnáva na tvare, nie na mäkčeni. */
function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** Prvé slovo popisu v porovnateľnom tvare. */
function stemOf(text: string): string {
  return plain(text).trim().split(/\s+/)[0] ?? '';
}

/** Najdlhšia spoločná predpona dvoch slov — teda ich spoločný koreň. */
function sharedRoot(left: string, right: string): string {
  let at = 0;
  while (at < left.length && at < right.length && left[at] === right[at]) at += 1;
  return left.slice(0, at);
}

/**
 * Koreň, ktorým appka hovorí o ZÁPISE do shopu. Je to literál, ale nie visiaci
 * vo vzduchu: tvrdenie C nižšie overuje, že ho tie dve dlaždice, ktoré o zápise
 * hovoriť majú, naozaj nesú.
 */
const WRITE_ROOT = 'zapis';

/* ══════════════════════════════ tvrdenia ══════════════════════════════════ */

describe('X5 — dominanta Prehľadu nazýva svoje číslo tým, čím je', () => {
  it('A — vytiahnuté číslo je naozaj počet spracovaných položiek', () => {
    expect(dominantValue(render(running()))).toBe(formatCountSk(DONE));
  });

  it('C — koreň zápisu nesú tie dlaždice, ktoré o zápise hovoriť majú', () => {
    const labels = [...figures(render(running())).keys()];
    const aboutWrites = labels.filter((label) => plain(label).includes(WRITE_ROOT));
    // „Zostáva zapísať" (nad `pending`) a „Dnes zapísaných" (nad rozpočtom).
    expect(aboutWrites.length).toBeGreaterThanOrEqual(2);
  });

  it('B — popis dominanty netvrdí zápis, kým sú medzi spracovanými zlyhané', () => {
    const progress = running();
    // Premisa tvrdenia: `done` preukázateľne obsahuje nezapísané položky.
    expect(progress.failed).toBeGreaterThan(0);
    expect(progress.failed).toBeLessThanOrEqual(progress.done);

    const caption = dominantCaption(render(progress));
    expect(caption.trim().length).toBeGreaterThan(0);
    expect(plain(caption)).not.toContain(WRITE_ROOT);
  });

  it('D — bežiaca fronta a pokojný stav nazývajú to isté číslo rovnako', () => {
    const captionRunning = dominantCaption(render(running()));

    const calmFigures = figures(render(calm()));
    const sameNumber = [...calmFigures.entries()].filter(
      ([, value]) => value === formatCountSk(DONE),
    );
    expect(sameNumber.length, 'pokojný stav nekreslí počet spracovaných položiek').toBe(1);

    const root = sharedRoot(stemOf(captionRunning), stemOf(sameNumber[0][0]));
    expect(root.length, `„${captionRunning}" vs „${sameNumber[0][0]}"`).toBeGreaterThanOrEqual(6);
  });
});
