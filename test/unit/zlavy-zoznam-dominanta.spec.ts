/**
 * Aura Zľavy — ZOZNAM ZLIAV: obrazovka má vždy dominantu (kontrakt UI
 * 13. 8. 2026 bod 21, architektúra §0 P1, kontrakt UX/dizajn 19. 8. 2026).
 *
 * Bod 21 hovorí, že dominantou tabu Zľavy je PERCENTO. Percento sa ale dá
 * ukázať len na nejakej zľave, a do 19. 8. 2026 obrazovka vyberala tú na čelo
 * len z bežiacich. Keď boli všetky skončené — po prvej sezóne bežný stav —
 * nebola na obrazovke dominanta žiadna: celý tab bol jeden zbalený rozklik
 * „Skončené" a číslo, kvôli ktorému sa tab otvára, sa nedalo prečítať nikde.
 * Bola to tichá chyba: nič nespadlo, nič sa nevypísalo, len obrazovka prestala
 * odpovedať na svoju otázku.
 *
 * Rozhodnutie o čele preto žije v `featureDiscounts()` ako čistá funkcia
 * a testuje sa tu bez prehliadača. Súbor stráži tri veci:
 *
 *   A. poradie troch záchytov: zapisuje sa → prvá živá → posledná skončená,
 *   B. zľava na čele sa v rozkliku „Skončené" NEOPAKUJE (inak nesedí počet),
 *   C. prázdno je prázdno — z ničoho sa dominanta nevyrába.
 *
 * Vlastník: vlna O1, kontrakt UX/dizajn 19. 8. 2026.
 */
import { describe, expect, it } from 'vitest';

import {
  featureDiscounts,
  orderDiscounts,
  type DiscountLike,
} from '@/components/campaigns/discounts-model';

const TODAY = '2026-08-12';

function row(patch: Partial<DiscountLike> = {}): DiscountLike {
  return {
    id: 1,
    status: 'queued',
    dateFrom: '2026-08-01',
    dateTo: '2026-08-31',
    itemsOk: 0,
    itemsFailed: 0,
    itemsPending: 100,
    late: false,
    ...patch,
  };
}

/** Skončená zľava — okno je za nami a nič nečaká na zápis. */
function done(id: number, dateTo: string): DiscountLike {
  return row({
    id,
    status: 'done',
    dateFrom: '2026-06-01',
    dateTo,
    itemsOk: 21,
    itemsPending: 0,
  });
}

function feature(rows: readonly DiscountLike[]) {
  return featureDiscounts(orderDiscounts(rows, TODAY));
}

/* ═══════════ A. Tri záchyty v poradí ══════════════════════════════════════ */

describe('zoznam zliav — kto stojí na čele', () => {
  it('prvý záchyt: zľava, ktorá sa práve zapisuje', () => {
    const writing = row({ id: 2, status: 'queued', itemsOk: 3408, itemsPending: 4580 });
    const picked = feature([done(1, '2026-07-15'), writing, row({ id: 3, status: 'scheduled' })]);

    expect(picked.featured?.id).toBe(2);
    expect(picked.rest.map((r) => r.id)).toEqual([3]);
    expect(picked.finished.map((r) => r.id)).toEqual([1]);
  });

  it('druhý záchyt: keď nič nezapisuje, postúpi prvá živá', () => {
    const picked = feature([
      row({ id: 5, status: 'scheduled', dateFrom: '2026-10-01', dateTo: '2026-10-15' }),
      row({ id: 6, status: 'queued', itemsPending: 0, itemsOk: 40 }),
    ]);

    // `beží` je pred `pripravená` — poradie naliehavosti drží `orderDiscounts`.
    expect(picked.featured?.id).toBe(6);
    expect(picked.rest.map((r) => r.id)).toEqual([5]);
  });

  it('tretí záchyt: samé skončené zľavy majú dominantu tiež (bod 21)', () => {
    const picked = feature([done(7, '2026-07-15'), done(8, '2026-06-30')]);

    // Bez tretieho záchytu by tu bolo `null` a obrazovka by nemala percento.
    expect(picked.featured).not.toBeNull();
    expect(picked.rest).toEqual([]);
  });
});

/* ═══════════ B. Čo je na čele, nie je zároveň v rozkliku ══════════════════ */

describe('zoznam zliav — riadok sa na obrazovke neopakuje', () => {
  it('skončená zľava na čele vypadne z rozkliku „Skončené"', () => {
    const picked = feature([done(7, '2026-07-15'), done(8, '2026-06-30')]);

    expect(picked.finished).toHaveLength(1);
    expect(picked.finished.map((r) => r.id)).not.toContain(picked.featured?.id);
  });

  it('jediná skončená zľava rozklik nevyrobí — nemal by čo ukázať', () => {
    const picked = feature([done(9, '2026-07-15')]);

    expect(picked.featured?.id).toBe(9);
    expect(picked.finished).toEqual([]);
  });

  it('keď na čele stojí živá zľava, skončené sa nekrátia', () => {
    const picked = feature([
      row({ id: 2, status: 'queued', itemsPending: 4580 }),
      done(7, '2026-07-15'),
      done(8, '2026-06-30'),
    ]);

    expect(picked.featured?.id).toBe(2);
    expect(picked.finished).toHaveLength(2);
  });
});

/* ═══════════ C. Z ničoho sa dominanta nevyrába ════════════════════════════ */

describe('zoznam zliav — prázdno zostáva prázdnom', () => {
  it('bez jedinej zľavy nie je čelo, zvyšok ani rozklik', () => {
    const picked = feature([]);

    expect(picked.featured).toBeNull();
    expect(picked.rest).toEqual([]);
    expect(picked.finished).toEqual([]);
  });
});

/*
 * Ako sa percento na čele napíše (jedno číslo vs. rozsah pásiem), stráži
 * `zlavy-dizajn.spec.ts` nad `percentHeadline()`. Tu ide o to, ČI má obrazovka
 * vôbec na čom percento ukázať.
 */
