/**
 * Aura Zľavy — formátovacie utility pre UI (§8, D13).
 *
 * Jazyk UI je slovenčina: dátumy `14. 8. 2026` (kontrakt UI bod 10), desatinná
 * čiarka, mena EUR. Čisté funkcie bez závislostí — bezpečné pre client aj
 * server komponenty.
 *
 * DÁTUM MÁ V UI JEDEN TVAR A JEDEN FORMÁTOVAČ
 * -------------------------------------------
 * Do 20. 8. 2026 boli v `lib/ui/` formátovače dátumu TRI: `formatDateSk`
 * (`14.08.2026`), `formatDayMonthSk` (`14.08.`) a `dayMonthSk` z
 * `lib/ui/vocabulary.ts` (`14. 8.`). Tri tvary toho istého dňa na jednej
 * obrazovke vyzerajú ako tri rôzne údaje — a `formatDayMonthSk` navyše
 * nekreslil NIKTO, takže sa jeho tvar nedal ani vidieť, ani opraviť.
 * Odteraz je formátovač jeden: `formatDateSk`.
 *
 * ČO SA TU SMIE TICHO POKAZIŤ
 * ---------------------------
 * 1. **ISO dátum na povrchu.** Keby sa `${c.dateTo}` dostalo do vety bez
 *    prechodu cez `formatDateSk`, appka napíše `2026-08-26`. Nič nespadne,
 *    nikto to nenahlási — a používateľ číta tvar, ktorý sa po slovensky
 *    nepíše. Stráži to `test/unit/datumy-povrch.spec.ts`.
 * 2. **Nula alebo dnešok namiesto pomlčky.** Neznámy dátum je `—`, nikdy
 *    dnešný deň ani `1. 1. 1970`. Vymyslený dátum je tvrdenie, pomlčka je
 *    priznanie.
 * 3. **Relatívny čas.** „pred 3 minútami" sa na povrch nepíše; `formatAgoSk`
 *    je preto určený VÝHRADNE do technických rozklikov.
 *
 * Štvrtý formátovač `formatDateOnlySk` žije v `lib/domain/dates.ts` a stále
 * vracia `05.08.2026`. Slúži hláškam odmietnutých zápisov (`domain/campaign-rules.ts`),
 * ktoré sa podľa šprintu 19. 8. 2026 nesmú skracovať ani prepisovať — jeho
 * zjednotenie je samostatné rozhodnutie, nie vedľajší účinok tohto súboru.
 */

/**
 * `YYYY-MM-DD` alebo ISO datetime alebo `Date` → `14. 8. 2026`.
 *
 * Jediný formátovač dátumu v UI. Bez vodiacich núl a s medzerou po bodke —
 * tak sa dátum po slovensky píše a tak ho predpisuje kontrakt UI bod 10.
 */
export function formatDateSk(value: string | Date | null | undefined): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (m) return `${Number(m[3])}. ${Number(m[2])}. ${m[1]}`;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : formatDateSk(d);
  }
  return `${value.getDate()}. ${value.getMonth() + 1}. ${value.getFullYear()}`;
}

/** ISO datetime / Date → `14. 8. 2026 12:53` (lokálny čas prehliadača/servera). */
export function formatDateTimeSk(value: string | Date | null | undefined): string {
  if (value == null || value === '') return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${formatDateSk(d)} ${hh}:${mi}`;
}

/**
 * Peňažný reťazec (`"12.90"`) → `"12,90 €"` — desatinná čiarka, medzera, €.
 * Neplatný vstup vráti `—` (nikdy nevymýšľame cenu).
 */
export function formatEur(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  const [int, frac] = n.toFixed(2).split('.');
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${grouped},${frac} €`;
}

/** Celé percento → `"−15 %"` (so znamienkom zľavy). */
export function formatPercentSk(percent: number): string {
  return `−${percent} %`;
}

/**
 * Sekundy → slovenský odpočet: `"47 h 12 min"`, `"58 min"`, `"42 s"`.
 * Záporné/nulové → `"expirovaný"`.
 */
export function formatCountdownSk(secondsLeft: number | null | undefined): string {
  if (secondsLeft == null) return '—';
  // U11: NaN/Infinity (napr. z rozbitého `expiresAt`) nesmie dať „NaN h NaN min".
  if (!Number.isFinite(secondsLeft)) return '—';
  if (secondsLeft <= 0) return 'expirovaný';
  const s = Math.floor(secondsLeft);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s % 60} s`;
  return `${s} s`;
}

/** Sekundy od udalosti → `"pred X min"` / `"pred chvíľou"`. */
export function formatAgoSk(ageSeconds: number | null | undefined): string {
  if (ageSeconds == null) return 'nikdy';
  if (ageSeconds < 60) return 'pred chvíľou';
  const min = Math.floor(ageSeconds / 60);
  if (min < 60) return `pred ${min} min`;
  const h = Math.floor(min / 60);
  return `pred ${h} h ${min % 60} min`;
}
