/**
 * Aura Zľavy — formátovacie utility pre UI (§8, D13).
 *
 * Jazyk UI je slovenčina: dátumy `DD.MM.YYYY`, desatinná čiarka, mena EUR.
 * Čisté funkcie bez závislostí — bezpečné pre client aj server komponenty.
 */

/** `YYYY-MM-DD` alebo ISO datetime alebo `Date` → `DD.MM.YYYY`. */
export function formatDateSk(value: string | Date | null | undefined): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (m) return `${m[3]}.${m[2]}.${m[1]}`;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : formatDateSk(d);
  }
  const dd = String(value.getDate()).padStart(2, '0');
  const mm = String(value.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${value.getFullYear()}`;
}

/** Skrátený tvar `DD.MM.` pre badge „podľa vlastného zápisu z DD.MM." (D7). */
export function formatDayMonthSk(value: string | Date | null | undefined): string {
  const full = formatDateSk(value);
  if (full === '—') return full;
  return full.slice(0, 6); // "DD.MM."
}

/** ISO datetime / Date → `DD.MM.YYYY HH:MM` (lokálny čas prehliadača/servera). */
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
