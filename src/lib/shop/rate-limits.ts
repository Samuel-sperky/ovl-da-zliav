/**
 * Aura Zľavy — LIMITY SHOPU AKO JEDINÝ ZDROJ PRAVDY.
 *
 * Čísla nižšie nie sú odhad ani konvencia tejto appky — sú odpísané z
 * `docs/api/sperky-api-v4.md`, sekcia „Rate limiting":
 *
 * > **With a valid API key:** the database policy attached to that key
 * > (default staff policy: 20/minute and 200/UTC day), budgeted independently
 * > per key.
 * > **Without one:** 30/minute and 300/UTC day, budgeted per source IP.
 *
 * PREČO TENTO SÚBOR VZNIKOL
 * -------------------------
 * `catalog-sync.ts` roky tvrdil v komentári „čítací limit shopu je 300 volaní
 * / 60 s" a odvodil z toho pauzu 250 ms medzi stránkami. To je 240 volaní za
 * minútu proti skutočnému anonymnému stropu **30 za minútu** — osemnásobok.
 * Synchronizácia preto spoľahlivo dostala 429 po pár desiatkach strán.
 * Zámena „za deň" za „za minútu" v jednom komentári stála celý katalóg.
 *
 * Aby sa to nezopakovalo, limity žijú na jednom mieste a všetko ostatné si ich
 * odtiaľto berie.
 *
 * DVE ROZPOČTOVÉ VETVY, KTORÉ SA NESMÚ POMIEŠAŤ
 * ---------------------------------------------
 *  - **Čítanie katalógu ide BEZ kľúča** (D48, I1 — čítacie volania klienta
 *    nemajú `SecretRef`, `X-Api-Key` sa vôbec nezostaví). Platí naň teda
 *    anonymná politika a rozpočet sa počíta **na zdrojovú IP**, čiže sa delí
 *    so VŠETKÝM ostatným, čo z tohto počítača na shop chodí.
 *  - **Zápisy a objednávky idú S kľúČOM** a majú vlastný rozpočet na kľúč.
 *
 * Preto anonymné čítanie katalógu neuberá zo zápisového rozpočtu a naopak —
 * ale dve anonymné čítania (katalóg a čokoľvek ďalšie z tej istej IP) si
 * rozpočet delia.
 *
 * ČO Z TOHO PLYNIE PRE KATALÓG
 * ----------------------------
 * 40 483 produktov po 100 na stránku = 405 stránok. Anonymný denný strop je
 * 300 volaní, takže **celý katalóg sa v jednom UTC dni prečítať NEDÁ** — beh
 * je dvojdňový a musí vedieť pokračovať tam, kde skončil. Nie je to chyba
 * implementácie, je to aritmetika stropu.
 *
 * Vlastník: A3.
 */

/* ═══════════════════ 1. Doslovné limity z dokumentácie ════════════════════ */

/** Anonymné čítanie (bez `X-Api-Key`) — na zdrojovú IP. */
export const SHOP_ANON_LIMIT = {
  perMinute: 30,
  perUtcDay: 300,
} as const;

/** Volania s kľúčom — na kľúč, podľa politiky priradenej v shope. */
export const SHOP_KEYED_LIMIT = {
  perMinute: 20,
  perUtcDay: 200,
} as const;

/**
 * Koľko zo stropu si dovolíme minúť. Strop je hrana, za ktorou shop kľúč
 * zabanuje (predvolene na 10 minút), nie cieľ — a rozpočet navyše zdieľame
 * s ďalšími volaniami z tej istej IP, o ktorých nevieme. 80 % je rezerva,
 * ktorá prežije jedno cudzie volanie medzi našimi.
 */
export const RATE_SAFETY_FACTOR = 0.8;

/* ═══════════════════════ 2. Odvodené hodnoty ══════════════════════════════ */

/** Koľko anonymných čítaní za minútu si dovolíme (30 × 0,8 = 24). */
export const ANON_READS_PER_MINUTE = Math.floor(SHOP_ANON_LIMIT.perMinute * RATE_SAFETY_FACTOR);

/** Koľko anonymných čítaní za UTC deň si dovolíme (300 × 0,8 = 240). */
export const ANON_READS_PER_UTC_DAY = Math.floor(SHOP_ANON_LIMIT.perUtcDay * RATE_SAFETY_FACTOR);

/**
 * Minimálna pauza medzi anonymnými čítaniami, aby sa minútový strop nedal
 * prekročiť ani teoreticky: 60 000 / 24 = 2 500 ms.
 *
 * Toto číslo je PODLAHA, nie návrh — nižšiu hodnotu nesmie nastaviť ani
 * konfigurácia, presne ako `MIN_WRITE_PAUSE_MS` na zápisovej strane.
 */
export const MIN_ANON_READ_PAUSE_MS = Math.ceil(60_000 / ANON_READS_PER_MINUTE);

/* ═══════════════════════ 3. Pomôcky na plánovanie ═════════════════════════ */

/** Začiatok UTC dňa, do ktorého spadá `at` — hranica, na ktorej sa strop obnoví. */
export function utcDayStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/** Kedy sa obnoví denný rozpočet, ak `at` padne do dnešného UTC dňa. */
export function nextUtcDayReset(at: Date): Date {
  const start = utcDayStart(at);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Koľko UTC dní potrvá prečítať `pages` stránok pri dennom strope
 * `ANON_READS_PER_UTC_DAY`. Slúži na to, aby UI vedelo povedať „hotovo
 * pozajtra", a nie mlčať.
 */
export function anonReadDaysNeeded(pages: number): number {
  if (pages <= 0) return 0;
  return Math.ceil(pages / ANON_READS_PER_UTC_DAY);
}
