/**
 * Aura Zľavy — runtime enum `event_type` pre `audit_log` (BUILD-SPEC §3).
 *
 * `src/contracts.ts` (A0) drží TYP `AuditEventType`; runtime zoznam úmyselne
 * patrí sem (viď hlavička contracts.ts). Oba zdroje sú zosúladené typovou
 * kontrolou nižšie — pridanie hodnoty len na jednom mieste NEPREJDE typecheckom.
 *
 * Audit je append-only (I4, D74, D75): tento modul nič nemaže a nemení, len
 * pomenúva. Zápis ide výhradne cez `lib/audit/write.ts`.
 *
 * Vlastník: A2.
 */
import type { AuditActor, AuditEventType } from '@/contracts';

/** `audit_log.event_type` je `VARCHAR(48)` (§3). */
export const AUDIT_EVENT_TYPE_MAX_LENGTH = 48;

/** Presný zoznam z BUILD-SPEC §3, v tom istom poradí. */
export const AUDIT_EVENT_TYPES = [
  // autentifikácia (D68–D71)
  'login_ok',
  'login_fail',
  'lockout',
  'logout',
  'sudo_ok',
  'sudo_fail',
  // API kľúč (R2, D51–D53, D63, D67)
  'key_stored',
  'key_verified',
  'key_wiped',
  'key_panic_wipe',
  // nastavenia, allowlist, katalóg (D80, I2, D56–D57)
  'domain_changed',
  'allowlist_added',
  'allowlist_removed',
  'allowlist_marked_unknown',
  'catalog_refreshed',
  'canary_ok',
  'canary_fail',
  // životný cyklus kampane (D83, O1)
  'campaign_created',
  'campaign_confirmed',
  'campaign_cancelled',
  'campaign_claimed',
  'campaign_needs_key',
  'campaign_missed',
  'campaign_lapsed',
  'campaign_from_shifted',
  'campaign_finished',
  // zápis do shopu (D46, D50, D54)
  'write_attempt',
  'write_ok',
  'write_failed',
  'write_uncertain',
  'write_skipped',
  'schema_drift',
  // prevádzka (D79, D86, D88)
  'writes_locked',
  'writes_unlocked',
  'reconcile_uncertain',
  'migration_applied',
  'boot',
  'shutdown',
] as const satisfies readonly AuditEventType[];

/* ─────────── zosúladenie s `src/contracts.ts` (kontrola pri kompilácii) ──────────── */

type ListedEvent = (typeof AUDIT_EVENT_TYPES)[number];
/** Hodnoty, ktoré sú v kontrakte, ale chýbajú v zozname vyššie. */
type MissingFromList = Exclude<AuditEventType, ListedEvent>;
/** Hodnoty, ktoré sú v zozname, ale nie sú v kontrakte. */
type MissingFromContract = Exclude<ListedEvent, AuditEventType>;

/**
 * Keď sa zoznamy rozídu, tento riadok prestane kompilovať — presne to chceme,
 * pretože `event_type` je súčasťou DB kontraktu (§3).
 */
const _eventListMatchesContract: [MissingFromList, MissingFromContract] extends [never, never]
  ? true
  : never = true;
void _eventListMatchesContract;

/* ─────────────────────────────── pomocníci ─────────────────────────────── */

const EVENT_SET: ReadonlySet<string> = new Set<string>(AUDIT_EVENT_TYPES);

export function isAuditEventType(value: unknown): value is AuditEventType {
  return typeof value === 'string' && EVENT_SET.has(value);
}

export const AUDIT_ACTORS = ['user', 'scheduler', 'system'] as const satisfies readonly AuditActor[];

export function isAuditActor(value: unknown): value is AuditActor {
  return value === 'user' || value === 'scheduler' || value === 'system';
}

/**
 * Ergonomický prístup k hodnotám: `AuditEvent.WRITE_OK` namiesto `'write_ok'`.
 * Zabraňuje tichým typom v stringoch na strane volajúcich modulov.
 */
export const AuditEvent = {
  LOGIN_OK: 'login_ok',
  LOGIN_FAIL: 'login_fail',
  LOCKOUT: 'lockout',
  LOGOUT: 'logout',
  SUDO_OK: 'sudo_ok',
  SUDO_FAIL: 'sudo_fail',
  KEY_STORED: 'key_stored',
  KEY_VERIFIED: 'key_verified',
  KEY_WIPED: 'key_wiped',
  KEY_PANIC_WIPE: 'key_panic_wipe',
  DOMAIN_CHANGED: 'domain_changed',
  ALLOWLIST_ADDED: 'allowlist_added',
  ALLOWLIST_REMOVED: 'allowlist_removed',
  ALLOWLIST_MARKED_UNKNOWN: 'allowlist_marked_unknown',
  CATALOG_REFRESHED: 'catalog_refreshed',
  CANARY_OK: 'canary_ok',
  CANARY_FAIL: 'canary_fail',
  CAMPAIGN_CREATED: 'campaign_created',
  CAMPAIGN_CONFIRMED: 'campaign_confirmed',
  CAMPAIGN_CANCELLED: 'campaign_cancelled',
  CAMPAIGN_CLAIMED: 'campaign_claimed',
  CAMPAIGN_NEEDS_KEY: 'campaign_needs_key',
  CAMPAIGN_MISSED: 'campaign_missed',
  CAMPAIGN_LAPSED: 'campaign_lapsed',
  CAMPAIGN_FROM_SHIFTED: 'campaign_from_shifted',
  CAMPAIGN_FINISHED: 'campaign_finished',
  WRITE_ATTEMPT: 'write_attempt',
  WRITE_OK: 'write_ok',
  WRITE_FAILED: 'write_failed',
  WRITE_UNCERTAIN: 'write_uncertain',
  WRITE_SKIPPED: 'write_skipped',
  SCHEMA_DRIFT: 'schema_drift',
  WRITES_LOCKED: 'writes_locked',
  WRITES_UNLOCKED: 'writes_unlocked',
  RECONCILE_UNCERTAIN: 'reconcile_uncertain',
  MIGRATION_APPLIED: 'migration_applied',
  BOOT: 'boot',
  SHUTDOWN: 'shutdown',
} as const satisfies Record<string, AuditEventType>;

/* ────────────────────────────── skupiny ─────────────────────────────────── */

/**
 * Runaway strop (D79, I12) sa počíta VÝHRADNE z týchto dvoch eventov —
 * `audit_log` je append-only, takže počítadlo sa nedá obísť (O3).
 */
export const RUNAWAY_COUNTED_EVENTS = ['write_ok', 'write_uncertain'] as const satisfies readonly AuditEventType[];

/** Výsledok pokusu o zápis jednej položky dávky (§9). */
export const WRITE_OUTCOME_EVENTS = [
  'write_ok',
  'write_failed',
  'write_uncertain',
  'write_skipped',
] as const satisfies readonly AuditEventType[];

/** Eventy, ktoré znamenajú, že kľúč prestal existovať (D51, D52, D63, D67). */
export const KEY_WIPE_EVENTS = ['key_wiped', 'key_panic_wipe'] as const satisfies readonly AuditEventType[];

/* ──────────────────── slovenské názvy pre audit stránku (D18) ───────────── */

/**
 * Popisky pre UI filter a tabuľku auditu (D18). Držíme ich pri enume, aby
 * nevznikli dva rozdielne preklady toho istého eventu.
 */
export const AUDIT_EVENT_LABEL_SK: Record<AuditEventType, string> = {
  login_ok: 'Prihlásenie — úspech',
  login_fail: 'Prihlásenie — zlyhanie',
  lockout: 'Blokovanie prihlásenia',
  logout: 'Odhlásenie',
  sudo_ok: 'Potvrdenie heslom — úspech',
  sudo_fail: 'Potvrdenie heslom — zlyhanie',
  key_stored: 'API kľúč uložený',
  key_verified: 'API kľúč overený sondou',
  key_wiped: 'API kľúč vymazaný',
  key_panic_wipe: 'API kľúč vymazaný — panic button',
  domain_changed: 'Zmena domény shopu',
  allowlist_added: 'Produkt pridaný do allowlistu',
  allowlist_removed: 'Produkt odobraný z allowlistu',
  allowlist_marked_unknown: 'Produkt označený ako neznámy',
  catalog_refreshed: 'Katalóg obnovený',
  canary_ok: 'Test spojenia — úspech',
  canary_fail: 'Test spojenia — zlyhanie',
  campaign_created: 'Kampaň vytvorená',
  campaign_confirmed: 'Kampaň potvrdená',
  campaign_cancelled: 'Kampaň zrušená',
  campaign_claimed: 'Kampaň prevzatá schedulerom',
  campaign_needs_key: 'Kampaň čaká na API kľúč',
  campaign_missed: 'Kampaň prepadla (missed)',
  campaign_lapsed: 'Kampaň prepadla (lapsed)',
  campaign_from_shifted: 'Začiatok kampane posunutý',
  campaign_finished: 'Kampaň dokončená',
  write_attempt: 'Pokus o zápis zľavy',
  write_ok: 'Zápis zľavy — úspech',
  write_failed: 'Zápis zľavy — zlyhanie',
  write_uncertain: 'Zápis zľavy — stav neistý',
  write_skipped: 'Zápis zľavy — preskočené',
  schema_drift: 'Shop API sa zmenilo (schema drift)',
  writes_locked: 'Zápisy zamknuté',
  writes_unlocked: 'Zápisy odomknuté',
  reconcile_uncertain: 'Reconciliácia — stav neistý',
  migration_applied: 'Migrácia aplikovaná',
  boot: 'Štart aplikácie',
  shutdown: 'Ukončenie aplikácie',
};

/** Popisok pre UI; neznámy event (starý riadok v DB) sa zobrazí ako je. */
export function auditEventLabelSk(eventType: string): string {
  return isAuditEventType(eventType) ? AUDIT_EVENT_LABEL_SK[eventType] : eventType;
}
