/**
 * Aura Zľavy — pripomienkové pásma 48/24/2 h pred `fire_at` (D26, §9 krok 6)
 * a pripomienka deň pred expiráciou kľúča pri bežiacej fronte (KONTRAKT V3: K6).
 *
 * Pripomienka sa NIKAM neposiela (bez SMTP, D17) — scheduler ju len vypočíta
 * a odloží do in-process stavu, odkiaľ si ju číta `/api/notifications`
 * a dashboard banner („vlož kľúč pre kampaň X").
 *
 * Vlastník: A10 (pásma), V7 (kľúč vs. fronta, K6).
 */
import type { Reminder, ReminderBand, UtcDate } from '@/contracts';

import { hoursUntil } from '@/lib/domain/dates';

import type { SchedulerCampaign } from './types';

/** Pásma od najmenšieho — kampaň dostane NAJBLIŽŠIE (najmenšie) pásmo (D26). */
export const REMINDER_BANDS: readonly ReminderBand[] = [2, 24, 48];

/**
 * Pásmo pre daný počet hodín do fire: `≤2 → 2`, `≤24 → 24`, `≤48 → 48`,
 * inak žiadne. Hodnoty `≤ 0` už nie sú pripomienka (kampaň je due/missed).
 */
export function bandFor(hoursLeft: number): ReminderBand | null {
  if (hoursLeft <= 0) return null;
  for (const band of REMINDER_BANDS) {
    if (hoursLeft <= band) return band;
  }
  return null;
}

/**
 * Vypočíta pripomienky pre kampane čakajúce na fire. Berú sa stavy
 * `scheduled` (blíži sa fire) aj `needs_key` (fire už čaká na kľúč) —
 * presne pre ne banner „vlož kľúč pre kampaň X" existuje.
 */
export function computeReminders(
  campaigns: readonly SchedulerCampaign[],
  now: UtcDate,
): Reminder[] {
  const out: Reminder[] = [];
  for (const c of campaigns) {
    if (c.status !== 'scheduled' && c.status !== 'needs_key') continue;
    if (!c.fireAt) continue;
    const band = bandFor(hoursUntil(c.fireAt, now));
    if (band == null) continue;
    out.push({ campaignId: c.id, name: c.name, band, fireAt: c.fireAt });
  }
  out.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime() || a.campaignId - b.campaignId);
  return out;
}

/**
 * D8 — kampane ohrozené tým, že kľúč expiruje SKÔR, než sa majú zapísať.
 * Čistá funkcia: volajúci dodá zoznam čakajúcich kampaní a koniec platnosti
 * kľúča (`null` = kľúč vôbec nie je uložený → ohrozené sú všetky).
 *
 * Toto nie je pripomienka podľa pásiem (D26), ale samostatná trieda rizika:
 * kampaň môže byť ďaleko za pásmom 48 h a napriek tomu byť odsúdená na
 * `needs_key`. Banner na dashboarde ich agreguje spolu (D8).
 */
export function computeAtRisk(
  campaigns: readonly SchedulerCampaign[],
  keyExpiresAt: UtcDate | null,
): Array<{ campaignId: number; name: string; fireAt: UtcDate }> {
  const out: Array<{ campaignId: number; name: string; fireAt: UtcDate }> = [];
  for (const c of campaigns) {
    if (c.status !== 'scheduled') continue;
    if (!c.fireAt) continue;
    if (keyExpiresAt !== null && c.fireAt.getTime() <= keyExpiresAt.getTime()) continue;
    out.push({ campaignId: c.id, name: c.name, fireAt: c.fireAt });
  }
  out.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime() || a.campaignId - b.campaignId);
  return out;
}

/* ═════════════ K6 — kľúč vypršie skôr, než fronta dobehne ═════════════════ */

/**
 * K6 — „Deň pred expiráciou kľúča pri bežiacej fronte sa vytvorí pripomienka."
 * 24 h je teda konštanta z kontraktu, nie odhad.
 */
export const KEY_EXPIRY_REMINDER_HOURS = 24;

export interface KeyExpiryReminder {
  expiresAt: UtcDate;
  /** Koľko hodín zostáva. Vždy > 0 — po expirácii to už nie je pripomienka. */
  hoursLeft: number;
  /** Koľko zliav práve čaká vo fronte (kvôli nim pripomienka vznikla). */
  queuedCampaigns: number;
  /** Koľko produktov ešte čaká na zápis; `null` = nevieme (číslo sa nehádže). */
  pendingItems: number | null;
}

export interface KeyExpiryInput {
  /** Koniec platnosti kľúča na zápis. `null` = kľúč nie je uložený. */
  keyExpiresAt: UtcDate | null;
  /** Počet kampaní vo fronte (`queued`) — bez nich niet čo pripomínať. */
  queuedCampaigns: number;
  pendingItems?: number | null;
  now: UtcDate;
  thresholdHours?: number;
}

/**
 * K6 — pripomienka, keď kľúč na zápis vyprší do 24 h A fronta má čo zapisovať.
 *
 * Čistá funkcia bez DB. Prázdna fronta pripomienku NEDÁVA: expirujúci kľúč bez
 * rozrobenej zľavy je bežný stav (TTL 48 h) a banner, ktorý svieti stále, sa
 * prestane čítať. Chýbajúci kľúč tiež nie — to nie je „vyprší", to je
 * „nie je" a hovorí o tom stav kľúča v hlavičke (D5, D10).
 */
export function computeKeyExpiryReminder(input: KeyExpiryInput): KeyExpiryReminder | null {
  if (input.keyExpiresAt === null) return null;
  if (input.queuedCampaigns <= 0) return null;

  const hoursLeft = hoursUntil(input.keyExpiresAt, input.now);
  if (hoursLeft <= 0) return null;
  if (hoursLeft > (input.thresholdHours ?? KEY_EXPIRY_REMINDER_HOURS)) return null;

  return {
    expiresAt: input.keyExpiresAt,
    hoursLeft,
    queuedCampaigns: input.queuedCampaigns,
    pendingItems: input.pendingItems ?? null,
  };
}

/* ───────────────── in-process stav pre /api/notifications ──────────────── */

let active: Reminder[] = [];
let activeKeyExpiry: KeyExpiryReminder | null = null;

export function setActiveReminders(reminders: Reminder[]): void {
  active = reminders;
}

/** Aktuálne pripomienky — číta ich `/api/notifications` (A12) a UI (A15). */
export function getActiveReminders(): readonly Reminder[] {
  return active;
}

/** K6 — pripomienka o kľúči vs. fronte. `null` = nie je čo pripomínať. */
export function setActiveKeyExpiryReminder(reminder: KeyExpiryReminder | null): void {
  activeKeyExpiry = reminder;
}

export function getActiveKeyExpiryReminder(): KeyExpiryReminder | null {
  return activeKeyExpiry === null ? null : { ...activeKeyExpiry };
}

/** Výhradne pre testy. */
export function resetActiveReminders(): void {
  active = [];
  activeKeyExpiry = null;
}
