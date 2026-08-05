/**
 * Aura Zľavy — pripomienkové pásma 48/24/2 h pred `fire_at` (D26, §9 krok 6).
 *
 * Pripomienka sa NIKAM neposiela (bez SMTP, D17) — scheduler ju len vypočíta
 * a odloží do in-process stavu, odkiaľ si ju číta `/api/notifications`
 * a dashboard banner („vlož kľúč pre kampaň X").
 *
 * Vlastník: A10.
 */
import type { CampaignRecord, Reminder, ReminderBand, UtcDate } from '@/contracts';

import { hoursUntil } from '@/lib/domain/dates';

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
export function computeReminders(campaigns: readonly CampaignRecord[], now: UtcDate): Reminder[] {
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
  campaigns: readonly CampaignRecord[],
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

/* ───────────────── in-process stav pre /api/notifications ──────────────── */

let active: Reminder[] = [];

export function setActiveReminders(reminders: Reminder[]): void {
  active = reminders;
}

/** Aktuálne pripomienky — číta ich `/api/notifications` (A12) a UI (A15). */
export function getActiveReminders(): readonly Reminder[] {
  return active;
}

/** Výhradne pre testy. */
export function resetActiveReminders(): void {
  active = [];
}
