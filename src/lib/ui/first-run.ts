/**
 * Aura Zľavy — prvý beh appky a ľudské hlášky pri chýbajúcej session.
 *
 * Dva stavy, ktoré appka doteraz nepovedala nahlas:
 *
 *  1. **Prvý beh** — v `users` nie je ani jeden účet, takže sa NEDÁ prihlásiť
 *     žiadnym menom ani heslom. `/login` v takom stave nemá zobrazovať
 *     formulár, do ktorého sa nedá zadať nič platné, ale presný príkaz na
 *     vytvorenie admina (musí ho spustiť človek v termináli — `seed-admin`
 *     potrebuje skutočné TTY na maskovanie hesla).
 *  2. **Chýbajúca session** — mutácia spadne na 401 `unauthorized`. Doteraz to
 *     UI ukázalo ako generickú červenú chybu, ktorá vyzerá ako porucha appky.
 *     Najhorší dôsledok: používateľ vložil API kľúč do produkčného shopu,
 *     dostal červený obdĺžnik, pole sa vyprázdnilo — a myslel si, že kľúč je
 *     uložený. `describeActionFailure()` z toho robí vetu, ktorá výslovne
 *     hovorí, že sa NIČ neuložilo, a nasmeruje na prihlásenie.
 *
 * Modul je zámerne čistý (bez Reactu a bez `fetch`), aby sa dal testovať
 * jednotkovo. Bezpečnostné hranice:
 *
 *  - Stav prvého behu sa odvodzuje VÝHRADNE z POČTU účtov, nikdy z ich údajov
 *    (žiadne mená, žiadne hashe) — I1.
 *  - `unknown` (počet sa nedá prečítať) je fail-closed: `/login` zobrazí bežný
 *    formulár a nikdy netvrdí „účet neexistuje", keď to nevie.
 *  - Hlášky NEúspešného prihlásenia tento modul nerieši — tie zostávajú
 *    generické, aby neprezradili, či konkrétne meno existuje (D68, I3).
 */

/* ══════════════════════════ 1. Prvý beh (users=0) ═════════════════════════ */

/**
 * Príkaz na vytvorenie admin účtu (docs/21-RUNBOOKY.md, krok 8).
 *
 * MUSÍ ho spustiť človek v normálnom termináli — skript si pýta heslo
 * interaktívne a na maskovanie potrebuje skutočné TTY. Appka ho preto nikdy
 * nespúšťa sama; len ho zobrazí na skopírovanie.
 */
export const SEED_ADMIN_COMMAND =
  'docker compose exec ovl-zliav-app node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON /app/scripts/seed-admin.ts';

/** Kam UI posiela používateľa bez session. */
export const LOGIN_PATH = '/login';

export type FirstRunState =
  /** V DB nie je ani jeden účet — prihlásiť sa NEDÁ, treba spustiť seed. */
  | 'needs-admin'
  /** Aspoň jeden účet existuje — bežný prihlasovací formulár. */
  | 'ready'
  /** Počet sa nedá prečítať (DB/sieť) — fail-closed, formulár ako doteraz. */
  | 'unknown';

/**
 * Preloží POČET účtov na stav prvého behu.
 *
 * Vstupom je zámerne len číslo: funkcia nikdy nevidí údaje účtov (I1).
 * Čokoľvek, čo nie je konečné nezáporné celé číslo, je `unknown` — appka
 * radšej nepovie nič, než aby tvrdila neexistenciu účtu, ktorý existuje.
 */
export function firstRunStateFromCount(count: number | null | undefined): FirstRunState {
  if (typeof count !== 'number' || !Number.isFinite(count) || !Number.isInteger(count)) {
    return 'unknown';
  }
  if (count < 0) return 'unknown';
  return count === 0 ? 'needs-admin' : 'ready';
}

/** `true` = `/login` má namiesto formulára zobraziť návod na vytvorenie admina. */
export const showsAdminSetup = (state: FirstRunState): boolean => state === 'needs-admin';

/* ═════════════════════ 2. Chýbajúca session pri akcii ═════════════════════ */

/** Kód 401 pri chýbajúcej/neplatnej/expirovanej session (`HTTP_ERROR_CODES.unauthorized`). */
export const UNAUTHENTICATED_CODE = 'unauthorized';

/**
 * Kód 401 pri platnej session, ale expirovanom sudo okne. NIE je to odhlásenie
 * — volajúci na to ukazuje `SudoPrompt`, nie výzvu na prihlásenie (D70, I3).
 */
export const SUDO_REQUIRED_CODE = 'sudo_required';

/** Tón panelu `ErrorMessage` (drží sa jeho `ErrorTone` bez importu z `.tsx`). */
export type FailureTone = 'info' | 'attention' | 'critical';

export interface ActionErrorLike {
  code?: string | null;
  message?: string | null;
}

export interface ActionFailure {
  /** Slovenská veta pre používateľa. */
  message: string;
  /** Raw kód do rozbaľovacieho technického detailu. */
  rawCode: string | null;
  tone: FailureTone;
  /** `true` = ukáž odkaz na `/login`; akcia sa NEvykonala, lebo chýba session. */
  needsLogin: boolean;
}

/** `true` len pre chýbajúcu session — `sudo_required` sem zámerne NEpatrí. */
export function isUnauthenticatedCode(code: string | null | undefined): boolean {
  return code === UNAUTHENTICATED_CODE;
}

/** Fallback, keď server nepošle ani hlášku. */
const GENERIC_FAILURE = 'Akcia sa nepodarila. Skús to znova.';

/**
 * Zloží hlášku pre neúspešnú mutáciu.
 *
 * `action` je podstatná fráza akcie v prvom páde, napr. `'Uloženie API kľúča'`.
 * Pri chýbajúcej session sa hláška servera ZAHADZUJE a nahrádza vetou, ktorá
 * hovorí dve veci naraz: nie si prihlásený A nič sa neuložilo.
 */
export function describeActionFailure(
  error: ActionErrorLike | null | undefined,
  opts: { action: string },
): ActionFailure {
  const code = error?.code ?? null;
  if (isUnauthenticatedCode(code)) {
    return {
      message:
        `Nie si prihlásený — ${opts.action.toLowerCase()} sa NEVYKONALO ` +
        'a v shope ani v databáze sa nič nezmenilo. Prihlás sa a skús to znova.',
      rawCode: code,
      tone: 'attention',
      needsLogin: true,
    };
  }
  return {
    message: error?.message?.trim() ? error.message.trim() : GENERIC_FAILURE,
    rawCode: code,
    tone: 'critical',
    needsLogin: false,
  };
}
