'use client';

/**
 * Aura Zľavy — jediný zdroj pravdy o tom, či UI smie ponúknuť zápis (D10, D79).
 *
 * Plán §2 bod 16: v režime len na čítanie sú VŠETKY mutácie vypnuté s dôvodom;
 * čítanie, audit a „Obnoviť z shopu" fungujú ďalej. Do redizajnu túto bránu
 * nemal nikto — `READ_ONLY_TOOLTIP` (A13) nemal jediného konzumenta a formulár
 * novej kampane sa dal celý vyplniť, aby na konci spadol na hlášku o shope.
 *
 * Zdroj stavu je `/api/health` (`useHealth`, A13): kľúč (`present`,`expiresAt`)
 * a zámok zápisov po prekročení 60 zápisov/h (D79). Brána je čisto UI vrstva —
 * server zostáva fail-closed sám o sebe (I3, I13), tu ide o to, aby appka
 * varovala DOPREDU a nie až po vykonanej práci.
 *
 * ČO SEM ZÁMERNE NEPATRÍ: `writesEnabled=false` (dev režim, D77/I13). Ten je
 * vlastnosťou prostredia, nie stavom kľúča — appka v ňom smie celý dvojkrok
 * prejsť a odmietnutie príde zo servera s vlastnou hláškou.
 *
 * Vlastník: B3. B2/B4 môžu importovať bez zmien.
 */
import { useHealth } from '@/components/layout/health';
import { READ_ONLY_TOOLTIP } from '@/components/layout/ReadOnlyNotice';

export interface WriteGate {
  /** `false` = zapisovacie akcie musia byť vypnuté (nie skryté). */
  canWrite: boolean;
  /** Slovenský dôvod do `Button disabledReason`; `undefined` keď sa smie. */
  reason?: string;
  /** Prebieha prvé načítanie stavu — nič sa ešte nevypína, aby UI neblikalo. */
  loading: boolean;
  /** Kľúč je uložený a neexpirovaný. */
  keyPresent: boolean;
}

export const WRITES_LOCKED_TOOLTIP =
  'Zápisy sú zamknuté po prekročení hodinového stropu — odomkni ich heslom v Nastaveniach.';

export const HEALTH_UNKNOWN_TOOLTIP =
  'Stav appky sa nepodarilo overiť — zapisovacie akcie sú pre istotu vypnuté.';

export const NOT_AUTHENTICATED_TOOLTIP =
  'Nie si prihlásený — zapisovacie akcie sú vypnuté, kým sa neprihlásiš.';

/**
 * Brána pre zapisovacie akcie. Pri prvom načítaní (`loading`) sa nič nevypína;
 * hneď ako je stav známy, rozhoduje kľúč a zámok zápisov.
 */
export function useWriteGate(pollMs = 30_000): WriteGate {
  const { health, loading, unreachable, unauthenticated } = useHealth(pollMs);

  if (loading) return { canWrite: true, loading: true, keyPresent: false };

  /* Chýbajúca session je stále fail-closed (I13 sa nemení), len dôvod je
     pravdivý — nehlásime poruchu appky tam, kde žiadna nie je. */
  if (unauthenticated) {
    return {
      canWrite: false,
      reason: NOT_AUTHENTICATED_TOOLTIP,
      loading: false,
      keyPresent: false,
    };
  }

  if (unreachable || !health) {
    return { canWrite: false, reason: HEALTH_UNKNOWN_TOOLTIP, loading: false, keyPresent: false };
  }

  const expired =
    health.key.expiresAt != null && new Date(health.key.expiresAt).getTime() <= Date.now();
  const keyPresent = health.key.present && !expired;

  if (!keyPresent) {
    return { canWrite: false, reason: READ_ONLY_TOOLTIP, loading: false, keyPresent: false };
  }
  if (health.writesLocked) {
    return { canWrite: false, reason: WRITES_LOCKED_TOOLTIP, loading: false, keyPresent: true };
  }
  return { canWrite: true, loading: false, keyPresent: true };
}
