/**
 * Aura Zľavy — ČO SA STANE, KEĎ SHOP ČÍTANIE OBJEDNÁVOK ODMIETNE.
 *
 * Prečo tento modul vznikol
 * -------------------------
 * `sync-runner.ts` do 24. 8. 2026 plánoval ďalší beh JEDNÝM pravidlom: keď beh
 * neskončil na dennom rozpočte, skús o 20 hodín. Pre `rate_limited` alebo pre
 * výpadok siete je to správne — o 20 hodín je svet iný. Pre 403 to správne nie
 * je: `forbidden` je v taxonómii (`lib/shop/errors.ts`) TERMINAL, teda „shop
 * odmietol a rovnaká požiadavka dopadne rovnako". Runner ten rozdiel nepoznal,
 * takže appka opakovala požiadavku, na ktorú dostávala 403, deň za dňom —
 * a `sales_sync_state` má o tom dvanásť riadkov (7. 8. – 18. 8. 2026).
 * Po nich shop na tú istú cestu odpovedal kódom `ip_banned`.
 *
 * Modul je ČISTÝ: žiadna DB, žiadna sieť, žiadne `process.env`, žiadny čas
 * z `Date.now()`. Dostane, čo si volajúci prečítal, a vráti rozhodnutie. Vďaka
 * tomu sa dá celá politika otestovať bez kontajnera.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *  1. **Trvalá prekážka nesmie dostať rozvrh.** `probeAt === null` znamená
 *     „na rozvrhu sa neskúša NIKDY" a je to jediný správny stav pre chýbajúce
 *     oprávnenie: opakovanie ho nevylieči, len minie rozpočet. Kto sem raz
 *     dopíše „ale raz za týždeň to skúsime", vráti presne to, čo tento modul
 *     odstraňuje.
 *  2. **Čakanie sa počíta k času POSLEDNÉHO pokusu, nie k „teraz".** Keby sa
 *     počítalo k „teraz", odstup by rástol spolu s čakaním a chvíľa pokusu by
 *     sa donekonečna vzďaľovala — appka by sa nepokúsila nikdy.
 *  3. **Vety nesmú tvrdiť príčinu.** Appka vie, čo shop odpovedal, nie prečo.
 *     Preto „eshop odmieta", nikdy „appku zabanovali za to, že…".
 *
 * Vlastník: sales-sync.
 */
import type { UtcDate } from '@/contracts';

/* ═══════════════════════════ 1. Druhy prekážky ════════════════════════════ */

/**
 * Dva stupne toho istého „shop nás nepustí k objednávkam":
 *
 *  - `permission` — 401/403. Kľúč existuje, ale na `/api/order` ho shop
 *    neprijme. Čaká sa na človeka, appka sama neskúša.
 *  - `ip_ban`     — shop odmieta celú IP adresu. Prísnejší stav: aj samotné
 *    zisťovanie „už je to preč?" musí byť zriedkavé a lacné.
 */
export type SalesBlockKind = 'permission' | 'ip_ban';

/**
 * Kódy, ktorými shop hlási zablokovanú IP adresu. Zoznam je jednoprvkový
 * zámerne — pozná sa jediný kód, ktorý appka naozaj videla v odpovedi
 * (`sales_sync_state.last_error = 'ip_banned'`). Ďalší názov toho istého stavu
 * pribudne SEM a nikam inam.
 */
export const IP_BAN_CODES: ReadonlySet<string> = new Set(['ip_banned']);

/**
 * Kódy, po ktorých sa na rozvrhu neskúša. Sú to názvy DRUHOV z taxonómie
 * (`ShopErrorKind`), nie surové kódy shopu: `lib/engine/sales-sync.ts` pre
 * odmietnutý kľúč zapisuje druh práve preto, aby sa prekážka dala prečítať
 * späť z DB aj po reštarte appky.
 */
export const PERMISSION_BLOCK_CODES: ReadonlySet<string> = new Set([
  'unauthorized',
  'forbidden',
]);

/**
 * Kód chyby → druh prekážky. `null` = nie je to trvalá prekážka (sieť, 429,
 * 500, chyba appky) a platí bežný rozvrh.
 */
export function classifySalesStop(code: string | null | undefined): SalesBlockKind | null {
  if (typeof code !== 'string') return null;
  const normalized = code.trim().toLowerCase();
  if (normalized.length === 0) return null;
  if (IP_BAN_CODES.has(normalized)) return 'ip_ban';
  if (PERMISSION_BLOCK_CODES.has(normalized)) return 'permission';
  return null;
}

/* ═══════════════════════ 2. Ako sa z banu vychádza ════════════════════════ */

/**
 * Najkratší odstup medzi dvoma overovacími požiadavkami po `ip_banned`.
 *
 * Šesť hodín, nie dvadsať: dvadsať by bolo skoro to isté tempo, akým sa appka
 * do banu dostala (jeden beh denne), a šesť je zároveň dosť dlho na to, aby
 * krátkodobá blokáda stihla vypršať skôr, než sa appka ozve druhýkrát.
 */
export const IP_BAN_MIN_WAIT_MS = 6 * 60 * 60 * 1000;

/** Najdlhší odstup. Ďalej sa už nepredlžuje — inak by sa appka neozvala nikdy. */
export const IP_BAN_MAX_WAIT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Ako dlho sa čaká pred ďalšou overovacou požiadavkou.
 *
 * `standingForMs` je vek prekážky v okamihu POSLEDNÉHO pokusu, nie teraz (bod 2
 * hlavičky). Z toho vychádza zdvojnásobovanie bez akéhokoľvek počítadla: prvý
 * pokus po 6 h, potom 6, 12, 24, 48, 96 h a strop 7 dní. Počítadlo by muselo
 * niekde bývať a reštart appky by ho vynuloval — presne ten reštart, ktorý
 * dvanásťdňové opakovanie držal pri živote.
 */
export function ipBanWaitMs(standingForMs: number): number {
  if (!Number.isFinite(standingForMs) || standingForMs <= IP_BAN_MIN_WAIT_MS) {
    return IP_BAN_MIN_WAIT_MS;
  }
  return Math.min(standingForMs, IP_BAN_MAX_WAIT_MS);
}

/* ══════════════════════════ 3. Rozhodnutie ════════════════════════════════ */

/** Čo si volajúci prečítal z `sales_sync_state` (`lib/sales/insights.ts`). */
export interface SalesStopRecord {
  /** KÓD z naposledy dotknutého dňa; `null` = posledný beh chybu nezanechal. */
  code: string | null;
  /** Kedy sa ten deň naposledy zapísal. */
  at: UtcDate | null;
  /** Odkedy stojí nevyriešená chyba — najstarší deň, ktorý kód stále nesie. */
  since: UtcDate | null;
}

export interface SalesBlock {
  kind: SalesBlockKind;
  /** KÓD, ktorý prekážku vyhlásil. Nikdy text odpovede shopu (I1). */
  code: string;
  /** Odkedy prekážka stojí. */
  since: UtcDate;
  /** Kedy sa smie poslať JEDNA overovacia požiadavka. `null` = na rozvrhu nikdy. */
  probeAt: UtcDate | null;
  /** Čo sa deje — jedna veta na povrch (P2: do 90 znakov). */
  what: string;
  /** Čo s tým — jedna veta na povrch (P2: do 90 znakov). */
  nextStep: string;
}

/** Veta „čo sa deje". Hovorí, čo shop odpovedal, nikdy prečo (P8). */
export function salesBlockWhat(kind: SalesBlockKind): string {
  return kind === 'ip_ban'
    ? 'Eshop odmieta objednávky z tejto IP adresy. Predané kusy sa nedopĺňajú.'
    : 'Eshop odmieta čítanie objednávok. Predané kusy sa nedopĺňajú.';
}

/** Veta „čo s tým". Vždy krok, ktorý vie urobiť človek. */
export function salesBlockNextStep(kind: SalesBlockKind): string {
  return kind === 'ip_ban'
    ? 'Požiadajte eshop o odblokovanie adresy. Appka sa sama ozve raz za čas.'
    : 'Pridajte kľúču v eshope právo čítať objednávky a vložte ho v Nastaveniach znova.';
}

export interface SalesBlockOptions {
  /**
   * Kedy bol OBJEDNÁVKOVÝ kľúč naposledy uložený (`ApiKeyMeta.savedAt`).
   *
   * Toto je cesta späť pri chýbajúcom oprávnení: keď človek kľúč po prekážke
   * vloží znova, prekážka padá a appka sa smie skúsiť ozvať. Bez tejto vetvy by
   * `probeAt === null` znamenalo „už nikdy", čo nie je zastavenie, ale slepá
   * ulička.
   */
  keySavedAt: UtcDate | null;
}

/**
 * Stojí synchronizácia na trvalej prekážke, a ak áno, kedy sa smie ozvať?
 *
 * `null` = nič netrvá, platí bežný rozvrh.
 */
export function decideSalesBlock(
  record: SalesStopRecord,
  options: SalesBlockOptions,
): SalesBlock | null {
  const kind = classifySalesStop(record.code);
  if (kind === null || record.code === null) return null;

  const at = record.at;
  // Bez času posledného pokusu sa odstup nedá počítať. Fail-closed: prekážka
  // platí, ale overovacia požiadavka nedostane termín — príde až s novým kľúčom.
  const since = record.since ?? at;

  // Kľúč vložený PO tom, čo prekážka vznikla, je zásah človeka. Appka nemá
  // dôvod ďalej stáť; keď sa nič nezmenilo, ďalší beh prekážku zapíše znova.
  if (options.keySavedAt !== null && at !== null && options.keySavedAt.getTime() > at.getTime()) {
    return null;
  }

  let probeAt: UtcDate | null = null;
  if (kind === 'ip_ban' && at !== null && since !== null) {
    probeAt = new Date(at.getTime() + ipBanWaitMs(at.getTime() - since.getTime()));
  }

  return {
    kind,
    code: record.code,
    since: since ?? at ?? new Date(0),
    probeAt,
    what: salesBlockWhat(kind),
    nextStep: salesBlockNextStep(kind),
  };
}
