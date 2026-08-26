'use client';

/**
 * Aura Zľavy — dáta pre pravú stranu hlavičky: denný rozpočet zápisov a stav
 * fronty (ARCHITEKTURA §0, K2).
 *
 * Endpoint `/api/queue` dodáva V8 a v čase písania tohto modulu ešte
 * neexistuje. Preto je tu tenký typovaný fetch s BEZPEČNÝM fallbackom: čokoľvek
 * neznáme, chýbajúce alebo nesprávne otypované sa mapuje na `null` a hlavička
 * to prizná POMLČKOU („Fronta — stav nevieme", rozpočet ako pomlčka). NIKDY sa
 * nedopĺňa vymyslené číslo — hlavička o zápisoch do produkčného shopu nesmie
 * tvrdiť nič, čo nevie.
 *
 * A „prázdna fronta" je práve také tvrdenie. Do 26. 8. 2026 hlavička na `null`
 * napísala „Fronta prázdna" — teda že nič nečaká — hoci vo fronte mohli stáť
 * tisíce položiek a appka o odpovedi servera nerozumela ani slovu. Rozdiel
 * medzi „nič tam nie je" a „nevieme" drží `queueHeaderLabel()` na konci tohto
 * súboru a je to tá istá trojica stavov, akú má dominanta Prehľadu
 * (`dashboard/overview-model.ts`, `QueueMode`).
 *
 * Očakávaný tvar (požiadavka na V8):
 *   GET /api/queue → { ok: true, data: {
 *     writes: { spentToday: number, budget: number, resumeAt: string | null },
 *     queue:  { done: number, total: number, campaigns: number }
 *   }}
 * `resumeAt` je ISO čas najbližšieho obnovenia rozpočtu (reset 02:00 miestneho
 * času). `total === 0` znamená prázdnu frontu — nie chýbajúce dáta; chýbajúce
 * dáta sú `queue === null`.
 */
import { useState } from 'react';

import { fetchJson } from '@/components/layout/health';
import { useRefreshable } from '@/components/layout/refresh';

export interface WriteBudgetView {
  /** Počet zápisov za aktuálny UTC deň — zdrojom pravdy je audit (K2). */
  spentToday: number;
  /** `daily_write_budget`, predvolene 200. */
  budget: number;
  /** ISO čas, kedy fronta pokračuje; `null` = server ho nedodal. */
  resumeAt: string | null;
}

export interface QueueView {
  /** Spracované položky (nie úspešné — inak by číslo pri opakovaniach skákalo). */
  done: number;
  total: number;
  /** Počet zliav, ktoré sa práve zapisujú. */
  campaigns: number;
}

export interface QueueHeaderData {
  writes: WriteBudgetView | null;
  queue: QueueView | null;
}

/** Nič sa nevie. Fail-safe východisko aj výsledok každej chyby. */
export const UNKNOWN_QUEUE_HEADER: QueueHeaderData = { writes: null, queue: null };

function readNonNegativeInt(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  // Turbopack tu už raz zahodil `if (!x)` ako compile-time falsy — porovnávaj
  // explicitne (pasca z CLAUDE.md).
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Čistý parser odpovede `/api/queue`. Čokoľvek, čo nesedí, končí ako `null` —
 * radšej priznaná nevedomosť než dopočítané číslo.
 */
export function parseQueueHeader(raw: unknown): QueueHeaderData {
  const root = asRecord(raw);
  if (root === null) return UNKNOWN_QUEUE_HEADER;

  let writes: WriteBudgetView | null = null;
  const w = asRecord(root['writes']);
  if (w !== null) {
    const spentToday = readNonNegativeInt(w, 'spentToday');
    const budget = readNonNegativeInt(w, 'budget');
    if (spentToday !== null && budget !== null && budget > 0) {
      const resumeAtRaw = w['resumeAt'];
      writes = {
        spentToday,
        budget,
        resumeAt: typeof resumeAtRaw === 'string' && resumeAtRaw !== '' ? resumeAtRaw : null,
      };
    }
  }

  let queue: QueueView | null = null;
  const q = asRecord(root['queue']);
  if (q !== null) {
    const done = readNonNegativeInt(q, 'done');
    const total = readNonNegativeInt(q, 'total');
    if (done !== null && total !== null) {
      queue = { done, total, campaigns: readNonNegativeInt(q, 'campaigns') ?? 0 };
    }
  }

  return { writes, queue };
}

/**
 * Načíta `/api/queue` pri otvorení obrazovky a potom už len na vyžiadanie
 * (tlačidlo Obnoviť v stavovom pruhu). Časovač tu bol do 13. 8. 2026 a bol
 * zrušený rozhodnutím používateľa — čísla sa nesmú pohnúť pod rukami.
 *
 * Kým endpoint neexistuje, vracia `UNKNOWN_QUEUE_HEADER` — appka kvôli tomu
 * nesmie nič predstierať ani padnúť.
 */
export function useQueueHeader(): QueueHeaderData {
  const [data, setData] = useState<QueueHeaderData>(UNKNOWN_QUEUE_HEADER);

  useRefreshable(async () => {
    const body = await fetchJson<unknown>('/api/queue');
    setData(parseQueueHeader(body));
  });

  return data;
}

/**
 * Tisíce s obyčajnou medzerou, ako v predlohe: `3 420`. `Intl` vracia úzku
 * nezalomiteľnú medzeru (U+202F) alebo nezalomiteľnú (U+00A0); obe sa tu
 * normalizujú, aby sa číslo kreslilo rovnako ako v mockupe.
 */
export function formatCount(value: number): string {
  return new Intl.NumberFormat('sk-SK').format(value).replace(/[\u202f\u00a0]/g, ' ');
}

/**
 * Čas obnovenia rozpočtu ako `HH:MM` v Európe/Bratislave. Deň ani hodinu
 * NIKDY nepočítame v UTC — appka aj používateľ žijú v miestnom čase a rozdiel
 * by sa prejavil len večer, keď to nikto netestuje.
 */
export function formatResumeTime(resumeAt: string | null): string {
  if (resumeAt === null) return '02:00';
  const at = new Date(resumeAt);
  if (!Number.isFinite(at.getTime())) return '02:00';
  return new Intl.DateTimeFormat('sk-SK', {
    timeZone: 'Europe/Bratislava',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

/* ═════════════════ Menovka fronty v hlavičke (tri stavy) ══════════════════ */

/** Priznaná medzera (kontrakt UI, bod 5). Nula ani slovo „prázdna" sem nepatrí. */
const DASH = '—';

/**
 * Tri stavy menovky, tá istá trojica ako `QueueMode` v dominante Prehľadu:
 *
 *  - `unknown` — odpoveď `/api/queue` sa nedala prečítať, alebo appka
 *    neodpovedala vôbec. Nevie sa NIČ, ani to, že je fronta prázdna.
 *  - `empty`   — server povedal `total === 0`. Zmeraný fakt, nie medzera.
 *  - `running` — vo fronte niečo je; kreslí sa zlomok.
 */
export type QueueHeaderKind = 'unknown' | 'empty' | 'running';

export interface QueueHeaderLabel {
  readonly kind: QueueHeaderKind;
  /** Text menovky. Pri `running` je zlomok osobitne v `fraction`. */
  readonly label: string;
  /** `3 420/8 000`; `null` v každom stave okrem `running`. */
  readonly fraction: string | null;
  /** Celá veta do `title` a do čítačky. */
  readonly title: string;
}

/**
 * Čo má hlavička o fronte napísať.
 *
 * Jediné pravidlo, ktoré sa tu nesmie pokaziť: `null` NIE JE nula. „Fronta
 * prázdna" je kladné tvrdenie, že na zápis nič nečaká — a hlavička stojí na
 * každej obrazovke appky, takže by to tvrdenie bolo všade. Keď appka čísla
 * nepozná, napíše pomlčku a povie to slovom.
 */
export function queueHeaderLabel(done: number | null, total: number | null): QueueHeaderLabel {
  if (done === null || total === null) {
    return {
      kind: 'unknown',
      label: `Fronta ${DASH} stav nevieme`,
      fraction: null,
      title:
        'Stav fronty sa nepodarilo prečítať. Nie je to to isté ako prázdna fronta — ' +
        'na zápis môžu čakať tisíce položiek. Klik otvorí Zľavy.',
    };
  }

  if (total === 0) {
    return {
      kind: 'empty',
      label: 'Fronta prázdna',
      fraction: null,
      title: 'Na zápis do shopu nečaká ani jedna položka. Klik otvorí Zľavy.',
    };
  }

  return {
    kind: 'running',
    label: 'Fronta',
    fraction: `${formatCount(done)}/${formatCount(total)}`,
    title: 'Súhrn všetkých bežiacich front — klik otvorí Zľavy',
  };
}
