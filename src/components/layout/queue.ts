'use client';

/**
 * Aura Zľavy — dáta pre pravú stranu hlavičky: denný rozpočet zápisov a stav
 * fronty (ARCHITEKTURA §0, K2).
 *
 * Endpoint `/api/queue` dodáva V8 a v čase písania tohto modulu ešte
 * neexistuje. Preto je tu tenký typovaný fetch s BEZPEČNÝM fallbackom: čokoľvek
 * neznáme, chýbajúce alebo nesprávne otypované sa mapuje na `null` a hlavička
 * to prizná („Fronta prázdna", rozpočet ako pomlčka). NIKDY sa nedopĺňa
 * vymyslené číslo — hlavička o zápisoch do produkčného shopu nesmie tvrdiť nič,
 * čo nevie.
 *
 * Očakávaný tvar (požiadavka na V8):
 *   GET /api/queue → { ok: true, data: {
 *     writes: { spentToday: number, budget: number, resumeAt: string | null },
 *     queue:  { done: number, total: number, campaigns: number }
 *   }}
 * `resumeAt` je ISO čas najbližšieho obnovenia rozpočtu (reset 02:00 miestneho
 * času). `total === 0` znamená prázdnu frontu — nie chýbajúce dáta.
 */
import { useCallback, useEffect, useState } from 'react';

import { fetchJson } from '@/components/layout/health';

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
 * Ťahá `/api/queue` (default každých 60 s). Kým endpoint neexistuje, vracia
 * `UNKNOWN_QUEUE_HEADER` — appka kvôli tomu nesmie nič predstierať ani padnúť.
 */
export function useQueueHeader(pollMs = 60_000): QueueHeaderData {
  const [data, setData] = useState<QueueHeaderData>(UNKNOWN_QUEUE_HEADER);

  const load = useCallback(async () => {
    const body = await fetchJson<unknown>('/api/queue');
    setData(parseQueueHeader(body));
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), pollMs);
    return () => clearInterval(id);
  }, [load, pollMs]);

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
