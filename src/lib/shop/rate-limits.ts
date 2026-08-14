/**
 * Aura Zľavy — ROZPOČET VOLANÍ NA SHOP: ŽIVÝ ZOSTATOK Z `whoami`, ZÁLOHA Z v4.
 *
 * ČO TENTO MODUL RIEŠI
 * --------------------
 * Koľko volaní si appka smie dovoliť, kým ju shop odmietne (`rate_limited`,
 * predvolene ban na 10 minút). Čísla žijú na JEDNOM mieste a všetko ostatné si
 * ich odtiaľto berie — `catalog-sync.ts` roky tvrdil v komentári „čítací limit
 * shopu je 300 volaní / 60 s" a odvodil z toho pauzu 250 ms medzi stránkami.
 * To je 240 volaní za minútu proti skutočnému anonymnému stropu **30 za
 * minútu** — osemnásobok. Zámena „za deň" za „za minútu" v jednom komentári
 * stála celý katalóg.
 *
 * ODKIAĽ SA ČÍSLA BERÚ (a čo sa zmenilo s API v5)
 * ----------------------------------------------
 * Do v4 mala dokumentácia shopu sekciu „Rate limiting" a čísla 20/200 s kľúčom
 * a 30/300 bez kľúča boli z nej odpísané doslova. **Dokumentácia v5 tú sekciu
 * UŽ NEMÁ.** Tie isté čísla sú teda odteraz bez zdroja: nikto nesľubuje, že
 * platia, a nikto nesľubuje, že sú rovnaké pre každý kľúč.
 *
 * Namiesto nich v5 pridal `GET /api/whoami`, ktorý vracia `remaining`
 * `{per_minute, per_day}` — **živý zostatok rozpočtu tohto kľúča** po práve
 * prebehnutom volaní. To je jediné číslo o limitoch, ktoré má v v5 zdroj.
 *
 * Preto platí toto rozdelenie a nič iné:
 *
 *  - **Vetva s kľúčom** (zápisy, objednávky, `getFull`): rozpočet sa ČÍTA
 *    z `whoami.remaining`. Natvrdo zapísané `SHOP_KEYED_LIMIT` je VÝHRADNE
 *    ZÁLOHA pre prípad, že sa `whoami` nedá prečítať — viď `resolveKeyedBudget`.
 *  - **Anonymná vetva** (čítanie katalógu bez kľúča, D48/I1): `whoami` o nej
 *    nevie a vedieť nemôže — bez kľúča niet čo introspektovať a rozpočet sa
 *    počíta na zdrojovú IP, teda sa delí so VŠETKÝM ostatným, čo z tohto
 *    počítača na shop chodí. Anonymné čísla preto zostávajú natvrdo, a keďže
 *    ani ony už nemajú v v5 zdroj, drží ich pod stropom rezerva
 *    `RATE_SAFETY_FACTOR`. Sú to POSLEDNÉ ZNÁME hodnoty, nie zaručené.
 *
 * ČO SA V TOMTO MODULE NESMIE POKAZIŤ A PREČO
 * -------------------------------------------
 *  1. **„Nevieme" nie je nula ani nekonečno.** `whoami.per_day` smie byť `null`
 *     (kľúč bez dennej kvóty) a `whoami` sa nemusí dať prečítať vôbec. Ani
 *     jedno neznamená „smieme neobmedzene" a ani jedno neznamená „nesmieme nič".
 *     Znamená to „nevieme" a vtedy platí ZÁLOHA — teda tá NIŽŠIA z dvojice
 *     {záloha, bez stropu}. Fail-closed sa tu meria takto: keď sa dá vybrať
 *     medzi vyšším a nižším číslom bez zdroja, vyhráva nižšie.
 *  2. **Živé číslo prebíja zálohu aj smerom hore.** Keď `whoami` povie 59, platí
 *     59, aj keď záloha hovorí 16 — inak by čítanie zostatku nemalo zmysel
 *     a kľúč s väčšou kvótou by sme ticho škrtili. Záloha je pre prípad, že sa
 *     `whoami` NEDÁ prečítať, nie strop nad ním.
 *  3. **Minútový zostatok nikdy neprekročí denný.** Za minútu sa nedá minúť
 *     viac, než ostáva do konca UTC dňa — `resolveKeyedBudget` preto berie tú
 *     nižšiu z dvojice. Bez toho by sa posledných pár volaní dňa naplánovalo
 *     podľa minútového čísla a denný strop by sa prekročil.
 *  4. **Deň je UTC deň.** Strop resetuje shop o polnoci UTC, nie appka
 *     o polnoci v Bratislave.
 *  5. **Z `whoami` sem ide VÝHRADNE `remaining`.** Odpoveď nesie aj `id`, `name`
 *     a `owner` kľúča; do tohto modulu sa nedostanú a dostať nesmú (I1).
 *     Rozpočet sú dve čísla, nie identita kľúča.
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

/* ═══════════ 1. Posledné známe limity z dokumentácie (v5 ich už nemá) ══════ */

/**
 * Anonymné čítanie (bez `X-Api-Key`) — na zdrojovú IP.
 *
 * Posledná dokumentácia, ktorá tieto čísla uvádzala, je `sperky-api-v4.md`,
 * sekcia „Rate limiting". Vo v5 už taká sekcia nie je a `whoami` anonymnú vetvu
 * nepokrýva (bez kľúča niet čo introspektovať), takže lepší zdroj neexistuje.
 */
export const SHOP_ANON_LIMIT = {
  perMinute: 30,
  perUtcDay: 300,
} as const;

/**
 * Volania s kľúčom — na kľúč, podľa politiky priradenej v shope.
 *
 * **Toto je ZÁLOHA, nie pravda.** Skutočný rozpočet vracia `whoami.remaining`;
 * tieto čísla sa použijú výhradne vtedy, keď sa `whoami` nedá prečítať
 * (`resolveKeyedBudget`). Ich jediný zdroj je stará v4 dokumentácia.
 */
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

/**
 * Záloha pre vetvu s kľúčom, už po odrátaní rezervy (20 × 0,8 = 16
 * a 200 × 0,8 = 160). Platí VÝHRADNE vtedy, keď `whoami` nevie povedať zostatok.
 */
export const KEYED_FALLBACK_PER_MINUTE = Math.floor(
  SHOP_KEYED_LIMIT.perMinute * RATE_SAFETY_FACTOR,
);
export const KEYED_FALLBACK_PER_UTC_DAY = Math.floor(
  SHOP_KEYED_LIMIT.perUtcDay * RATE_SAFETY_FACTOR,
);

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

/*
 * Odhad „koľko dní potrvá dočítanie katalógu" tu ZÁMERNE nie je.
 *
 * Býval (`anonReadDaysNeeded(pages)`): počítal dnešok ako celý deň a nepoznal
 * zvyšok dnešného rozpočtu, takže vedľa odhadu z `catalogRepo.syncStatus()`
 * hlásil o deň viac — a používateľ videl obe čísla v jednom paneli (nález review
 * z 12. 8. 2026). Jediná formula je `readDaysNeeded()` v `@/lib/shop/read-budget`;
 * tá berie aj to, čo z dnešného rozpočtu ostalo. Druhú tu nezakladaj.
 */

/* ═════════════════ 4. Živý rozpočet z `whoami` (v5, bod D2) ═══════════════ */

/**
 * Zostatok rozpočtu tak, ako ho vidí shop — `whoami.remaining`.
 *
 * `null` znamená **NEVIEME**, a to v oboch prípadoch, ktoré k nemu vedú:
 * shop pole neposlal / poslal `null` (kľúč bez dennej kvóty), alebo hodnota
 * neprešla kontrolou. Nula je platná hodnota a znamená „už nič" — preto sa
 * „nevieme" NIKDY nekóduje nulou.
 */
export interface RemainingFromWhoami {
  /** Koľko volaní s kľúčom shop ešte pustí v tejto minúte. */
  readonly perMinute: number | null;
  /** Koľko volaní s kľúčom shop ešte pustí do konca UTC dňa. */
  readonly perUtcDay: number | null;
}

/** Nič sa nepodarilo zistiť — `whoami` sa nedalo prečítať. */
export const REMAINING_UNKNOWN: RemainingFromWhoami = { perMinute: null, perUtcDay: null };

/** Odkiaľ pochádza číslo, s ktorým appka plánuje. */
export type BudgetSource = 'whoami' | 'fallback';

/** Rozpočet, s ktorým appka reálne počíta — vrátane toho, odkiaľ ho má. */
export interface KeyedBudget {
  /** Koľko volaní s kľúčom si appka dovolí v tejto minúte. */
  readonly perMinute: number;
  readonly perMinuteSource: BudgetSource;
  /** Koľko volaní s kľúčom si appka dovolí do konca UTC dňa. */
  readonly perUtcDay: number;
  readonly perUtcDaySource: BudgetSource;
  /** True, keď aspoň jedno z čísel je zo zálohy — teda keď niečo nevieme. */
  readonly hasUnknown: boolean;
}

/**
 * Hodnota zo `whoami` → `number | null`.
 *
 * Prijíma číslo aj číselný string (PHP serializuje čísla nekonzistentne, tak
 * ako to rieši `schemas.ts`). Čokoľvek, čo nie je celé nezáporné číslo, je
 * „nevieme" — vrátane `null`, `undefined`, `NaN`, `Infinity` a záporných
 * hodnôt. Zaokrúhľovať sa nesmie nahor: 1,9 zostávajúceho volania je jedno
 * volanie, nie dve.
 */
export function normalizeRemaining(value: unknown): number | null {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.floor(numeric);
}

/**
 * Nižšia z hodnôt, ktoré poznáme; `null`, keď nepoznáme ani jednu.
 *
 * Toto je zapísané pravidlo „fail-closed": neznáma hodnota sa nikdy netvári ako
 * nekonečno a nikdy nezvýši rozpočet — jednoducho sa do výberu nedostane.
 */
export function lowerOfKnown(...candidates: readonly (number | null)[]): number | null {
  const known = candidates.filter((c): c is number => c !== null);
  return known.length === 0 ? null : Math.min(...known);
}

/** Jedna vetva rozpočtu: živé číslo, inak záloha. */
function branch(live: number | null, fallback: number): { value: number; source: BudgetSource } {
  // Živé číslo má v v5 ako jediné zdroj — platí, aj keď je vyššie než záloha.
  if (live !== null) return { value: live, source: 'whoami' };
  // Nevieme: platí záloha, teda tá NIŽŠIA z dvojice {záloha, bez stropu}.
  return { value: fallback, source: 'fallback' };
}

/**
 * Rozpočet pre volania s kľúčom (bod D2 kontraktu API v5).
 *
 * `null` na vstupe = `whoami` sa nedalo prečítať vôbec; vtedy sú obe vetvy zo
 * zálohy. Keď sa prečítať dalo, ale niektoré pole chýba alebo je `null`
 * (napr. kľúč bez dennej kvóty), zo zálohy je len tá vetva — nikdy sa
 * nepredpokladá „bez stropu".
 *
 * Minútové číslo je navyše zastropované denným: za minútu sa nedá minúť viac,
 * než ostáva do konca UTC dňa.
 */
export function resolveKeyedBudget(remaining: RemainingFromWhoami | null): KeyedBudget {
  const live = remaining ?? REMAINING_UNKNOWN;

  const day = branch(live.perUtcDay, KEYED_FALLBACK_PER_UTC_DAY);
  const minute = branch(live.perMinute, KEYED_FALLBACK_PER_MINUTE);

  // Poistka 3 z hlavičky: minútový zostatok nikdy neprekročí denný.
  const cappedMinute = lowerOfKnown(minute.value, day.value) ?? minute.value;

  return {
    perMinute: cappedMinute,
    perMinuteSource: minute.source,
    perUtcDay: day.value,
    perUtcDaySource: day.source,
    hasUnknown: minute.source === 'fallback' || day.source === 'fallback',
  };
}

/**
 * Slovenská veta o tom, s akým rozpočtom appka počíta a či ho pozná naisto.
 *
 * Nepovedať nič je horšie než povedať „nevieme" — používateľ inak nemá ako
 * zistiť, či číslo na obrazovke je meraný fakt alebo odhad podľa starej
 * dokumentácie.
 */
export function keyedBudgetSentence(budget: KeyedBudget): string {
  const zostatok = `Zostáva ${budget.perMinute} volaní za minútu a ${budget.perUtcDay} do konca dňa.`;
  if (!budget.hasUnknown) return `${zostatok} Čísla hlási shop.`;
  if (budget.perMinuteSource === 'fallback' && budget.perUtcDaySource === 'fallback') {
    return `${zostatok} Sú to opatrné odhady — shop svoj zostatok teraz nepovedal.`;
  }
  const chyba = budget.perUtcDaySource === 'fallback' ? 'denný' : 'minútový';
  return `${zostatok} Shop nepovedal ${chyba} zostatok, to číslo je opatrný odhad.`;
}
