/**
 * Aura Zľavy — LOKÁLNY ACTOR (D102, nahrádza session z D69).
 *
 * ČO TENTO SÚBOR RIEŠI
 * --------------------
 * 27. 8. 2026 sa z appky vymazalo prihlásenie (D99): je to jednoužívateľský
 * lokálny nástroj na jednom PC a tri vrstvy hesla boli trenie, nie ochrana
 * (rozbor v KONTRAKT-BEZ-LOGINU-2026-08-27.md §2).
 *
 * Zápisy ale MENO POTREBUJÚ ĎALEJ, a to z dvoch nezávislých dôvodov:
 *
 *  1. **Databáza to vynucuje.** `campaigns.created_by` a `audit_log.user_id`
 *     majú FK na `users(id)` s `ON DELETE RESTRICT`. Bez existujúceho riadku
 *     v `users` sa nedá zapísať ani kampaň, ani auditný záznam.
 *  2. **Audit by inak stratil zmysel.** Prvé pravidlo projektu (I11) hovorí, že
 *     „nevieme" je horšia odpoveď než odpoveď. Auditný riadok bez actora by bol
 *     presne to — a to sa zrušením loginu stratiť NESMIE.
 *
 * Preto DB zostáva nedotknutá (D101, žiadna migrácia) a tento modul je jediné
 * miesto, ktoré odpovedá na otázku „kto to zapísal".
 *
 * AKO SA ACTOR VYBERÁ
 * -------------------
 * Existujúci riadok s najnižším `id` sa DOHĽADÁ, nikdy neprepíše — táto
 * inštalácia tak zostáva pri `samuel` a audit má kontinuitu s obdobím, keď sa
 * ešte prihlasovalo. Až prázdna tabuľka (čerstvá inštalácia) si vyrobí riadok
 * a ten sa menuje neutrálne `local`: jednoužívateľský nástroj si nemá vymýšľať
 * meno človeka, ktorý za ním sedí.
 *
 * Riadok vyrába VÝHRADNE ZÁPISOVÁ cesta (27. 8. 2026, D102). Čítacia cesta si
 * actora len dohľadá (`findLocalActor()`, resp. `localActor({ create: false })`)
 * a keď ho niet, vráti `null` — obyčajný `GET /api/health` nesmie na čerstvej
 * inštalácii spraviť `INSERT INTO users`. Fail-closed sa tým neoslabuje: bez
 * actora sa nezapíše nič, len sa už nezapisuje pri čítaní.
 *
 * `password_hash` je `NOT NULL` (§3), takže hodnotu dostať musí. Dostane
 * SENTINEL, ktorý zámerne NIE JE platný argon2/bcrypt hash — keby sa niekedy
 * vrátila overovacia cesta, na tomto reťazci by neoverila nič a spadla by
 * fail-closed namiesto toho, aby niekoho pustila dnu.
 *
 * Vlastník: A4.
 */
import type { LocalActor, Queryable } from '@/contracts';

import { query as poolQuery } from '@/db/pool';
import { AppError } from '@/lib/http/errors';

/** Meno pre riadok vyrobený na čerstvej inštalácii. Existujúce sa nemenia. */
export const FRESH_INSTALL_USERNAME = 'local';

/**
 * Hodnota do `password_hash` pre nový riadok. NIE je to hash a nesmie ním byť:
 * argon2 aj bcrypt majú tvar `$...$`, takže tento reťazec neprejde ako platný
 * hash žiadnou verifikačnou funkciou.
 */
export const NO_LOGIN_SENTINEL = 'no-login-D99';

const SQL_FIRST = 'SELECT id, username FROM users ORDER BY id ASC LIMIT 1';
const SQL_CREATE = 'INSERT INTO users (username, password_hash) VALUES (?, ?)';

interface ActorRow {
  id: number;
  username: string;
}

function firstRow(result: unknown): ActorRow | null {
  if (!Array.isArray(result)) return null;
  if (result.length === 0) return null;
  /*
   * EXPLICITNÉ POROVNANIA, nie `!row` (27. 8. 2026, D102).
   *
   * Turbopack v tomto repozitári už raz null-guard `if (!row)` vyhodnotil ako
   * compile-time falsy a ZAHODIL ho (pasca zapísaná v CLAUDE.md). Tu je to
   * fail-closed cesta každého zápisu: keby guard zmizol, `Number(undefined)`
   * by dalo `NaN`, `resolveLocalActor()` by vrátil actora s `id = NaN` namiesto
   * toho, aby hodil, a FK na `users(id)` by padol až pri zápise kampane —
   * teda po tom, čo si používateľ zľavu potvrdil.
   */
  const row = result[0] as Partial<ActorRow> | undefined;
  if (row === undefined || row === null) return null;
  if (typeof row.username !== 'string') return null;
  const id = Number(row.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { id, username: row.username };
}

/* ─────────────────────────────── vyhľadanie ────────────────────────────── */

export interface LocalActorDeps {
  /** Výhradne pre testy: spojenie namiesto poolu. */
  conn?: Queryable;
}

function runner(deps: LocalActorDeps): (sql: string, params?: unknown[]) => Promise<unknown> {
  const conn = deps.conn;
  if (conn === undefined) return (sql, params) => poolQuery(sql, params);
  return (sql, params) => conn.query(sql, params);
}

/**
 * Fail-closed chyba pre stav „actora niet a nedá sa vyrobiť". Zdieľa ju
 * `resolveLocalActor()` a zápisová vrstva v `define-route.ts`, aby to isté
 * odmietnutie neexistovalo v dvoch tvaroch (27. 8. 2026, D102).
 */
export function localActorMissingError(): AppError {
  return new AppError(
    500,
    'local_actor_missing',
    'V tabuľke `users` nie je ani jeden riadok a nepodarilo sa ho vytvoriť. ' +
      'Bez neho sa nedá zapísať kampaň ani auditný záznam (FK na users.id). ' +
      'Skontroluj pripojenie k DB a práva appky na INSERT do `users`.',
  );
}

/**
 * LEN DOHĽADÁ actora — nikdy ho nevyrobí. `null` = tabuľka `users` je prázdna.
 *
 * Existuje kvôli ČÍTACEJ ceste (27. 8. 2026, D102): obyčajný `GET /api/health`
 * nesmie na čerstvej inštalácii spraviť `INSERT INTO users`. Riadok patrí tomu,
 * kto zapisuje, nie tomu, kto sa pýta, ako sa appke vodí.
 */
export async function findLocalActor(deps: LocalActorDeps = {}): Promise<LocalActor | null> {
  const found = firstRow(await runner(deps)(SQL_FIRST));
  if (found === null) return null;
  return { id: found.id, username: found.username };
}

/**
 * Nájde actora, a keď tabuľka je prázdna, vyrobí ho.
 *
 * Zámerne BEZ cache na tejto úrovni — cache patrí `localActor()` nižšie, aby sa
 * dala v testoch obísť podaním `conn`.
 */
export async function resolveLocalActor(deps: LocalActorDeps = {}): Promise<LocalActor> {
  const run = runner(deps);

  // Explicitné `!== null`, nie truthy test — dôvod je v `firstRow()` vyššie.
  const existing = firstRow(await run(SQL_FIRST));
  if (existing !== null) return { id: existing.id, username: existing.username };

  await run(SQL_CREATE, [FRESH_INSTALL_USERNAME, NO_LOGIN_SENTINEL]);

  const created = firstRow(await run(SQL_FIRST));
  if (created !== null) return { id: created.id, username: created.username };

  // Riadok sa nedá ani nájsť, ani vyrobiť. Fail-closed: bez actora sa nesmie
  // zapisovať, lebo by nebolo koho zapísať do auditu (I11).
  throw localActorMissingError();
}

/* ──────────────────────────────── cache ────────────────────────────────── */

let cached: LocalActor | null = null;

export interface LocalActorLookupOptions {
  /**
   * `true` (default) — prázdnu tabuľku doplní a keď to nevyjde, HODÍ. Toto je
   * zápisová cesta: bez actora sa nesmie zapisovať (I11).
   *
   * `false` — actora len DOHĽADÁ a keď ho niet, vráti `null`. Toto je čítacia
   * cesta: `GET` nemá dôvod zapisovať do `users` (27. 8. 2026, D102).
   */
  create?: boolean;
}

/**
 * Actor pre bežný beh. Výsledok sa cachuje — je to jeden riadok, ktorý sa počas
 * behu appky nemení, a inak by ho čítal každý request.
 *
 * Vracia `null` VÝHRADNE pri `create: false` nad prázdnou tabuľkou. Zápisová
 * cesta `null` nikdy nevidí: tam sa buď actor vyrobí, alebo to hodí.
 */
export async function localActor(
  opts: LocalActorLookupOptions = {},
): Promise<LocalActor | null> {
  if (cached !== null) return cached;
  if (opts.create === false) {
    const found = await findLocalActor();
    if (found === null) return null;
    cached = found;
    return cached;
  }
  cached = await resolveLocalActor();
  return cached;
}

/** Výhradne pre testy — zabudne cache. */
export function resetLocalActorCache(): void {
  cached = null;
}
