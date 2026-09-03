/**
 * Aura Zľavy — ČÍTANIE DENNÉHO PREDAJA PRE GRAF PREHĽADU (V7, krok 2/4).
 *
 * Jedna odpoveď (`GET /api/insights/sales-daily?window=7|30|90`) prečítaná
 * tak, aby sa z nej nedalo vyrobiť číslo, ktoré v nej nie je. Čisto čítacie,
 * žiadne volanie shopu (K8).
 *
 * PREČO SA ČÍTAJÚ DVE POLIA, A NIE JEDNO
 * ──────────────────────────────────────
 * `days` nesie LEN dni, ktoré sa naozaj sťahovali — deň bez sťahovania
 * v odpovedi CHÝBA a nulu nedostane. `gaps.days` naopak nesie riadok pre
 * KAŽDÝ deň okna aj s tým, čo o ňom appka vie (`complete` / `partial` /
 * `pending` / `missing`). Bez druhého poľa by graf vedel len to, že niekde
 * diera je, nie KDE — a os by sa stiahla na dni, ktoré niečo priniesli, čím by
 * výpadok sťahovania zmizol z obrazovky.
 *
 * ČO SA TU SMIE TICHO POKAZIŤ
 * ───────────────────────────
 *
 *  1. **Nečitateľná odpoveď sa prečíta „na polovicu".** Preto je návratová
 *     hodnota `null`, nie čiastočný pohľad: chýbajúce okno alebo chýbajúce
 *     `gaps` znamená, že graf nemá ako povedať, čo nemeral. `null` = „nedalo sa
 *     prečítať", prázdny rad = „odpoveď prišla a bola bez dní"; sú to dve rôzne
 *     veci a obrazovka na ne kreslí dve rôzne vety.
 *  2. **Deň s pokazeným `status` sa berie za meranie.** `status` sa NEDOPĹŇA:
 *     riadok bez `complete`/`partial` sa zahodí. Náhradná hodnota mierila
 *     v tomto repe už raz nesprávnym smerom (`?? 'complete'` v route) a robila
 *     z „nevieme" meranie.
 *  3. **`units` príde ako text.** `readCount()` prijme len konečné nezáporné
 *     celé číslo; `'0'` ani `NaN` meraním nie sú.
 *
 * Vlastník: V7, krok 2/4 (graf troch kriviek).
 */
import type { OverviewWindow } from '@/components/dashboard/overview-model';
import { asRecord, readCode, readCount, readText } from '@/components/dashboard/json';
import type {
  SplitCoverageInput,
  SplitDayInput,
} from '@/components/dashboard/discount-split-view';
import { fetchJson } from '@/components/layout/health';

/** Stavy sťahovania dňa tak, ako ich pozná server (`SalesDayCoverage`). */
const COVERAGE_CODES = ['missing', 'pending', 'partial', 'complete'] as const;

/** Stav riadku `days`. Iné hodnoty route neposiela a dopĺňať sa nesmú. */
const DAY_STATUSES = ['complete', 'partial'] as const;

export interface SalesDailyView {
  /** Dnešok podľa servera, v logickom pásme. */
  today: string;
  /** Okno prepínača tak, ako sa naozaj použilo. */
  from: string;
  to: string;
  windowDays: number;
  /** Dni, ktoré sa sťahovali, s kusmi. Deň bez sťahovania tu NIE JE. */
  days: SplitDayInput[];
  /** Riadok pre KAŽDÝ deň okna a to, čo o ňom appka vie. */
  coverage: SplitCoverageInput[];
  /** Koľko dní okna nemáme (`gaps.unknownDays`) — priznanie, nie poznámka. */
  unknownDays: number;
}

/**
 * Odpoveď → pohľad grafu. `null` pri čomkoľvek, čo sa nedá prečítať celé.
 *
 * Porovnáva sa výslovne (`=== null`) — skrátený guard tu Turbopack už raz
 * vyhodnotil ako compile-time falsy a obrazovka potom kreslila nuly.
 */
export function parseSalesDaily(raw: unknown): SalesDailyView | null {
  const root = asRecord(raw);
  if (root === null) return null;

  const today = readText(root, 'today');
  const windowRaw = asRecord(root['window']);
  const gapsRaw = asRecord(root['gaps']);
  if (today === null || windowRaw === null || gapsRaw === null) return null;

  const from = readText(windowRaw, 'from');
  const to = readText(windowRaw, 'to');
  const windowDays = readCount(windowRaw, 'days');
  if (from === null || to === null || windowDays === null) return null;

  const days: SplitDayInput[] = [];
  const rawDays = root['days'];
  if (!Array.isArray(rawDays)) return null;
  for (const entry of rawDays) {
    const row = asRecord(entry);
    if (row === null) continue;
    const day = readText(row, 'day');
    const units = readCount(row, 'units');
    /* Stav sa NEDOPĹŇA: riadok, ktorý nehovorí, či je deň dočítaný, nie je
       ani meranie, ani dolná hranica — a hádať sa tu nedá. */
    const status = readCode(row, 'status', DAY_STATUSES);
    if (day === null || units === null || status === null) continue;
    days.push({ day, units, status });
  }

  const coverage: SplitCoverageInput[] = [];
  const rawCoverage = gapsRaw['days'];
  if (!Array.isArray(rawCoverage)) return null;
  for (const entry of rawCoverage) {
    const row = asRecord(entry);
    if (row === null) continue;
    const day = readText(row, 'day');
    const code = readCode(row, 'coverage', COVERAGE_CODES);
    if (day === null || code === null) continue;
    coverage.push({ day, coverage: code });
  }

  return {
    today,
    from,
    to,
    windowDays,
    days,
    coverage,
    unknownDays: readCount(gapsRaw, 'unknownDays') ?? 0,
  };
}

export async function getSalesDaily(windowDays: OverviewWindow): Promise<SalesDailyView | null> {
  return parseSalesDaily(await fetchJson(`/api/insights/sales-daily?window=${windowDays}`));
}

export default getSalesDaily;
