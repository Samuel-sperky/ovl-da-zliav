/**
 * Aura Zľavy — obsah súboru diagnostiky (návrh V3, `nastavenia.html` #diagnostika,
 * odpoveď 83: „tlačidlo «Stiahnuť diagnostiku» (bez tajomstiev)").
 *
 * Súbor existuje pre jeden scenár: appka sa chová divne, Samuel nechce čítať
 * logy a niekomu to musí poslať. Preto je to JEDEN súbor, ktorý sa dá poslať
 * e-mailom bez toho, aby ho niekto musel čistiť.
 *
 * INVARIANT I1 JE TU CELÝ ZMYSEL VECI. Súbor odchádza z počítača, takže je to
 * presne ten druh cesty, ktorou tajomstvá unikajú. Bránia tomu tri nezávislé
 * poistky, zámerne v tomto poradí:
 *
 *  1. **Whitelist, nie blacklist.** `collectDiagnostics()` skladá výstup z
 *     hodnôt, ktoré vymenuje TU — čísla, enumy a verzie. Nikde neprepisuje
 *     objekt z repozitára ani odpoveď shopu, takže nové stĺpce v DB sa do
 *     súboru nemôžu „len tak" prisať.
 *  2. **`redact()` na záver + strop na dĺžku voľných textov.** Rovnaká vrstva
 *     ako pri logovaní: reťazec TVARU tajomstva (`Authorization: Bearer …`,
 *     `key=…`) sa zmení na `***REDACTED***`.
 *     Čo `redact()` NEDOKÁŽE a netreba si o tom nič nahovárať: neprehľadný
 *     reťazec bez rozpoznateľného tvaru, ktorý sedí v poli s dôveryhodným
 *     zdrojom (`databaza` je z `SELECT VERSION()`), prejde. Pre také polia je
 *     zárukou whitelist a ten dôveryhodný zdroj, nie redakcia. Preto má každý
 *     voľný text ešte strop na dĺžku — tajomstvá sa skrývajú v dlhých blokoch
 *     a `MAX_FREE_TEXT` obmedzuje, čo z nich môže odísť.
 *  3. **Test pripína tvar.** `diagnostics.spec.ts` porovnáva kľúče výstupu s
 *     `DIAGNOSTICS_FIELDS` a padne pri KAŽDOM novom poli. Kto pridá pole, musí
 *     sa priznať v teste — nedá sa to prejsť tichým commitom.
 *
 * Čo v súbore NIE JE a nikdy nebude: kľúče shopu, heslá, master key, obsah
 * objednávok, telá odpovedí shopu, e-maily zákazníkov. Rovnaký zoznam appka
 * ukazuje aj na obrazovke (`VYNECHANE`) — nie je to len komentár v kóde.
 *
 * ODCHÝLKA OD MOCKUPU, priznaná: mockup ukazuje „Posledné odpovede shopu:
 * 200 ×98 · 404 ×3 · timeout ×2". Appka HTTP kódy jednotlivých odpovedí
 * nikde neuchováva — audit má vlastné kategórie výsledku zápisu
 * (`write_ok`/`write_failed`/`write_skipped`/`write_uncertain`). Súbor preto
 * nesie tieto, so svojimi menami. Vymýšľať HTTP kódy, ktoré appka nezmerala,
 * by bolo tvrdenie bez podkladu (P3).
 *
 * Vlastník: V3 (dobeh návrhu podľa `docs/53-AUDIT-1-1-V3.md` §C bod 2).
 */
import type { UtcDate } from '@/contracts';

import { LOGIC_TIME_ZONE, todayInZone } from '@/lib/domain/dates';
import { redact } from '@/lib/log/redact';
import { APP_DISPLAY_NAME, APP_VERSION } from '@/version';

/* ═══════════════════════════════ 1. Tvar ══════════════════════════════════ */

/**
 * Kľúče najvyššej úrovne. Test ich porovnáva s reálnym výstupom, takže tento
 * zoznam je ZÁVÄZNÝ — nie dokumentácia, ale kontrola.
 */
export const DIAGNOSTICS_FIELDS = [
  'appka',
  'vytvorene',
  'verzia',
  'migracie',
  'fronta',
  'vysledkyZapisu',
  'vynechane',
] as const;

/**
 * Čo súbor VÝSLOVNE neobsahuje. Ide aj na obrazovku (rozklik „Čo súbor
 * obsahuje" → riadok `Vynechané`), aby to používateľ vedel PRED odoslaním.
 */
export const VYNECHANE: readonly string[] = [
  'kľúče shopu',
  'heslá',
  'master key',
  'obsah objednávok',
  'telá odpovedí shopu',
];

export interface DiagnosticsVersions {
  readonly appka: string;
  readonly node: string;
  /** `null` = databáza neodpovedala. Nedopĺňa sa domnelou verziou. */
  readonly databaza: string | null;
}

export interface DiagnosticsMigrations {
  readonly pocet: number;
  /** Napr. `0001–0012`, alebo `null` keď nie je aplikovaná žiadna. */
  readonly rozsah: string | null;
  /**
   * `true` = všetky checksumy súhlasia. `false` = niektorá aplikovaná migrácia
   * má v repe iný obsah než v DB; `nesuhlasia` potom nesie ich názvy (názov
   * súboru tajomstvo nie je — presne to isté píše `migrate.ts` do stdout).
   */
  readonly checksumyOk: boolean;
  readonly nesuhlasia: readonly string[];
}

export interface DiagnosticsQueue {
  readonly bezi: boolean;
  readonly spracovane: number | null;
  readonly zlyhane: number | null;
  /** ISO čas posledného tiku plánovača. `null` = plánovač nebežal nikdy. */
  readonly poslednyTick: string | null;
  readonly pocetTikov: number | null;
  /**
   * Posledná chyba plánovača. JEDINÉ voľné textové pole v celom súbore, a
   * preto jediný dôvod, prečo tu `redact()` nie je len ozdoba: hláška môže
   * niesť čokoľvek, čo do nej hodila knižnica. Na diagnostiku „fronta
   * nezapisuje" je to zároveň najcennejší riadok, takže sa nevynecháva —
   * prechádza redakciou ako všetko v logoch.
   */
  readonly poslednaChyba: string | null;
}

/** Počty podľa kategórií auditu. Bez tiel odpovedí — viď hlavička modulu. */
export interface DiagnosticsWriteOutcomes {
  readonly write_ok: number;
  readonly write_failed: number;
  readonly write_skipped: number;
  readonly write_uncertain: number;
  readonly poznamka: string;
}

export interface DiagnosticsFile {
  readonly appka: string;
  /** ISO okamih vytvorenia súboru. */
  readonly vytvorene: string;
  readonly verzia: DiagnosticsVersions;
  readonly migracie: DiagnosticsMigrations;
  /** `null` = stav fronty sa nepodarilo prečítať. */
  readonly fronta: DiagnosticsQueue | null;
  readonly vysledkyZapisu: DiagnosticsWriteOutcomes;
  readonly vynechane: readonly string[];
}

/* ════════════════════════════ 2. Závislosti ═══════════════════════════════ */

/**
 * Všetko injektovateľné — route dodá skutočné zdroje, test fakes. Každý zdroj
 * smie zlyhať: diagnostika je nástroj na riešenie poruchy, takže musí vzniknúť
 * AJ VTEDY, keď je polovica appky mimo. Preto `safe()` nižšie.
 */
export interface DiagnosticsDeps {
  now: () => UtcDate;
  nodeVersion?: string;
  dbVersion: () => Promise<string | null>;
  migrations: () => Promise<DiagnosticsMigrations>;
  queue: () => Promise<DiagnosticsQueue | null>;
  writeOutcomes: () => Promise<Omit<DiagnosticsWriteOutcomes, 'poznamka'>>;
}

export const WRITE_OUTCOMES_NOTE = 'počty z auditu appky, bez tiel odpovedí shopu';

/** Neznáme migrácie — fail-closed tvar, keď sa `_migrations` nedá prečítať. */
const MIGRATIONS_UNKNOWN: DiagnosticsMigrations = {
  pocet: 0,
  rozsah: null,
  checksumyOk: false,
  nesuhlasia: ['stav migrácií sa nepodarilo prečítať'],
};

const OUTCOMES_UNKNOWN: Omit<DiagnosticsWriteOutcomes, 'poznamka'> = {
  write_ok: 0,
  write_failed: 0,
  write_skipped: 0,
  write_uncertain: 0,
};

/** Zdroj, ktorý hodí, nesmie zhodiť celý súbor. Vráti sa `fallback`. */
async function safe<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

/**
 * Strop na voľný text. Verzia databázy ani chybová hláška nemajú dôvod byť
 * dlhšie; dlhý neprehľadný blok je presne to, v čom sa tajomstvo skryje.
 */
export const MAX_FREE_TEXT = 200;

/** Skráti voľný text na strop. `null` zostáva `null` — medzera sa nedopĺňa. */
function capFreeText(value: string | null, max = MAX_FREE_TEXT): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

/* ═════════════════════════════ 3. Zber ════════════════════════════════════ */

/**
 * Zloží súbor diagnostiky. Poradie polí je poradie riadkov v mockupe, aby sa
 * súbor čítal rovnako, ako sa obrazovka pozerá.
 */
export async function collectDiagnostics(deps: DiagnosticsDeps): Promise<DiagnosticsFile> {
  const now = deps.now();

  const [databaza, migracie, fronta, outcomes] = await Promise.all([
    safe(deps.dbVersion, null),
    safe(deps.migrations, MIGRATIONS_UNKNOWN),
    safe(deps.queue, null),
    safe(deps.writeOutcomes, OUTCOMES_UNKNOWN),
  ]);

  const file: DiagnosticsFile = {
    appka: `${APP_DISPLAY_NAME} ${APP_VERSION}`,
    vytvorene: now.toISOString(),
    verzia: {
      appka: APP_VERSION,
      node: deps.nodeVersion ?? process.version,
      databaza: capFreeText(databaza),
    },
    migracie,
    fronta:
      fronta === null ? null : { ...fronta, poslednaChyba: capFreeText(fronta.poslednaChyba) },
    vysledkyZapisu: { ...outcomes, poznamka: WRITE_OUTCOMES_NOTE },
    vynechane: VYNECHANE,
  };

  // Poistka 2 — rovnaká redakcia ako pri logovaní. Whitelist vyššie by mal
  // stačiť; toto je pre prípad, že nestačil.
  return redact(file);
}

/* ══════════════════════════ 4. Názov súboru ═══════════════════════════════ */

/**
 * `aura-zlavy-diagnostika-2026-08-11.json`.
 *
 * Deň sa počíta v `Europe/Bratislava`, NIE v UTC — v tomto repe je to známa
 * pasca (medzi 22:00 a 24:00 UTC by súbor nesol zajtrajší dátum).
 */
export function diagnosticsFileName(now: UtcDate, timeZone: string = LOGIC_TIME_ZONE): string {
  return `aura-zlavy-diagnostika-${todayInZone(now, timeZone)}.json`;
}

/**
 * Riadky rozkliku „Čo súbor obsahuje". Sú tu, a nie v komponente, aby sa
 * obrazovka a súbor nemohli rozísť — čo je vymenované, to sa aj zbiera.
 */
export const DIAGNOSTICS_CONTENT_ROWS: readonly { label: string; detail: string }[] = [
  { label: 'Verzia', detail: 'appka, node, databáza' },
  { label: 'Zoznam migrácií', detail: 'počet, rozsah a či súhlasia checksumy' },
  { label: 'Stav fronty', detail: 'spracované, zlyhané, posledný tik plánovača' },
  { label: 'Výsledky zápisu', detail: 'počty z auditu, bez tiel odpovedí shopu' },
  { label: 'Vynechané', detail: VYNECHANE.join(', ') },
];
