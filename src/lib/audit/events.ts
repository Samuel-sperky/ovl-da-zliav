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
  /*
   * HISTORICKÉ udalosti — appka ich od 27. 8. 2026 už NEZAPISUJE. Prihlásenie
   * a lockout zmizli (D99), sudo zrušilo D100, takže neexistuje kód, ktorý by
   * niektorú z nich vyrobil.
   *
   * Zo zoznamu ich napriek tomu NEMAŽEME: `audit_log` sa nemení (D101), takže
   * riadky z obdobia pred 27. 8. 2026 v ňom fyzicky zostávajú. Bez týchto
   * hodnôt by `isAuditEventType()` povedalo o vlastnej minulosti appky „toto
   * nepoznám" a História by ju nedokázala pomenovať — a „nevieme" je horšie
   * než odpoveď (I11). To isté platí pre popisky v `AUDIT_EVENT_LABEL_SK`.
   */
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
  'scope_mode_changed',
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
  'queue_resumed',
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
  /*
   * presety (D112, KONTRAKT-V4-2026-08-28)
   *
   * Preset je pomenovaná kombinácia filtra, pásiem s percentami a dĺžky okna.
   * Do shopu nezapisuje nič a nič neuvoľňuje — auditujú sa preto, že nesú
   * PERCENTÁ, ktoré niekto o mesiac naklikne jedným klikom, a I4 (D102) žiada
   * záznam o každej mutácii. `audit_log.event_type` je `VARCHAR(48)`, nie ENUM
   * (hlavička 0006), takže tieto dve hodnoty žiadnu migráciu nepotrebovali.
   *
   * POUŽITIE presetu tu ZÁMERNE nie je: `discount_presets.last_used_at` je sám
   * záznamom o použití, je vidieť na obrazovke a zápis toho času nemení, čo
   * appka smie. Auditovať každé predplnenie formulára by z Histórie — ktorá je
   * forenzný záznam o zápisoch do PRODUKČNÉHO eshopu — urobilo zoznam klikov.
   */
  'preset_created',
  'preset_deleted',
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
  /* Historické (D99, D100, 27. 8. 2026) — appka ich už nezapisuje, viď hore. */
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
  SCOPE_MODE_CHANGED: 'scope_mode_changed',
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
  QUEUE_RESUMED: 'queue_resumed',
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
  PRESET_CREATED: 'preset_created',
  PRESET_DELETED: 'preset_deleted',
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
  /*
   * Historické popisky (D99, D100, 27. 8. 2026). Tieto udalosti už nevznikajú,
   * ale staršie riadky auditu ich nesú a musia sa v Histórii zobraziť menom,
   * nie kódom (I11). Preto sú vety naďalej v minulom čase o tom, čo sa vtedy
   * naozaj stalo — nie o tom, čo appka dnes robí.
   */
  login_ok: 'Prihlásenie — úspech',
  login_fail: 'Prihlásenie — zlyhanie',
  lockout: 'Blokovanie prihlásenia',
  logout: 'Odhlásenie',
  /* HISTORICKÉ (do 27. 8. 2026, D100). Appka ich už nezapisuje — sudo zmizlo —
     ale v `audit_log` ležia staré riadky a I11 hovorí, že „nevieme" je horšie
     než odpoveď, takže menovky zostávajú a nesú aj to, že ide o minulosť. */
  sudo_ok: 'Potvrdenie heslom (do 27. 8. 2026) — úspech',
  sudo_fail: 'Potvrdenie heslom (do 27. 8. 2026) — zlyhanie',
  key_stored: 'API kľúč uložený',
  key_verified: 'API kľúč overený sondou',
  key_wiped: 'API kľúč vymazaný',
  key_panic_wipe: 'API kľúč vymazaný — panic button',
  domain_changed: 'Zmena domény shopu',
  scope_mode_changed: 'Zmena režimu rozsahu',
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
  queue_resumed: 'Fronta znovu spustená používateľom',
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
  preset_created: 'Preset uložený',
  preset_deleted: 'Preset zmazaný',
  boot: 'Štart aplikácie',
  shutdown: 'Ukončenie aplikácie',
};

/** Popisok pre UI; neznámy event (starý riadok v DB) sa zobrazí ako je. */
export function auditEventLabelSk(eventType: string): string {
  return isAuditEventType(eventType) ? AUDIT_EVENT_LABEL_SK[eventType] : eventType;
}
