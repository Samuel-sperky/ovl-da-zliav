/**
 * Aura Zľavy — JEDINÝ ZDROJ PRAVDY O TOM, ČO PRÁVE BLOKUJE ČO.
 *
 * Používateľ sa sťažoval, že nevidí, PREČO sa niečo nestalo: produkt neprejde,
 * fronta nebeží, katalóg sa nedočíta — a appka mlčí. Dôvody pritom v kóde
 * existujú, len sú rozsypané po ôsmich moduloch (`engine/guards.ts`,
 * `engine/budget.ts`, `repo/settings.repo.ts`, `repo/api-key.repo.ts`,
 * `shop/catalog-sync.ts`, `shop/rate-limits.ts`, `env.ts`, `scheduler/queue.ts`)
 * a každý z nich hovorí vlastným jazykom. Tento modul z nich robí JEDEN zoznam
 * prekážok, ktorý UI už len vykreslí.
 *
 * ČO TENTO MODUL JE A ČO NIE JE
 * -----------------------------
 * Je **čistý**: žiadna DB, žiadny fetch, žiadne `process.env`, žiadne
 * vyhodnocovanie na module scope. Dostane jeden `StatusSnapshot` (fakty, ktoré
 * si volajúci prečítal) a vráti zoznam `Blocker`-ov. Nič nerozhoduje o zápise —
 * o tom rozhoduje `engine/guards.ts`. Tento modul len POMENÚVA, čo tá brána
 * urobí a prečo, aby sa to používateľ dozvedel skôr než z logu.
 *
 * FAIL-CLOSED JE TU PRAVIDLO, NIE VÝNIMKA
 * ---------------------------------------
 * Chýbajúci alebo neznámy údaj sa VŽDY vyhodnotí prísnejšie, nikdy voľnejšie —
 * presne ako v `guards.resolveScope()` („neviem" = `pilot`) a v
 * `budget.resolveDailyBudget()` („neviem" = 1 zápis na deň). Prázdny snapshot
 * preto nevráti „všetko je v poriadku", ale plný zoznam prekážok, kde každá
 * nesie `assumed: true` — veta stojí na domnienke, nie na overenom fakte.
 *
 * Jediná dokumentovaná výnimka je sekcia `catalogReads`: čítací rozpočet
 * katalógu NEBRÁNI zápisu (čítania idú bez kľúča, na inú kvótu — viď
 * `shop/rate-limits.ts`), takže keď sa naň volajúci nepýta (sekcia v snapshote
 * vôbec nie je), modul o ňom mlčí. Keď sa pýta a hodnoty nepozná, platí
 * fail-closed ako všade inde.
 *
 * ČO SA V TOMTO MODULE NESMIE POKAZIŤ
 * -----------------------------------
 *  1. **Veta, ktorá BLOKUJE, musí niesť obe čísla.** Nie „limit prekročený",
 *     ale „Na jednu zľavu prejde najviac 10 produktov, vo výbere je 150 —
 *     140 sa nezapíše". Bez čísel je to zase log.
 *
 *     Veta, ktorá len INFORMUJE (`severity: 'informuje'`, výber je pod stropom
 *     alebo neexistuje), nesie od 20. 8. 2026 už len samotný strop. Druhé
 *     číslo tam bolo tretí raz to isté: na Produktoch ho hovorí lišta výberu,
 *     na Prehľade výber vôbec neexistuje a na Novej zľave stojí v dominante.
 *     Slovo „režim" z tej vety zmizlo tiež — `pilot`/`plny` je vnútorný kód,
 *     nie pojem povrchu (P3). Čo sa tým smie TICHO pokaziť: keby sem niekto
 *     vrátil počet vybraných produktov, tá istá veta na Produktoch povie
 *     číslo, ktoré je o dva riadky vyššie, a používateľ začne hľadať, čím sa
 *     tie dve od seba líšia. Nič nespadne, len sa prestane veriť obom.
 *  2. **`severity` NIE JE farba.** `blokuje` znamená „teraz cez to nič
 *     neprejde", nie „červená". Vyčerpaný denný rozpočet je `blokuje` +
 *     `resolution: 'cakanie'`, a `ui/vocabulary.ts` mu dáva neutrálny tón (K2,
 *     odpoveď 59) — UI si farbu volí podľa `resolution`, nie podľa závažnosti.
 *  3. **`resolution === 'cakanie'` ⟺ `passableNow === false`.** Kto tvrdí, že sa
 *     čaká, musí povedať aj na čo (`clearsAt`), a naopak.
 *  4. **Čísla sa neduplikujú, importujú sa.** Limity čítania prichádzajú
 *     z `@/lib/shop/rate-limits` — tam sa raz na tejto zámene („300 za deň" vs
 *     „300 za minútu") rozbil celý katalóg a druhá kópia by to zopakovala.
 *     To isté platí pre ODHADY: koľko dní potrvá dočítanie katalógu, počíta
 *     `readDaysNeeded()` z `@/lib/shop/read-budget` — tá istá funkcia ako
 *     v `catalogRepo.syncStatus()`. Kým si tento modul počítal vlastnou
 *     formulou, vedľa seba v jednom paneli stáli dva odhady, ktoré sa líšili
 *     o deň. A keď odhad prišiel už spočítaný v snapshote, použije sa ON:
 *     `syncStatus()` pozná pokrok prechodu, tento modul len počty riadkov.
 *  5. **Veta nehovorí to, čo už povedal zámok.** `resolution: 'sudo'` sa vedľa
 *     každej vety kreslí ikonou zámku a slovom „rieši sa v appke, vypýta si
 *     heslo" (`ui/blocker-look.ts`). Kým `nextStep` pri pilotnom strope končil
 *     na „— prepnutie si vyžiada heslo", stálo to isté na piatich obrazovkách
 *     dvakrát vedľa seba a veta mala 103 znakov (P2 dáva 90). Od 20. 8. 2026
 *     znie „Zúžte výber na 10 produktov, alebo prepnite rozsah v Nastaveniach."
 *     — 66 znakov. Čo sa tým smie TICHO pokaziť: keby niekto `resolution`
 *     prepol z `sudo` na `sam`, zámok zmizne a heslo už nepovie NIKTO —
 *     používateľ klikne do Nastavení a nečakane naň vyskočí sudo okno. Tú
 *     dvojicu (`pilot` ⟹ `sudo`) preto stráži `test/unit/slovnik-prekazky.spec.ts`.
 *  6. **Dátum vo vete prechádza cez `formatDateSk`.** `writeBudget.day` je
 *     `YYYY-MM-DD` — prenosový tvar, nie tvar, v akom sa dátum po slovensky
 *     píše. Do 20. 8. 2026 sa vypisoval priamo a na povrchu stálo „(UTC deň
 *     2026-08-12)". Nespadlo nič: `${day}` je legálny `string`, typecheck
 *     mlčí, a `test/unit/datumy-povrch.spec.ts` to nechytil, lebo číta
 *     reťazcové LITERÁLY v `src/` — a ISO tvar tam nie je, ten prichádza až
 *     zo snímky za behu. Chytiť sa to dá jedine prečítaním hotovej vety, čo
 *     robí `test/unit/slovnik-prekazky.spec.ts`.
 *
 *     ROZHODNUTIE Z 24. 8. 2026 (relatívny čas v odhade fronty). `nextStep`
 *     pri `write_budget_low` hovoril „hotovo bude približne o 3 dni". Appka
 *     inde (dlaždice fronty, `estimate.date`) hovorí konkrétny deň, takže dve
 *     odpovede na tú istú otázku stáli na tých istých obrazovkách vedľa seba.
 *     Deň sa počíta TU, čistou funkciou `finishDay()` — nepribudlo pole do
 *     `StatusSnapshot`. Dôvod: `needsDays` si tento modul aj tak počíta sám
 *     (`daysToFinish()`), takže deň je z neho len `addDays` nad UTC dnešným,
 *     teda tá istá aritmetika ako `estimateFinish().date`. Nové pole by
 *     znamenalo drôt (`WriteBudgetWire` v `status/snapshot.ts`), serializáciu
 *     na oboch koncoch a serverového producenta pre číslo, ktoré je zo snímky
 *     dopočítateľné. `catalog.estimatedFinishAt` je iný prípad a preto v snímke
 *     ostáva: server tam pozná pokrok prechodu (`last_page`), čiže vie niečo,
 *     čo tento modul naozaj nevie.
 *     Čo sa tým smie TICHO pokaziť: `finishDay()` a `daysToFinish()` zrkadlia
 *     `engine/budget.ts`, ktorý sa sem importovať nedá. Keby sa tam zmenila
 *     zóna rozpočtu alebo zaokrúhľovanie, tu by o tom nikto nevedel — zhodu
 *     preto stráži `test/unit/status-blockers.spec.ts` nad ORIGINÁLMI.
 *     Čo tento bod NEPOKRÝVA: odhad dočítania katalógu (`catalog_incomplete`)
 *     stále hovorí „približne za 2 dni". Dátum tam k dispozícii je (`clearsAt`),
 *     ale prepnutie by prepísalo tvrdenia, ktoré v teste držia „jeden odhad,
 *     nie dva" — je to samostatná úloha.
 *
 *  7. **Fail-closed veta sa skracuje vypustením domnienky, nie dôsledku.**
 *     Vety s `assumed: true` mali 91 až 166 znakov (P2 dáva 90) a všetky
 *     hovorili to isté dvakrát: „Nevieme X — kým to nevieme, appka počíta
 *     s tým, že Y, a preto Z." Že veta stojí na domnienke, kreslí UI samo
 *     (`assumed` → „appka to nevie"), takže vnútorné „kým to nevieme, počíta
 *     s tým, že Y" bolo tretie zopakovanie tej istej informácie. Od
 *     24. 8. 2026 znejú „Nevieme X — appka preto Z." a zmestia sa do 90.
 *     Čo sa NESKRACUJE: dôsledok (Z) a číslo, ktoré ho robí konkrétnym.
 *     Čo sa tým smie TICHO pokaziť: keby UI prestalo `assumed` priznávať,
 *     fail-closed veta začne znieť ako meraný fakt — appka bude tvrdiť, že
 *     zápisy sú vypnuté, hoci len nevie, či sú zapnuté. Preto to `assumed`
 *     musí kresliť povrch, nie veta.
 *
 *  8. **MERANÁ veta sa skracuje vypustením mechaniky, nie čísel.** Bod 7
 *     zavrel domnienky; 24. 8. 2026 dobehol zvyšok. Šesť meraných viet bolo
 *     nad P2 (90): `key_expires_soon` 148, `write_budget_exhausted` 118,
 *     `write_budget_low` 118, `scope_full_cap` 107, `catalog_reads_minute_`
 *     `exhausted` 99, `scope_pilot_cap` 98. Vypustilo sa z nich to, ČÍM appka
 *     k číslu prišla, nie samo číslo ani dôsledok: „pri 200 zápisoch na deň",
 *     „ktoré shop pustí za jeden UTC deň", „ktoré si appka dovolí", „a odloží
 *     zvyšok na neskôr", druhé „produktov" a prívlastok „zvyšných". Technika
 *     patrí pod rozklik (P6) — a veta o strope tým dostala presne ten tvar,
 *     ktorý ako vzor uvádza bod 1.
 *
 *     Čo sa NEVYPUSTILO ani raz: obe čísla blokujúcej vety (bod 1), náš strop
 *     vedľa stropu shopu pri čítaniach (`engine/budget.ts` to žiada oboma
 *     smermi) a dôsledok. `key_expires_soon` je hraničný prípad a stojí za
 *     vysvetlenie: z vety vypadol POČET čakajúcich produktov, teda číslo.
 *     Smelo, pretože veta neporovnáva produkty, ale hodiny kľúča s dňami
 *     fronty — a `Fronta 3 420/8 000` stojí v hlavičke KAŽDEJ stránky, takže
 *     to bolo tretí raz to isté, presne z toho dôvodu, pre ktorý bod 1
 *     škrtol druhé číslo z informatívnej vety o strope.
 *
 *     Čo sa tým smie TICHO pokaziť: rezerva je tesná. Najdlhšia veta po
 *     skrátení má 88 znakov (`scope_full_cap` pri strope 10 000 a výbere
 *     12 000) a čísla v týchto vetách rastú s inštaláciou — pri rozpočte
 *     1 zápis na deň (fail-closed) povie `key_expires_soon` „11 999 dní".
 *     Kto pridá do niektorej vety slovo, nemusí prekročiť limit na svojich
 *     dátach a prekročí ho na ostrých. Preto to nemeria oko, ale
 *     `test/unit/slovnik-prekazky.spec.ts` sekcia 8 — PLOŠNE nad všetkými
 *     vetami a nad maticou, ktorá tie najširšie čísla zámerne vyrába.
 *
 * PREČO JE TU PREDSA ŠESŤ ZRKADLENÝCH KONŠTÁNT
 * --------------------------------------------
 * `PILOT_MAX_PRODUCTS`, `HARD_MAX_PRODUCTS`, `FAIL_CLOSED_DAILY_BUDGET`,
 * `API_KEY_MAX_TTL_HOURS`, `CATALOG_PAGE_SIZE` a `BUDGET_TIME_ZONE` žijú
 * v moduloch, ktoré ťahajú
 * `@/db/pool`, a s ním `mariadb` a `node:fs`. Tento modul musí zostať
 * použiteľný aj v client komponente (rovnako ako `ui/vocabulary.ts`), takže si
 * ich zrkadlí ako lokálne konštanty. Aby sa kópie nerozišli, zhodu čísel
 * kontroluje `test/unit/status-blockers.spec.ts` — importuje ORIGINÁLY a
 * porovná ich s tunajšími. Rozídenie hodnôt zhodí test, nie produkciu.
 *
 * Vlastník: S1.
 */
import type { DateOnly } from '@/contracts';
import type { ScopeMode } from '@/lib/repo/settings.repo';

// Čistý modul bez DB a bez `env` — smie sa importovať aj v client komponente,
// rovnako ako `shop/read-budget.ts` nižšie. Vety o odmietnutom čítaní
// objednávok sa píšu TAM a odtiaľ ich berie aj `sales/sync-runner.ts`; druhá
// kópia tých istých viet by sa s prvou rozišla.
import {
  salesBlockNextStep,
  salesBlockWhat,
  type SalesBlockKind,
} from '@/lib/sales/stop-policy';

// Deň dobehnutia fronty sa počíta TOU ISTOU aritmetikou ako
// `estimateFinish().date` v `engine/budget.ts` (bod 6 hlavičky): `addDays` nad
// UTC dňom. `domain/dates.ts` neimportuje `@/db/pool` (len `@date-fns/tz`
// a `domain/errors.ts`, ktorý neimportuje nič), takže client-safe modul zostáva.
import { addDays, todayInZone } from '@/lib/domain/dates';
import {
  ANON_READS_PER_MINUTE,
  ANON_READS_PER_UTC_DAY,
  SHOP_ANON_LIMIT,
  nextUtcDayReset,
} from '@/lib/shop/rate-limits';
// Dni do dočítania katalógu počíta TÁ ISTÁ funkcia ako `catalogRepo.syncStatus()`
// (bod 4 hlavičky). `shop/read-budget.ts` je čistý modul bez DB, takže sa smie
// importovať aj v client komponente — na rozdiel od repozitára.
import { readDaysNeeded } from '@/lib/shop/read-budget';
// Dátum na povrchu kreslí JEDINÝ formátovač appky (kontrakt UI bod 10, bod 6
// hlavičky). `ui/format.ts` neimportuje nič, takže client-safe modul zostáva.
import { formatDateSk, formatDateTimeSk } from '@/lib/ui/format';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

/* ══════════════════ 1. Zrkadlené konštanty (stráži ich test) ═══════════════ */

/** Zhoda s `PILOT_MAX_PRODUCTS` v `repo/settings.repo.ts` (K1). */
export const PILOT_MAX_PRODUCTS = 10;

/** Zhoda s `HARD_MAX_PRODUCTS` v `repo/settings.repo.ts` (`ck_settings_max_products`). */
export const HARD_MAX_PRODUCTS = 10_000;

/** Zhoda s `FAIL_CLOSED_DAILY_BUDGET` v `engine/budget.ts` — „neviem" = 1/deň. */
export const FAIL_CLOSED_DAILY_BUDGET = 1;

/** Zhoda s `API_KEY_MAX_TTL_HOURS` v `repo/api-key.repo.ts` (R2). */
export const API_KEY_MAX_TTL_HOURS = 48;

/** Zhoda s `CATALOG_PAGE_SIZE` v `shop/catalog-sync.ts` — stránka katalógu. */
export const CATALOG_PAGE_SIZE = 100;

/**
 * Zhoda s `BUDGET_TIME_ZONE` v `engine/budget.ts` — zápisový rozpočet beží
 * v UTC. Zámerne NIE `READ_BUDGET_TIME_ZONE` zo `shop/read-budget.ts`, hoci má
 * dnes tú istú hodnotu: sú to dve kvóty s dvomi vlastníkmi (bod 4 hlavičky)
 * a zliatie do jednej konštanty by z posunu jednej ticho posunulo druhú.
 */
export const BUDGET_TIME_ZONE = 'UTC';

/**
 * Od koľkých zostávajúcich hodín sa o platnosti kľúča hovorí nahlas. Nie je to
 * limit shopu, je to rozhodnutie povrchu: pod pol dňa už má zmysel kľúč
 * vymeniť skôr, než sa fronta zastaví uprostred noci.
 */
export const KEY_WARNING_HOURS = 12;

/**
 * Minútový strop shopu je KLZAVÉ okno a jeho začiatok appka nepozná. Najhorší
 * možný prípad je celá minúta od teraz — a fail-closed sa hovorí najhorší
 * prípad, nie ten pekný.
 */
const MINUTE_MS = 60_000;

/** Koľko ID sa vypíše do vety, kým sa začne písať „a ďalšie". */
const SAMPLE_IDS = 5;

/* ═══════════════════════════════ 2. Typy ══════════════════════════════════ */

/**
 * Závažnosť prekážky.
 *
 *  - `blokuje`    — teraz cez to neprejde nič (produkt sa nezapíše, fronta stojí),
 *  - `obmedzuje`  — časť prejde, časť nie (alebo prejde pomalšie),
 *  - `informuje`  — nič nezastavuje, ale patrí to do obrazu (napr. platný strop).
 */
export type BlockerSeverity = 'blokuje' | 'obmedzuje' | 'informuje';

/** Oblasť, z ktorej prekážka pochádza — UI podľa nej zoskupuje. */
export type BlockerArea = 'zapisy' | 'kluc' | 'rozpocet' | 'rozsah' | 'katalog' | 'citanie';

/** Čoho sa prekážka týka: celej operácie, alebo konkrétnych produktov. */
export type BlockerSubject = 'operacia' | 'produkt';

/**
 * Ako sa prekážka odstráni.
 *
 *  - `sam`        — používateľ to vyrieši sám v appke (`path`),
 *  - `sudo`       — cesta v appke existuje, ale vyžiada si heslo (sudo okno),
 *  - `cakanie`    — nedá sa urobiť nič, čaká sa (`clearsAt`),
 *  - `mimo_appky` — rieši sa mimo appky (konfigurácia počítača).
 */
export type BlockerResolution = 'sam' | 'sudo' | 'cakanie' | 'mimo_appky';

/**
 * Stabilné ID prekážky. Je to KĽÚČ, nie text — na povrch sa nikdy nevypisuje
 * (K10), UI podľa neho páruje ikonu, poradie a prípadný vlastný widget.
 */
export type BlockerId =
  | 'writes_disabled'
  | 'key_missing'
  | 'key_expired'
  | 'key_expires_soon'
  | 'write_budget_exhausted'
  | 'write_budget_low'
  | 'scope_unknown'
  | 'scope_pilot_cap'
  | 'scope_full_cap'
  | 'catalog_unknown'
  | 'catalog_product_missing'
  | 'catalog_incomplete'
  | 'catalog_reads_day_exhausted'
  | 'catalog_reads_minute_exhausted'
  | 'sales_reads_forbidden'
  | 'sales_reads_ip_banned';

/**
 * Kanonické poradie prekážok v rámci rovnakej závažnosti. Zoznam je zámerne
 * ručný, nie abecedný: hore je to, čo zastaví VŠETKO (vypnuté zápisy, chýbajúci
 * kľúč), dole to, čo len spomaľuje. Poradie je súčasťou správania a testuje sa —
 * UI ho nesmie prehadzovať.
 */
export const BLOCKER_ORDER: readonly BlockerId[] = [
  'writes_disabled',
  'key_missing',
  'key_expired',
  'write_budget_exhausted',
  'scope_unknown',
  'scope_pilot_cap',
  'scope_full_cap',
  'catalog_unknown',
  'catalog_product_missing',
  'catalog_incomplete',
  'write_budget_low',
  'key_expires_soon',
  'sales_reads_ip_banned',
  'sales_reads_forbidden',
  'catalog_reads_day_exhausted',
  'catalog_reads_minute_exhausted',
];

/** Poradie závažností. Nižšie číslo = vyššie v zozname. */
export const SEVERITY_ORDER: Readonly<Record<BlockerSeverity, number>> = {
  blokuje: 0,
  obmedzuje: 1,
  informuje: 2,
};

/**
 * Cesty v appke, kam prekážky vedú. Jediné miesto, kde sa píšu ako reťazce —
 * a zámerne sú tu len tie, ktoré niektorá prekážka naozaj používa. Cesta, ktorú
 * nikam nevedie žiadna prekážka, by bola sľub, čo tento modul nedrží.
 */
export const BLOCKER_PATHS = {
  settings: '/nastavenia',
  products: '/produkty',
} as const;

/** Jedna prekážka — jeden riadok v zozname „čo práve blokuje čo". */
export interface Blocker {
  readonly id: BlockerId;
  readonly area: BlockerArea;
  readonly severity: BlockerSeverity;
  /** Či ide o prekážku celej operácie, alebo konkrétnych produktov. */
  readonly subject: BlockerSubject;
  /** Ktorých produktov sa týka. Prázdne pole pri `subject === 'operacia'`. */
  readonly productIds: readonly number[];
  /** ČO sa deje — slovenská veta s konkrétnymi číslami. */
  readonly what: string;
  /** ČO S TÝM — konkrétny ďalší krok, slovensky. */
  readonly nextStep: string;
  /** Kam v appke to vedie. `null` = v appke sa to vyriešiť nedá. */
  readonly path: string | null;
  /** Kto a ako prekážku odstráni. */
  readonly resolution: BlockerResolution;
  /** `true` = dá sa prekonať hneď. `false` = musí sa počkať (viď `clearsAt`). */
  readonly passableNow: boolean;
  /** Kedy sa prekážka sama uvoľní. `null` = čas s ňou nepohne. */
  readonly clearsAt: Date | null;
  /**
   * `true` = veta stojí na fail-closed domnienke, lebo údaj chýbal alebo bol
   * neznámy. UI to MÁ priznať — appka sa nesmie tváriť, že niečo vie.
   */
  readonly assumed: boolean;
}

/* ─────────────────────────── vstupný snapshot ─────────────────────────── */

/**
 * Poistky zápisu z `env.ts`. `enabled` je celé `writesAllowedByEnv()`, teda
 * `NODE_ENV=production && WRITES_ENABLED=true` (I13, D77) — nie samotná
 * premenná, aby sa polovica poistky nedala prehliadnuť.
 */
export interface WritesSnapshot {
  /** `null`/chýba = nevieme → fail-closed sa berie ako vypnuté. */
  readonly enabled?: boolean | null;
}

/** Rozsah podľa `guards.readScopeForWrite()` / `settingsRepo.readScope()` (K1). */
export interface ScopeSnapshot {
  /** `null`/chýba = nevieme → fail-closed `pilot`. */
  readonly mode?: ScopeMode | null;
  /** Efektívny strop na jednu operáciu (`ResolvedScope.maxProducts`). */
  readonly maxProducts?: number | null;
  /** `true` = hodnoty sú fail-closed default, nie čítanie z DB (K1 bod 1). */
  readonly failClosed?: boolean | null;
}

/** Čo sa práve chystá zapísať. */
export interface SelectionSnapshot {
  /** Koľko produktov operácia chce zapísať. Chýba = dopočíta sa z `productIds`. */
  readonly selectedCount?: number | null;
  /** Konkrétne ID vo výbere (voliteľné — pri veľkých výberoch sa neposielajú). */
  readonly productIds?: readonly number[] | null;
}

/** Stav zrkadla katalógu (`catalog_cache`, K7 + K1 bod 2). */
export interface CatalogSnapshot {
  /** Koľko riadkov katalóg appky má (`catalogRepo.totalRows()`). */
  readonly loadedProducts?: number | null;
  /** Koľko produktov hlási shop (`CatalogSyncResult.total`). */
  readonly shopTotalProducts?: number | null;
  /**
   * Vybrané ID, ktoré v katalógu nie sú alebo ich shop nenašiel (`not_found`).
   * Prázdne pole = overené, nechýba nič. `null`/chýba = NEOVERENÉ (fail-closed).
   */
  readonly missingProductIds?: readonly number[] | null;
  /**
   * Koľko ďalších UTC dní potrvá dočítanie — už spočítané serverom
   * (`catalogRepo.syncStatus().estimatedDaysLeft`). Keď chýba, modul si ho
   * dopočíta tou istou funkciou z počtov riadkov; serverovo číslo je ale
   * presnejšie, lebo pozná pokrok prechodu (`last_page`), nie len počty.
   */
  readonly estimatedDaysLeft?: number | null;
  /** Odhad dokončenia od servera (presnosť na deň) — `clearsAt` prekážky. */
  readonly estimatedFinishAt?: Date | null;
}

/** Denný zápisový rozpočet (`BudgetStatus` z `engine/budget.ts`, K2). */
export interface WriteBudgetSnapshot {
  readonly budget?: number | null;
  readonly spent?: number | null;
  /** UTC deň, za ktorý sa počítalo (`YYYY-MM-DD`). */
  readonly day?: DateOnly | null;
}

/** Kľúč na zápis do shopu (`apiKeyRepo.getMeta()`, R2/D63). */
export interface ApiKeySnapshot {
  /** `null`/chýba = nevieme → fail-closed sa berie, že kľúč nie je. */
  readonly present?: boolean | null;
  /** Dokedy platí. `null` pri chýbajúcom kľúči; neznáme pri vloženom = prísnejšie. */
  readonly expiresAt?: Date | null;
}

/**
 * Čítací rozpočet katalógu (anonymné volania, `shop/rate-limits.ts`).
 *
 * Sekcia je ZÁMERNE opt-in: čítanie katalógu ide bez kľúča a na inú kvótu než
 * zápisy, takže vyčerpané čítania NEBRÁNIA zápisu. Keď sa volajúci na katalóg
 * nepýta, sekciu neposiela a modul o nej mlčí.
 */
export interface CatalogReadsSnapshot {
  /** Koľko anonymných čítaní odišlo za poslednú minútu. */
  readonly usedThisMinute?: number | null;
  /** Koľko ich odišlo za aktuálny UTC deň. */
  readonly usedThisUtcDay?: number | null;
}

/**
 * Synchronizácia predajnosti (`lib/sales/stop-policy.ts`).
 *
 * Sekcia je ZÁMERNE opt-in, z rovnakého dôvodu ako `catalogReads`: čítanie
 * objednávok beží na vlastnom kľúči a vlastnej kvóte, takže odmietnuté čítanie
 * predajov NEBRÁNI zápisu zliav. Keď sa volajúci na predajnosť nepýta, sekciu
 * neposiela a modul o nej mlčí.
 *
 * A tu fail-closed NEPLATÍ ani vnútri sekcie: chýbajúce `kind` znamená „shop
 * nás neodmieta", nie „asi nás odmieta". Vymyslieť odmietnutie, ktoré sa
 * nestalo, by poslalo človeka prestavovať kľúč, ktorý je v poriadku.
 */
export interface SalesSyncSnapshot {
  /** Druh trvalej prekážky. `null`/chýba = žiadna netrvá. */
  readonly block?: SalesBlockKind | null;
  /** Odkedy prekážka stojí. */
  readonly since?: Date | null;
  /** Kedy sa appka ozve jednou overovacou požiadavkou. `null` = na rozvrhu nikdy. */
  readonly probeAt?: Date | null;
}

/**
 * Všetko, čo modul potrebuje vedieť. Každá sekcia je voliteľná a každá chýbajúca
 * hodnota znamená „neviem" — a „neviem" sa vyhodnotí prísnejšie.
 */
export interface StatusSnapshot {
  /** Referenčný čas. Default `new Date()`; testy si posielajú vlastný. */
  readonly now?: Date;
  readonly writes?: WritesSnapshot;
  readonly apiKey?: ApiKeySnapshot;
  readonly writeBudget?: WriteBudgetSnapshot;
  readonly scope?: ScopeSnapshot;
  readonly selection?: SelectionSnapshot;
  readonly catalog?: CatalogSnapshot;
  readonly catalogReads?: CatalogReadsSnapshot;
  readonly salesSync?: SalesSyncSnapshot;
}

/** Zhrnutie zoznamu — jedna odpoveď na otázku „ide to, alebo nie?". */
export interface BlockerSummary {
  /** Celý zoznam, zoradený podľa závažnosti (`sortBlockers`). */
  readonly blockers: readonly Blocker[];
  /** Len tie, cez ktoré teraz neprejde nič. */
  readonly blocking: readonly Blocker[];
  /** `true` = aspoň jedna prekážka má závažnosť `blokuje`. */
  readonly blocked: boolean;
  /** Najbližší čas, keď sa niečo pohne samo. `null` = čakaním sa nič nezmení. */
  readonly waitUntil: Date | null;
}

/* ═══════════════════ 3. Pomocníci (čísla, slovenčina) ═════════════════════ */

/** Celé nezáporné číslo, alebo `null` pri čomkoľvek, čo sa nedá prečítať. */
function readCount(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const truncated = Math.trunc(value);
  return truncated < 0 ? null : truncated;
}

/** Boolean, alebo `null` pri čomkoľvek inom (vrátane `undefined`). */
function readFlag(value: boolean | null | undefined): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** Platný `Date`, alebo `null`. `Invalid Date` je „neviem", nie čas. */
function readDate(value: Date | null | undefined): Date | null {
  if (!(value instanceof Date)) return null;
  return Number.isFinite(value.getTime()) ? value : null;
}

/** `1` → „1 produkt", `3` → „3 produkty", `150` → „150 produktov". */
function products(count: number): string {
  return `${formatCountSk(count)} ${pluralSk(count, 'produkt', 'produkty', 'produktov')}`;
}

/**
 * To isté v GENITÍVE — „z 1 produktu", „z 3 produktov", „z 150 produktov".
 *
 * Prečo to nie je jedna funkcia: `products()` vracia nominatív („1 produkt",
 * „3 produkty"), ktorý je správny po „najviac" a „vo výbere je". Po predložke
 * „z"/„Z" je ale nominatív chyba, a do 24. 8. 2026 tam stál: veta o chýbajúcich
 * produktoch hovorila „1 produkt Z 1 PRODUKT vo výbere appka v katalógu
 * nevidí", odhad dočítania „z 3 produkty" a veta o zvyšku rozpočtu „Z 3
 * produkty sa dnes zapíše 2".
 *
 * Čo sa tým smie TICHO pokaziť: `${products(n)}` po „z" je legálny `string`,
 * takže typecheck mlčí a testy, ktoré hľadajú reťazcové literály v `src/`,
 * nenájdu nič — tvar vzniká až za behu zo snímky. Chytiť sa to dá jedine
 * prečítaním hotovej vety, čo robí `test/unit/slovnik-prekazky.spec.ts`
 * (plošný zákaz zlého pádu po „z" nad VŠETKÝMI vetami, nie po jednej).
 *
 * Pozor na 2–4: genitív plurálu je „produktov", nie „produkty" — preto sa
 * `few` a `many` nelíšia a `pluralSk` sa tu volá zámerne s tým istým slovom
 * dvakrát, nie omylom.
 */
function productsGenitive(count: number): string {
  return `${formatCountSk(count)} ${pluralSk(count, 'produktu', 'produktov', 'produktov')}`;
}

/** Sloveso „je"/„sú" podľa slovenskej zhody (2–4 → „sú"). */
function isAre(count: number): string {
  return count >= 2 && count <= 4 ? 'sú' : 'je';
}

/**
 * „1 sa nezapíše" / „3 sa nezapíšu" / „140 sa nezapíše".
 *
 * Prívlastok „zvyšný/zvyšné/zvyšných" tu do 24. 8. 2026 stál a ťahal vetu
 * o strope nad P2 (90). Vypadol preto, že to isté už povedal zvyšok vety:
 * po „prejde najviac 10, vo výbere je 150" je 140 zvyšok a nič iné. Presne
 * v tomto tvare stojí veta aj v bode 1 hlavičky ako VZOR („— 140 sa nezapíše").
 */
function remainderPhrase(count: number): string {
  const verb = count >= 2 && count <= 4 ? 'nezapíšu' : 'nezapíše';
  return `${formatCountSk(count)} sa ${verb}`;
}

/** „1 deň" / „3 dni" / „12 dní". */
function days(count: number): string {
  return `${formatCountSk(count)} ${pluralSk(count, 'deň', 'dni', 'dní')}`;
}

/** „1 hodinu" / „3 hodiny" / „12 hodín" — akuzatív do „platí ešte …". */
function hoursAccusative(count: number): string {
  return `${formatCountSk(count)} ${pluralSk(count, 'hodinu', 'hodiny', 'hodín')}`;
}

/** Vzorka ID do vety; nad `SAMPLE_IDS` sa dopíše, koľko ďalších je. */
function sampleIds(ids: readonly number[]): string {
  const shown = ids.slice(0, SAMPLE_IDS).join(', ');
  const rest = ids.length - SAMPLE_IDS;
  return rest > 0 ? `${shown} a ďalších ${formatCountSk(rest)}` : shown;
}

/** Celé hodiny medzi dvoma časmi (vždy nezáporné). */
function hoursBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 3_600_000));
}

/**
 * Koľko ĎALŠÍCH UTC dní bude fronta bežať. Zámerne rovnaká aritmetika ako
 * `estimateFinish()` v `engine/budget.ts` (ktorý sa sem nedá importovať —
 * ťahá `@/db/pool`); zhodu výsledkov stráži test.
 *
 * Je to ZÁPISOVÁ strana (K2). Čítacia má vlastnú kvótu aj vlastného vlastníka
 * a počíta ju `readDaysNeeded()` z `@/lib/shop/read-budget` — arytmetika je tá
 * istá, ale zliať ich do jednej funkcie by znamenalo, že zmena stropu zápisov
 * ticho pohne odhadom katalógu.
 */
function daysToFinish(pending: number, perDay: number, remainingToday: number): number {
  if (pending <= 0) return 0;
  const speed = Math.max(1, perDay);
  const today = Math.min(speed, Math.max(0, remainingToday));
  if (pending <= today) return 0;
  return Math.ceil((pending - today) / speed);
}

/**
 * UTC deň, kedy fronta dobehne — ten istý tvar aj tá istá aritmetika ako
 * `estimateFinish().date` v `engine/budget.ts` (`addDays` nad `budgetDay`).
 * Vracia `DateOnly`, do vety ide cez `formatDateSk` (bod 6 hlavičky).
 */
function finishDay(now: Date, days: number): DateOnly {
  return addDays(todayInZone(now, BUDGET_TIME_ZONE), Math.max(0, days));
}

/**
 * Spoločný tvar „nemusíte nič robiť".
 *
 * Do 24. 8. 2026 znel „Netreba robiť nič — pokračuje to samo" (37 znakov).
 * Všetkých šesť viet, ktoré ho používajú, za ním pokračovalo vlastným
 * „…a fronta pokračuje sama" / „…synchronizácia pokračuje sama" — teda to isté
 * druhýkrát, a dvadsať znakov, ktoré každú z tých viet ťahalo nad P2 (90).
 * Čo sa tým smie TICHO pokaziť: keby niekto za dvojbodku napísal vetu, ktorá
 * NEPOVIE, že sa to pohne samo, prekážka `resolution: 'cakanie'` prestane
 * hovoriť, na čo sa čaká — a to je presne mŕtvy bod z bodu 3 hlavičky.
 */
const WAIT_STEP = 'Netreba robiť nič';

/* ═════════════════ 4. Normalizácia snapshotu (fail-closed) ════════════════ */

interface ResolvedScope {
  readonly mode: ScopeMode;
  /** `false` = režim sme neprečítali, platí fail-closed `pilot` (K1 bod 1). */
  readonly known: boolean;
  /** Efektívny strop na jednu operáciu (v `pilot` vždy 10). */
  readonly maxProducts: number;
  /** `true` = strop je fail-closed náhrada, nie hodnota z nastavení. */
  readonly capAssumed: boolean;
}

/**
 * Rozsah presne podľa `guards.resolveScope()` a `settings.effectiveMaxProducts()`:
 * čokoľvek iné než vedome prečítané `plny` je `pilot` so stropom 10, a strop
 * v `plny` sa zastropuje tvrdým DB stropom.
 */
function resolveScope(scope: ScopeSnapshot | undefined): ResolvedScope {
  const failClosed = readFlag(scope?.failClosed) === true;
  const mode = scope?.mode;
  const knownMode = mode === 'pilot' || mode === 'plny';

  if (!knownMode || failClosed || mode === 'pilot') {
    return {
      mode: 'pilot',
      known: knownMode && !failClosed,
      // V `pilot` je strop 10 vždy — nie je to náhrada, je to samotné pravidlo.
      maxProducts: PILOT_MAX_PRODUCTS,
      capAssumed: false,
    };
  }

  const raw = readCount(scope?.maxProducts);
  const capKnown = raw !== null && raw >= 1;
  const maxProducts = capKnown ? Math.min(HARD_MAX_PRODUCTS, raw) : PILOT_MAX_PRODUCTS;
  return { mode: 'plny', known: true, maxProducts, capAssumed: !capKnown };
}

/** Koľko produktov je vo výbere. `null` = volajúci to nepovedal. */
function resolveSelectedCount(selection: SelectionSnapshot | undefined): number | null {
  const explicit = readCount(selection?.selectedCount);
  if (explicit !== null) return explicit;
  const ids = selection?.productIds;
  return Array.isArray(ids) ? ids.length : null;
}

/* ═══════════════════ 5. Jednotlivé oblasti prekážok ═══════════════════════ */

/** 5.1 — env poistky zápisu (I13, D77). Bez nich sa nezapíše nič. */
function writesBlockers(snapshot: StatusSnapshot): Blocker[] {
  const enabled = readFlag(snapshot.writes?.enabled);
  if (enabled === true) return [];
  const assumed = enabled === null;

  return [
    {
      id: 'writes_disabled',
      area: 'zapisy',
      severity: 'blokuje',
      subject: 'operacia',
      productIds: [],
      // Obe vetvy musia povedať, že to NIE JE o výbere: bez tej časti prečíta
      // používateľ „nezapíše nič" ako dôsledok svojho VÝBERU, zúži ho a stlačí
      // Zaradiť znova. Za tú časť si veta 20. 8. 2026 vypýtala výnimku z P2
      // (96 znakov), lenže fail-closed dvojča ju 24. 8. 2026 povedalo v 87 —
      // „bez ohľadu na výber" namiesto „nech je vo výbere čokoľvek". Ten istý
      // tvar tu drží dôvod v 69 znakoch, takže výnimka padla (ARCHITEKTURA.md).
      what: assumed
        ? 'Nevieme, či sú zápisy do shopu zapnuté — appka preto nezapíše nič, bez ohľadu na výber.'
        : 'Zápisy do shopu sú vypnuté — appka nezapíše nič, bez ohľadu na výber.',
      nextStep: 'Zapnúť ich môže len správca počítača v konfigurácii appky.',
      path: null,
      resolution: 'mimo_appky',
      passableNow: true,
      clearsAt: null,
      assumed,
    },
  ];
}

/** 5.2 — kľúč na zápis: či je vložený a dokedy platí (R2, D63). */
function keyBlockers(snapshot: StatusSnapshot, now: Date, pending: number | null): Blocker[] {
  const present = readFlag(snapshot.apiKey?.present);
  const expiresAt = readDate(snapshot.apiKey?.expiresAt);

  if (present !== true) {
    const assumed = present === null;
    return [
      {
        id: 'key_missing',
        area: 'kluc',
        severity: 'blokuje',
        subject: 'operacia',
        productIds: [],
        // „kým to nevieme, appka počíta s tým, že chýba" hovorilo dvakrát to
        // isté: že sa počíta s chýbajúcim kľúčom, JE dôsledok „nezapisuje".
        what: assumed
          ? 'Nevieme, či je kľúč na zápis do shopu vložený — appka preto nezapisuje.'
          : 'Kľúč na zápis do shopu nie je vložený — bez neho sa nedá zapísať ani jeden produkt.',
        // „plynulo" nepovedalo nič, čo „pokračuje tam, kde stojí" nepovie samo,
        // a držalo zdieľaný ďalší krok oboch vetiev na 91 znakoch.
        nextStep: `Vložte kľúč v Nastaveniach (platí ${API_KEY_MAX_TTL_HOURS} hodín); fronta potom pokračuje tam, kde stojí.`,
        path: BLOCKER_PATHS.settings,
        resolution: 'sam',
        passableNow: true,
        clearsAt: null,
        assumed,
      },
    ];
  }

  // Kľúč je vložený, ale nevieme dokedy platí. Fail-closed: berieme to tak, že
  // dopadol rovnako ako expirovaný — `api-key.repo` ho pri prvom použití aj tak
  // lazy skontroluje a prípadne wipne (D63).
  if (expiresAt === null) {
    return [
      {
        id: 'key_expired',
        area: 'kluc',
        severity: 'blokuje',
        subject: 'operacia',
        productIds: [],
        // „kým to nevieme" je to isté, čo už povedala prvá polovica vety.
        what: 'Kľúč na zápis je vložený, ale nevieme, dokedy platí — appka s ním nepočíta.',
        nextStep: `Vložte kľúč v Nastaveniach znova; platnosť je ${API_KEY_MAX_TTL_HOURS} hodín od vloženia.`,
        path: BLOCKER_PATHS.settings,
        resolution: 'sam',
        passableNow: true,
        clearsAt: null,
        assumed: true,
      },
    ];
  }

  if (expiresAt.getTime() <= now.getTime()) {
    return [
      {
        id: 'key_expired',
        area: 'kluc',
        severity: 'blokuje',
        subject: 'operacia',
        productIds: [],
        // Konkrétny okamih, nie „pred 3 hodinami": relatívny čas sa čítal inak
        // ráno a inak po obede a na obrazovke, ktorá sa neobnovuje sama, starol
        // spolu s ňou (bod 6 hlavičky, `ui/format.ts` bod 3).
        what: `Kľúč na zápis do shopu expiroval ${formatDateTimeSk(expiresAt)} — appka ho už nepoužije.`,
        nextStep: `Vložte nový kľúč v Nastaveniach; platí ${API_KEY_MAX_TTL_HOURS} hodín od vloženia.`,
        path: BLOCKER_PATHS.settings,
        resolution: 'sam',
        passableNow: true,
        clearsAt: null,
        assumed: false,
      },
    ];
  }

  const hoursLeft = hoursBetween(now, expiresAt);
  const budget = snapshot.writeBudget;
  const perDay = readCount(budget?.budget);
  const spent = readCount(budget?.spent);
  const remainingToday = perDay !== null && spent !== null ? Math.max(0, perDay - spent) : null;

  // K6 — fronta, ktorá beží dlhšie než platnosť kľúča, sa o kľúč zastaví.
  const needsDays =
    pending !== null && perDay !== null && remainingToday !== null
      ? daysToFinish(pending, perDay, remainingToday)
      : 0;
  const outlivesKey = needsDays > 0 && hoursLeft < needsDays * 24;

  if (!outlivesKey && hoursLeft >= KEY_WARNING_HOURS) return [];

  return [
    {
      id: 'key_expires_soon',
      area: 'kluc',
      severity: outlivesKey ? 'obmedzuje' : 'informuje',
      subject: 'operacia',
      productIds: [],
      // Zostali dve čísla, ktoré sa navzájom porovnávajú (hodiny kľúča vs. dni
      // fronty) a dôsledok. Vypadla MECHANIKA — počet čakajúcich produktov
      // a rýchlosť „pri 200 zápisoch na deň": z toho sa dni počítajú, a fronta
      // je pritom tretí raz to isté (`Fronta 3 420/8 000` stojí v hlavičke
      // každej stránky). Presne ten dôvod už raz škrtol druhé číslo z vety
      // o strope (bod 1). Z `nextStep` vypadlo „a odloží zvyšok na neskôr" —
      // to je to isté, čo hovorí „zastaví sa na kľúči" vo vete nad ním.
      what: outlivesKey
        ? `Kľúč na zápis platí ešte ${hoursAccusative(hoursLeft)}, fronta potrvá ${days(needsDays)} — zastaví sa na kľúči.`
        : `Kľúč na zápis platí ešte ${hoursAccusative(hoursLeft)}.`,
      nextStep: outlivesKey
        ? 'Vložte nový kľúč v Nastaveniach skôr, než tento vyprší — inak fronta počká.'
        : 'Keď vyprší, vložte v Nastaveniach nový; dovtedy sa nič nedeje.',
      path: BLOCKER_PATHS.settings,
      resolution: 'sam',
      passableNow: true,
      clearsAt: null,
      assumed: false,
    },
  ];
}

/** 5.3 — denný zápisový rozpočet (K2): 200 zápisov na UTC deň z auditu. */
function writeBudgetBlockers(
  snapshot: StatusSnapshot,
  now: Date,
  pending: number | null,
): Blocker[] {
  const perDay = readCount(snapshot.writeBudget?.budget);
  const spent = readCount(snapshot.writeBudget?.spent);
  const day = typeof snapshot.writeBudget?.day === 'string' ? snapshot.writeBudget.day : null;
  // `day` je `YYYY-MM-DD` — prenosový tvar. Do vety ide cez `formatDateSk`,
  // inak by na piatich obrazovkách svietilo „(UTC deň 2026-08-12)" (bod 6).
  const dayNote = day === null ? '' : ` (UTC deň ${formatDateSk(day)})`;
  const reset = nextUtcDayReset(now);

  // Fail-closed presne ako `resolveDailyBudget()`: „neviem, koľko som už minul"
  // je najprísnejší stav, teda vyčerpaný rozpočet — nie voľná ruka.
  if (perDay === null || spent === null) {
    return [
      {
        id: 'write_budget_exhausted',
        area: 'rozpocet',
        severity: 'blokuje',
        subject: 'operacia',
        productIds: [],
        // Bez `dayNote`: keď nevieme spotrebu, deň, za ktorý sa nepočítalo, nič
        // nevysvetľuje — a „o polnoci UTC" v ďalšom kroku UTC deň aj tak menuje.
        // Číslo vo vete zostáva (bod 1 hlavičky žiada od blokujúcej vety číslo);
        // v tejto vetve je jediné pravdivé číslo práve fail-closed strop.
        what: `Nevieme, koľko zápisov dnes odišlo — appka nezapisuje. Bezpečný strop: ${FAIL_CLOSED_DAILY_BUDGET} zápis na deň.`,
        nextStep: `${WAIT_STEP}: rozpočet sa obnoví o polnoci UTC a fronta pokračuje sama.`,
        path: null,
        resolution: 'cakanie',
        passableNow: false,
        clearsAt: reset,
        assumed: true,
      },
    ];
  }

  const remaining = Math.max(0, perDay - spent);

  if (remaining === 0) {
    return [
      {
        id: 'write_budget_exhausted',
        area: 'rozpocet',
        severity: 'blokuje',
        subject: 'operacia',
        productIds: [],
        // Obe čísla zostávajú (bod 1) — vypadlo „ktoré shop pustí za jeden UTC
        // deň": že strop je shopov, je technika (P6), a UTC deň menuje `dayNote`
        // aj ďalší krok. Z ďalšieho kroku vypadlo „presne tam" — „pokračuje,
        // kde skončila" hovorí to isté a zmestí sa do P2.
        what: `Dnešný rozpočet zápisov je vyčerpaný${dayNote} — minutých je ${formatCountSk(spent)} z ${formatCountSk(perDay)}.`,
        nextStep: `${WAIT_STEP}: rozpočet sa obnoví o polnoci UTC a fronta pokračuje, kde skončila.`,
        path: null,
        resolution: 'cakanie',
        passableNow: false,
        clearsAt: reset,
        assumed: false,
      },
    ];
  }

  if (pending === null || pending <= remaining) return [];

  const needsDays = daysToFinish(pending, perDay, remaining);
  const later = pending - remaining;
  return [
    {
      id: 'write_budget_low',
      area: 'rozpocet',
      severity: 'obmedzuje',
      subject: 'operacia',
      productIds: [],
      // Všetky tri čísla zostali (koľko sa dnes zmestí, koľko je vo výbere,
      // koľko počká) — vypadlo len druhé „dnes" a „z nich": po „Z 12 000
      // produktov sa dnes zapíše 200" je zvyšok jednoznačný.
      what: `Z ${productsGenitive(pending)} sa dnes${dayNote} zapíše ${formatCountSk(remaining)} — ${formatCountSk(later)} počká.`,
      // Konkrétny deň, nie „o 3 dni" (bod 6 hlavičky). Dátum sa NEBERIE zo
      // snapshotu: `needsDays` už tento modul počíta sám a deň je z neho len
      // `addDays` nad UTC dnešným — tá istá aritmetika ako `estimateFinish()`.
      // Nové pole v `StatusSnapshot` by pridalo drôt (`WriteBudgetWire`)
      // a serverového producenta pre číslo, ktoré je odtiaľto dopočítateľné.
      nextStep: `${WAIT_STEP}: fronta pokračuje sama, hotovo bude približne ${formatDateSk(finishDay(now, needsDays))}.`,
      path: null,
      resolution: 'cakanie',
      passableNow: false,
      clearsAt: reset,
      assumed: false,
    },
  ];
}

/** 5.4 — režim rozsahu (K1): `pilot` stropuje na 10, `plny` na uložený strop. */
function scopeBlockers(scope: ResolvedScope, selected: number | null): Blocker[] {
  const list: Blocker[] = [];

  if (!scope.known) {
    list.push({
      id: 'scope_unknown',
      area: 'rozsah',
      severity: 'obmedzuje',
      subject: 'operacia',
      productIds: [],
      // „Režim" ani „pilot" tu už nestoja: `ScopeMode` je vnútorný kód (P3)
      // a z informatívnej vety o strope ho odstránila už vlna 2 — tu prežil.
      // Strop sám je zrozumiteľný bez pomenovania režimu, a `scope_pilot_cap`
      // stojí v tom istom zozname vždy, takže na obrazovke je aj to, čoho sa
      // strop týka („na jednu zľavu").
      what: `Nastavenia rozsahu sa nepodarilo prečítať — platí preto najprísnejší strop ${products(PILOT_MAX_PRODUCTS)}.`,
      nextStep:
        'Skúste obrazovku obnoviť; kým sa nastavenia nedočítajú, vyšší uložený strop neplatí.',
      path: BLOCKER_PATHS.settings,
      resolution: 'sam',
      passableNow: true,
      clearsAt: null,
      assumed: true,
    });
  }

  const pilot = scope.mode === 'pilot';
  const id: BlockerId = pilot ? 'scope_pilot_cap' : 'scope_full_cap';
  const cap = scope.maxProducts;
  /**
   * Strop je domnienka aj vtedy, keď sme neprečítali samotný REŽIM: pilotných
   * 10 vtedy neplatí preto, že je to nastavené, ale preto, že sa nevie nič iné.
   */
  const capAssumed = !scope.known || scope.capAssumed;
  const capText = `Na jednu zľavu prejde najviac ${products(cap)}`;

  // Strop platí aj vtedy, keď ho výber neprekročil — je to trvalé pravidlo appky
  // a používateľ ho má vidieť skôr, než doň narazí. Nad stropom `blokuje`,
  // pod stropom `informuje`; UI si informatívne riadky vie odfiltrovať.
  if (selected === null) {
    list.push({
      id,
      area: 'rozsah',
      severity: 'informuje',
      subject: 'operacia',
      productIds: [],
      what: `${capText}.`,
      nextStep: pilot
        ? 'Rozsah sa prepína v Nastaveniach.'
        : `Strop sa dá zmeniť v Nastaveniach, najviac na ${products(HARD_MAX_PRODUCTS)}.`,
      path: BLOCKER_PATHS.settings,
      resolution: pilot ? 'sudo' : 'sam',
      passableNow: true,
      clearsAt: null,
      assumed: true,
    });
    return list;
  }

  if (selected <= cap) {
    list.push({
      id,
      area: 'rozsah',
      severity: 'informuje',
      subject: 'operacia',
      productIds: [],
      what: `${capText}.`,
      nextStep: pilot
        ? 'Rozsah sa prepína v Nastaveniach.'
        : `Strop sa dá zmeniť v Nastaveniach, najviac na ${products(HARD_MAX_PRODUCTS)}.`,
      path: BLOCKER_PATHS.settings,
      resolution: pilot ? 'sudo' : 'sam',
      passableNow: true,
      clearsAt: null,
      assumed: capAssumed,
    });
    return list;
  }

  const over = selected - cap;
  const atHardMax = !pilot && cap >= HARD_MAX_PRODUCTS;
  list.push({
    id,
    area: 'rozsah',
    severity: 'blokuje',
    subject: 'operacia',
    productIds: [],
    // Druhé „produktov" vypadlo 24. 8. 2026 spolu s prívlastkom „zvyšných":
    // jednotku už povedal strop na začiatku vety. Veta tým dostala presne ten
    // tvar, ktorý bod 1 hlavičky uvádza ako VZOR — obe čísla aj zvyšok.
    what: `${capText}, vo výbere ${isAre(selected)} ${formatCountSk(selected)} — ${remainderPhrase(over)}.`,
    nextStep: pilot
      ? // Že si prepnutie vypýta heslo, hovorí `resolution: 'sudo'` — zámok
        // aj slovo „vypýta si heslo" kreslí `ui/blocker-look.ts` vedľa tejto
        // vety. Druhýkrát to tu už nestojí (bod 5 hlavičky).
        `Zúžte výber na ${products(cap)}, alebo prepnite rozsah v Nastaveniach.`
      : atHardMax
        ? `Rozdeľte výber na viac zliav — vyšší strop než ${products(HARD_MAX_PRODUCTS)} sa nastaviť nedá.`
        : // Jednotku povedal už prvý strop vo vete, druhé „produktov" ju len
          // zopakovalo a držalo radu na 91 znakoch (P2 dáva 90).
          `Zúžte výber na ${products(cap)}, alebo strop zvýšte v Nastaveniach (najviac ${formatCountSk(HARD_MAX_PRODUCTS)}).`,
    path: BLOCKER_PATHS.settings,
    resolution: pilot ? 'sudo' : 'sam',
    passableNow: true,
    clearsAt: null,
    assumed: capAssumed,
  });
  return list;
}

/**
 * 5.5 — katalóg (K1 bod 2, K7). V režime `plny` je prítomnosť v `catalog_cache`
 * podmienkou zápisu; v `pilot` o zápise nerozhoduje, ale neúplný katalóg aj tak
 * treba priznať — používateľ v ňom vyberá.
 */
function catalogBlockers(
  snapshot: StatusSnapshot,
  scope: ResolvedScope,
  selected: number | null,
  now: Date,
): Blocker[] {
  const list: Blocker[] = [];
  const catalog = snapshot.catalog;
  const full = scope.mode === 'plny';
  const missing = Array.isArray(catalog?.missingProductIds) ? catalog.missingProductIds : null;

  if (full) {
    if (missing === null) {
      list.push({
        id: 'catalog_unknown',
        area: 'katalog',
        severity: 'blokuje',
        subject: 'operacia',
        productIds: [],
        // Vetva beží len pri `full`, takže „v plnom režime" nič nepridávalo,
        // a „radšej nezapíše nič" v ďalšom kroku bolo to isté, čo koniec vety.
        what: 'Nedá sa overiť, či sú vybrané produkty v katalógu appky — bez toho nezapíše nič.',
        nextStep: 'Načítajte katalóg v Produktoch a výber zopakujte.',
        path: BLOCKER_PATHS.products,
        resolution: 'sam',
        passableNow: true,
        clearsAt: null,
        assumed: true,
      });
    } else if (missing.length > 0) {
      const count = missing.length;
      const ofSelected = selected === null ? '' : ` z ${productsGenitive(selected)} vo výbere`;
      list.push({
        id: 'catalog_product_missing',
        area: 'katalog',
        severity: 'blokuje',
        subject: 'produkt',
        productIds: [...missing],
        what: `${formatCountSk(count)} ${pluralSk(count, 'produkt', 'produkty', 'produktov')}${ofSelected} appka v katalógu nevidí (${sampleIds(missing)}) — do ${pluralSk(count, 'neho', 'nich', 'nich')} nezapíše.`,
        nextStep: `Načítajte katalóg znova v Produktoch, alebo ${pluralSk(count, 'tento produkt', 'tieto produkty', 'tieto produkty')} z výberu odoberte.`,
        path: BLOCKER_PATHS.products,
        resolution: 'sam',
        passableNow: true,
        clearsAt: null,
        assumed: false,
      });
    }
  }

  const loaded = readCount(catalog?.loadedProducts);
  const total = readCount(catalog?.shopTotalProducts);

  if (loaded === null) return list;

  if (loaded === 0) {
    list.push({
      id: 'catalog_incomplete',
      area: 'katalog',
      severity: full ? 'blokuje' : 'informuje',
      subject: 'operacia',
      productIds: [],
      what: full
        ? 'Katalóg je prázdny — v plnom režime sa z neho nedá vybrať ani jeden produkt.'
        : 'Katalóg je prázdny — appka zatiaľ nemá načítaný ani jeden produkt zo shopu.',
      nextStep: 'Spustite načítanie katalógu v Produktoch a nechajte ho dobehnúť.',
      path: BLOCKER_PATHS.products,
      resolution: 'sam',
      passableNow: true,
      clearsAt: null,
      assumed: false,
    });
    return list;
  }

  if (total === null || loaded >= total) return list;

  const rest = total - loaded;
  const pages = Math.ceil(rest / CATALOG_PAGE_SIZE);

  /**
   * JEDEN ODHAD, NIE DVA (bod 4 hlavičky).
   *
   * Prednosť má číslo od servera: `catalogRepo.syncStatus()` pozná pokrok
   * prechodu (`last_page`), tento modul len počty riadkov. Keď neprišlo,
   * dopočíta sa TOU ISTOU funkciou — `readDaysNeeded`, nie druhou formulou.
   * Zvyšok dnešného rozpočtu ide z opt-in sekcie `catalogReads`; keď ju
   * volajúci neposlal, platí fail-closed „dnes už nič", a odhad je teda ten
   * dlhší z možných.
   */
  const remainingToday = readCount(snapshot.catalogReads?.usedThisUtcDay);
  const needsDays =
    readCount(catalog?.estimatedDaysLeft) ??
    readDaysNeeded(
      pages,
      remainingToday === null ? 0 : Math.max(0, ANON_READS_PER_UTC_DAY - remainingToday),
      ANON_READS_PER_UTC_DAY,
    );

  /**
   * DOKEDY SA ČAKÁ (bod 3 hlavičky). Prekážka, ktorá tvrdí „počkaj si" a
   * nepovie dokedy, je mŕtvy bod — presne to, čo tento modul vznikol odstrániť.
   *
   * `0` dní znamená „ešte dnes", teda najneskôr do najbližšej polnoci UTC (vtedy
   * sa rozpočet obnoví a číta sa ďalej); každý ďalší deň je o 24 h viac. Tá istá
   * aritmetika ako `estimatedFinishAt` v `syncStatus()`, aby oba časy v jednom
   * paneli ukazovali na ten istý deň. Je to ODHAD, a veta ho tak aj podáva
   * („približne"); istý je len smer — čakaním sa to pohne samo.
   */
  const clearsAt =
    readDate(catalog?.estimatedFinishAt) ??
    new Date(nextUtcDayReset(now).getTime() + Math.max(0, needsDays - 1) * 86_400_000);

  /**
   * ODHAD PATRÍ DO ĎALŠIEHO KROKU, NIE DO POPISU STAVU.
   *
   * Do 24. 8. 2026 stál v `what` a s ním aj tempo čítania („za jeden UTC deň sa
   * zmestí 240 čítaní po 100 produktov"). Veta mala 170 znakov (P2 dáva 90)
   * a to tempo bolo mechanika, teda technika, ktorá podľa P6 nepatrí na povrch:
   * vysvetľovalo, ODKIAĽ sa odhad vzal, nie čo má používateľ robiť.
   * Čo sa tým smie TICHO pokaziť: odhad je označený len slovom „približne"
   * (P7 chce aj tlmenejší odtieň — ten kreslí `ui/blocker-look.ts`). Keby ho
   * niekto vykreslil rovnakým štýlom ako merané čísla vyššie, bude to čítať
   * ako sľub dňa, ktorý appka nedáva.
   */
  const estimate =
    needsDays <= 0
      ? 'zvyšok katalógu sa dočíta ešte dnes.'
      : `katalóg sa dočíta približne za ${days(needsDays)}.`;

  list.push({
    id: 'catalog_incomplete',
    area: 'katalog',
    severity: full ? 'obmedzuje' : 'informuje',
    subject: 'operacia',
    productIds: [],
    // „ktoré shop hlási" a „zatiaľ chýba" sa zlialo do dôsledku, ktorý je
    // dôvodom, prečo prekážka vôbec existuje: chýbajúce sa nedajú vybrať.
    what: `Načítaných je ${formatCountSk(loaded)} z ${productsGenitive(total)} — ${formatCountSk(rest)} sa zatiaľ vybrať nedá.`,
    nextStep: `${WAIT_STEP}: ${estimate}`,
    path: BLOCKER_PATHS.products,
    resolution: 'cakanie',
    passableNow: false,
    clearsAt,
    assumed: false,
  });
  return list;
}

/**
 * 5.6 — čítací rozpočet katalógu (`shop/rate-limits.ts`): 30/min a 300/UTC deň
 * bez kľúča, z čoho si appka berie 80 % ako rezervu. Zápisu to NEBRÁNI —
 * čítania idú bez kľúča a na inú kvótu.
 */
function catalogReadBlockers(snapshot: StatusSnapshot, now: Date): Blocker[] {
  const reads = snapshot.catalogReads;
  if (reads === undefined) return [];

  const list: Blocker[] = [];
  const perDay = readCount(reads.usedThisUtcDay);
  const perMinute = readCount(reads.usedThisMinute);

  if (perDay === null || perDay >= ANON_READS_PER_UTC_DAY) {
    const assumed = perDay === null;
    list.push({
      id: 'catalog_reads_day_exhausted',
      area: 'citanie',
      severity: 'obmedzuje',
      subject: 'operacia',
      productIds: [],
      // Obe čísla vedľa seba zostávajú (náš rozpočet aj strop shopu) — je to
      // to isté pravidlo, ktoré `engine/budget.ts` drží pre zápisy: kto vidí
      // len jedno, prestane rozumieť tomu, čo môže zmeniť sám. Vypadlo len
      // slovo „rezerva" a „ktoré si appka za UTC deň dovolí": rozdiel 240 a 300
      // je z dvoch čísel vedľa seba vidieť, a UTC deň menuje ďalší krok.
      what: assumed
        ? `Nevieme, koľko z ${formatCountSk(ANON_READS_PER_UTC_DAY)} denných čítaní katalógu odišlo — appka preto ďalej nečíta.`
        : `Dnešný rozpočet čítaní katalógu je vyčerpaný — odišlo ${formatCountSk(perDay)} z ${formatCountSk(ANON_READS_PER_UTC_DAY)} (shop pustí ${formatCountSk(SHOP_ANON_LIMIT.perUtcDay)}).`,
      // „Zápisov sa to netýka" je dôvod, prečo je celá sekcia opt-in — ostáva.
      // Vypadlo „tie majú vlastný rozpočet", čo je to isté inými slovami.
      nextStep: `${WAIT_STEP}: rozpočet čítaní sa obnoví o polnoci UTC. Zápisov sa to netýka.`,
      path: BLOCKER_PATHS.products,
      resolution: 'cakanie',
      passableNow: false,
      clearsAt: nextUtcDayReset(now),
      assumed,
    });
  }

  if (perMinute === null || perMinute >= ANON_READS_PER_MINUTE) {
    const assumed = perMinute === null;
    list.push({
      id: 'catalog_reads_minute_exhausted',
      area: 'citanie',
      severity: 'obmedzuje',
      subject: 'operacia',
      productIds: [],
      what: assumed
        ? `Nevieme, koľko z ${formatCountSk(ANON_READS_PER_MINUTE)} čítaní katalógu za minútu odišlo — appka preto čaká.`
        // Náš strop aj strop shopu zostávajú vedľa seba (to isté pravidlo drží
        // `engine/budget.ts`) — vypadlo „ktoré si appka dovolí", presne ako
        // v dennej vetve nad tým: rozdiel 24 a 30 je z dvoch čísel vidieť.
        : `Za poslednú minútu odišlo ${formatCountSk(perMinute)} z ${formatCountSk(ANON_READS_PER_MINUTE)} čítaní katalógu (shop pustí ${formatCountSk(SHOP_ANON_LIMIT.perMinute)} za minútu).`,
      nextStep: `${WAIT_STEP}: synchronizácia si sama počká a do minúty pokračuje.`,
      path: BLOCKER_PATHS.products,
      resolution: 'cakanie',
      passableNow: false,
      clearsAt: new Date(now.getTime() + MINUTE_MS),
      assumed,
    });
  }

  return list;
}

/**
 * 5.7 — čítanie objednávok, ktoré shop trvalo odmieta (`sales/stop-policy.ts`).
 *
 * Prečo `obmedzuje` a nie `blokuje`: zľavy sa zapisujú ďalej. Zastavila sa
 * predajnosť, teda ČÍSLA, nie operácia — a prekážka, ktorá by tvrdila, že
 * zastavuje všetko, by pri každej zľave hlásila poplach, ktorý neplatí.
 *
 * Prečo `clearsAt: null` aj pri zablokovanej IP: appka vie, kedy sa sama ozve,
 * ale nevie, kedy blokáda skončí. Sľúbiť čas uvoľnenia by bola domnienka
 * vydávaná za meranie (I11). Že sa appka ozve sama, hovorí veta.
 *
 * Prečo to NEPATRÍ medzi zamknuté funkcie (`settings/LockedFeatures.tsx`): tá
 * tabuľka hovorí, čo rozhranie eshopu neposkytuje NIKOMU a NIKDY. Toto je
 * meniteľný stav tejto inštalácie — kľúč, ktorý sa dá prestaviť, a adresa,
 * ktorá sa dá odblokovať.
 */
function salesSyncBlockers(snapshot: StatusSnapshot): Blocker[] {
  const sales = snapshot.salesSync;
  if (sales === undefined) return [];
  const kind = sales.block ?? null;
  if (kind === null) return [];

  const banned = kind === 'ip_ban';
  return [
    {
      id: banned ? 'sales_reads_ip_banned' : 'sales_reads_forbidden',
      area: 'citanie',
      severity: 'obmedzuje',
      subject: 'operacia',
      productIds: [],
      // Vety píše `sales/stop-policy.ts` — to isté znenie vidí aj log spúšťača.
      what: salesBlockWhat(kind),
      nextStep: salesBlockNextStep(kind),
      // Odblokovanie adresy sa v appke urobiť nedá; vloženie kľúča áno, a je
      // za sudo oknom (`PUT /api/key`), čo podľa bodu 5 hlavičky povie zámok.
      path: banned ? null : BLOCKER_PATHS.settings,
      resolution: banned ? 'mimo_appky' : 'sudo',
      passableNow: true,
      clearsAt: null,
      assumed: false,
    },
  ];
}

/* ═══════════════════════════ 6. Verejné API ═══════════════════════════════ */

/**
 * Zoradí prekážky: najprv závažnosť (`blokuje` → `obmedzuje` → `informuje`),
 * potom kanonické poradie `BLOCKER_ORDER`. Vstup sa nemení (vracia nové pole).
 */
export function sortBlockers(blockers: readonly Blocker[]): readonly Blocker[] {
  const rank = (id: BlockerId): number => {
    const index = BLOCKER_ORDER.indexOf(id);
    return index === -1 ? BLOCKER_ORDER.length : index;
  };
  return [...blockers].sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    return bySeverity !== 0 ? bySeverity : rank(a.id) - rank(b.id);
  });
}

/**
 * PREČO NEBEŽÍ CELÁ OPERÁCIA — všetky prekážky nad jedným snapshotom, zoradené
 * podľa závažnosti.
 *
 * Prázdny snapshot NIE JE „všetko v poriadku": vráti fail-closed zoznam, kde
 * každá prekážka nesie `assumed: true`.
 */
export function collectOperationBlockers(snapshot: StatusSnapshot = {}): readonly Blocker[] {
  const now = readDate(snapshot.now) ?? new Date();
  const scope = resolveScope(snapshot.scope);
  const selected = resolveSelectedCount(snapshot.selection);

  return sortBlockers([
    ...writesBlockers(snapshot),
    ...keyBlockers(snapshot, now, selected),
    ...writeBudgetBlockers(snapshot, now, selected),
    ...scopeBlockers(scope, selected),
    ...catalogBlockers(snapshot, scope, selected, now),
    ...catalogReadBlockers(snapshot, now),
    ...salesSyncBlockers(snapshot),
  ]);
}

/**
 * PREČO NEPREJDE PRÁVE TENTO PRODUKT — ten istý zoznam zúžený na jeden produkt.
 *
 * Výber sa prepíše na tento jediný produkt (stropy rozsahu sa teda počítajú
 * voči jednotke) a katalógové prekážky sa orežú na jeho ID. Prekážky celej
 * operácie (vypnuté zápisy, chýbajúci kľúč, vyčerpaný rozpočet) ZOSTÁVAJÚ —
 * blokujú aj tento produkt, len nie kvôli nemu.
 */
export function collectProductBlockers(
  productId: number,
  snapshot: StatusSnapshot = {},
): readonly Blocker[] {
  const missing = snapshot.catalog?.missingProductIds;
  const narrowed: StatusSnapshot = {
    ...snapshot,
    selection: { selectedCount: 1, productIds: [productId] },
    ...(snapshot.catalog === undefined
      ? {}
      : {
          catalog: {
            ...snapshot.catalog,
            missingProductIds: Array.isArray(missing)
              ? missing.filter((id) => id === productId)
              : missing,
          },
        }),
  };
  return collectOperationBlockers(narrowed);
}

/** Len prekážky, cez ktoré teraz neprejde nič. */
export function blockingOnly(blockers: readonly Blocker[]): readonly Blocker[] {
  return blockers.filter((blocker) => blocker.severity === 'blokuje');
}

/** Prvá prekážka, ktorá zastavuje. `null` = nič nezastavuje. */
export function firstBlocking(blockers: readonly Blocker[]): Blocker | null {
  return blockingOnly(sortBlockers(blockers))[0] ?? null;
}

/**
 * Zhrnutie zoznamu pre hlavičku a pruhy: ide to / neide to, a kedy sa niečo
 * pohne samo. `waitUntil` je NAJBLIŽŠÍ čas obnovy spomedzi prekážok, ktoré sa
 * dajú prekonať iba čakaním.
 */
export function summarizeBlockers(blockers: readonly Blocker[]): BlockerSummary {
  const sorted = sortBlockers(blockers);
  const blocking = blockingOnly(sorted);
  // Bez pretypovania: `flatMap` zúži `clearsAt` na `Date` sám, `filter` by to
  // neurobil a musel by sa doháňať `as`.
  const waits = sorted.flatMap((blocker) =>
    !blocker.passableNow && blocker.clearsAt !== null && blocker.severity !== 'informuje'
      ? [blocker.clearsAt.getTime()]
      : [],
  );

  return {
    blockers: sorted,
    blocking,
    blocked: blocking.length > 0,
    waitUntil: waits.length > 0 ? new Date(Math.min(...waits)) : null,
  };
}
