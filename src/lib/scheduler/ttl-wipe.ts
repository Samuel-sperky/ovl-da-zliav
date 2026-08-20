/**
 * Aura Zľavy — TTL wipe kľúča, PRVÝ krok každého ticku (D63, §9 krok 2).
 *
 * Kľúč expirovaný podľa `expires_at ≤ now` sa wipne aj vtedy, keď sa appky
 * nikto nedotkne — nečaká sa na lazy kontrolu pri prístupe. Wipe procedúru
 * (prepis ciphertextu náhodnými dátami → DELETE → audit `key_wiped`) vlastní
 * `api-key.repo` (A1); tento modul ju len deterministicky spúšťa.
 *
 * Beží ako prvý krok, aby ŽIADNY ďalší krok ticku nepoužil expirovaný kľúč.
 *
 * Vlastník: A10.
 */
import type { ApiKeyRepo, Logger, UtcDate } from '@/contracts';

export interface TtlWipeDeps {
  apiKey: Pick<ApiKeyRepo, 'getMeta' | 'wipe'>;
  log: Logger;
}

/**
 * @returns `true` keď bol v tomto ticku kľúč wipnutý pre expirované TTL.
 */
export async function runTtlWipe(deps: TtlWipeDeps, now: UtcDate): Promise<boolean> {
  const meta = await deps.apiKey.getMeta();
  if (!meta.present) return false;
  if (!meta.expiresAt || meta.expiresAt.getTime() > now.getTime()) return false;

  const wiped = await deps.apiKey.wipe('ttl_expired');
  if (wiped) {
    deps.log.warn('scheduler_key_ttl_wiped', {
      expiresAt: meta.expiresAt.toISOString(),
    });
  }
  return wiped;
}
