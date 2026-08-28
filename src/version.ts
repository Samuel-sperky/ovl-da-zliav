/**
 * Aura Zľavy — identita aplikácie (D58, R10).
 *
 * `APP_VERSION` sa drží v sync s `package.json` (verzia je normatívna pre
 * `User-Agent`, ktorý shop vidí pri každom volaní). `env.APP_VERSION` z neho
 * berie default, takže v kontajneri sa dá prebiť bez rebuildu.
 */

/** Technický názov v `User-Agent` (D58). */
export const APP_SLUG = 'aura-zlavy';

/** Zobrazovaný názov v UI (R10). */
export const APP_DISPLAY_NAME = 'Aura Zľavy';

/** Verzia — musí sa rovnať `version` v `package.json`. */
export const APP_VERSION = '0.1.0';

/* 27. 8. 2026 (D99): `SESSION_COOKIE_NAME = 'ovl_zliav_session'` zmazané.
   App session je zmazaná z kódu a appka taký cookie už nevydáva; názov žije
   len v histórii rozhodnutí (docs/10-KONTRAKT.md R10, D69). */

/** Názov DB advisory locku pre migrácie (D88). */
export const MIGRATION_LOCK_NAME = 'ovl_zliav_migrate';

/** Názov DB advisory locku pre zápisové operácie (D37, I12). */
export const WRITE_LOCK_NAME = 'ovl_zliav_write';

/** AAD prefix pre AES-256-GCM záznam API kľúča (§7). */
export const API_KEY_AAD_PREFIX = 'ovl_zliav:api_key:v';

/** `User-Agent` posielaný shopu pri každom volaní (D58). */
export function userAgent(version: string = APP_VERSION): string {
  return `${APP_SLUG}/${version}`;
}
