/**
 * Aura Zľavy — ČISTÁ LOGIKA PRIMITÍV PRIEHĽADNOSTI (§3.2, §3.3, K2).
 *
 * Šesť primitív (`BudgetMeter`, `StatusPill`, `LockBadge`, `Note`,
 * `EmptyState`, `StatTile`) je zámerne rozdelených na dva súbory: TU žije
 * všetko, čo sa dá spočítať a otestovať bez prehliadača, v `.tsx` súboroch
 * zostáva len značkovanie. Dôvod je prozaický — `vitest.config.ts` zbiera
 * výhradne `test/**\/*.spec.ts` a beží v `environment: 'node'`, takže test,
 * ktorý by chcel vykresliť JSX, by v tomto projekte nemal ako vzniknúť.
 * Prah varovania, výpočet naplnenia a slovenské formátovanie sú pritom presne
 * tie veci, ktoré sa pri prepisovaní obrazoviek tichučko pokazia.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Stav nikdy nie je len farba.** Každá úroveň meracieho prúžku má okrem
 *    tónu aj GLYF a SLOVO (`BUDGET_LEVEL_GLYPH`, `BUDGET_LEVEL_WORD`). Škála
 *    stavov je od 19. 8. 2026 optimalizovaná na odstup ΔE ≥ 8 aj pod
 *    deuteranopiou, protanopiou a tritanopiou (`scripts/palette-check.mjs`),
 *    ale odstup farieb pravidlo NERUŠÍ: prúžok, ktorý len „sčervenie", povie
 *    nevidiacemu a čítačke obrazovky stále presne nič. Značka „blíži sa"
 *    (trojuholník) a „vyčerpané" (štvorec) sa preto líšia aj vtedy, keď majú
 *    rovnaký tón — pozri bod 2.
 *
 * 2. **Vyčerpaný rozpočet NIE JE chyba** (K2, `HeaderStatus.tsx`). Pri 200/200
 *    sa nič nerozbilo — appka len počká do 02:00. Červená je v tejto appke
 *    vyhradená pre stratu dát a zastavený zápis, takže `budgetLevelTone()`
 *    vracia pri plnom stropu `attention`, nie `critical`. Predloha
 *    (`sperky-admin.html`, `.meter .bar.hot i`) červenala; my ju vedome
 *    NEKOPÍRUJEME. Volajúci, ktorý meria niečo, kde plný strop naozaj znamená
 *    poruchu, si červenú vypýta cez `fullTone`.
 *
 * 3. **Neznáme číslo sa nedopĺňa.** `limit`, ktorý nie je konečné kladné číslo,
 *    je nekonfigurovaný strop — nie „strop nekonečno". Vraciame vtedy 100 %
 *    a úroveň `full`, teda pesimistický smer: appka radšej povie „nemám kam
 *    zapisovať" než aby ticho sľúbila voľnú kapacitu, ktorú nemá. Rovnaký
 *    princíp ako `RATE_SAFETY_FACTOR` v `lib/shop/rate-limits.ts`.
 *
 * 4. **Percento je odvodené, nie vstupné.** Nikto nesmie posielať do prúžku
 *    hotové percento — šírka výplne aj text `14/18` musia vychádzať z tej istej
 *    dvojice čísel, inak sa raz rozídu.
 *
 * KDE ŽIJE PRAVIDLO TROCH KANÁLOV (V6a, D142)
 * -------------------------------------------
 * Tu sú slová a značky KONKRÉTNYCH úrovní (`BUDGET_LEVEL_WORD`, `TREND_WORD`)
 * — teda platba, ktorú komponenty kreslia. Poistka „a čo keď slovo vôbec
 * nepríde" je o jednu úroveň vyššie, v `ui/signals.ts`, a je spoločná pre celú
 * signálnu skupinu (`ToneBadge`, `StatusPill`, `BudgetMeter`, `Chip`).
 * Kto by si náhradné slovo napísal ešte raz sem, vyrobí druhú poistku, ktorá
 * sa s prvou rozíde — presne to, čo tento súbor v hlavičke inde zakazuje.
 *
 * Vlastník: U1.
 */
import type { IconName } from '@/components/ui/Icon';
import { TONE_ICON, type StatusTone } from '@/components/ui/ToneBadge';
import { formatCountSk } from '@/lib/ui/vocabulary';

/* ═════════════════════ 1. Merací prúžok rozpočtu ══════════════════════════ */

/**
 * Podiel stropu, od ktorého prúžok varuje. 0,8 nie je náhodné číslo: je to tá
 * istá rezerva ako `RATE_SAFETY_FACTOR` v `lib/shop/rate-limits.ts` — keď
 * appka minie 80 % stropu, zvyšok jej má stačiť na dobehnutie rozrobeného,
 * nie na začatie nového.
 */
export const BUDGET_WARN_RATIO = 0.8;

/** Tri úrovne naplnenia. Zámerne bez farieb — tón sa priraďuje až neskôr. */
export type BudgetLevel = 'calm' | 'warn' | 'full';

/**
 * Značka úrovne. `warn` a `full` sa MUSIA líšiť aj pri rovnakom tóne (bod 2
 * v hlavičke), preto trojuholník verzus štvorec.
 *
 * `full` je jediná úroveň s vlastnou ikonou mimo koreňového slovníka tónov:
 * „strop vyčerpaný" nie je piaty stav, ale iná VEC než „pozor" — a keby si
 * požičala trojuholník tónu `attention`, bod 2 by prestal platiť.
 */
export const BUDGET_LEVEL_ICON: Readonly<Record<BudgetLevel, IconName>> = {
  calm: TONE_ICON.idle,
  warn: TONE_ICON.attention,
  full: 'square',
};

/** Slovo úrovne — tretí kanál popri farbe a značke. */
export const BUDGET_LEVEL_WORD: Readonly<Record<BudgetLevel, string>> = {
  calm: 'v rámci stropu',
  warn: 'blíži sa strop',
  full: 'strop vyčerpaný',
};

/**
 * Naplnenie stropu v percentách, zaokrúhlené na jedno desatinné miesto (šírka
 * v CSS nepotrebuje viac a zaokrúhlenie robí test čitateľným).
 *
 * Okrajové prípady sú vedomé, nie zabudnuté:
 *  - strop, ktorý nie je konečné kladné číslo → 100 % (bod 3 v hlavičke),
 *  - spotreba pod nulou alebo nekonečná → 0 %,
 *  - spotreba nad strop → 100 % (prúžok nikdy nepretečie mimo koľajnicu).
 */
export function budgetFillPercent(spent: number, limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 100;
  if (!Number.isFinite(spent) || spent <= 0) return 0;
  if (spent >= limit) return 100;
  return Math.round((spent / limit) * 1000) / 10;
}

/**
 * Úroveň naplnenia. Prahy sú INKLUZÍVNE: presne 80 % je už `warn`, presne
 * 100 % je už `full` — hranicu neplytváme na „ešte je dobre".
 */
export function budgetLevel(spent: number, limit: number): BudgetLevel {
  const percent = budgetFillPercent(spent, limit);
  if (percent >= 100) return 'full';
  if (percent >= BUDGET_WARN_RATIO * 100) return 'warn';
  return 'calm';
}

/**
 * Tón úrovne. `fullTone` je jediný povolený spôsob, ako dostať do prúžku
 * červenú — predvolene je vyčerpaný strop `attention`, lebo nie je chyba (K2).
 */
export function budgetLevelTone(
  level: BudgetLevel,
  fullTone: StatusTone = 'attention',
): StatusTone {
  if (level === 'full') return fullTone;
  if (level === 'warn') return 'attention';
  return 'idle';
}

/**
 * Dvojica čísel do riadku prúžku: `160/200`. Lomka a medzera v tisíckach sú
 * prevzaté z `writeBudgetSentence()` / `queueSentence()` — appka počíta
 * rozpočty na jednom mieste jedným tvarom.
 */
export function budgetCountLabel(spent: number, limit: number): string {
  return `${formatCountSk(spent)}/${formatCountSk(limit)}`;
}

/**
 * Veta o obnove stropu. `resetsAt` je HOTOVÁ fráza aj s predložkou
 * (`o 02:00`, `zajtra o 02:00`, `o polnoci`) — appka nevie, či strop beží na
 * UTC deň, lokálnu polnoc alebo kĺzavú minútu, tak si to nevymýšľa.
 */
export function budgetResetSentence(resetsAt: string | null | undefined): string | null {
  const value = resetsAt?.trim();
  if (!value) return null;
  return `Obnoví sa ${value}.`;
}

/**
 * Text pre čítačku obrazovky (`aria-valuetext`). Nesie všetko, čo vidiaci
 * čitateľ vyčíta z prúžku: popis, dvojicu čísel, slovo úrovne a prípadnú
 * obnovu. Percento sa doň zámerne NEPÍŠE — `aria-valuenow` ho už nesie a
 * čítačka by ho prečítala dvakrát.
 */
export function budgetAriaText(
  label: string,
  spent: number,
  limit: number,
  resetsAt?: string | null,
): string {
  const level = budgetLevel(spent, limit);
  const reset = budgetResetSentence(resetsAt);
  const head = `${label}: ${budgetCountLabel(spent, limit)}, ${BUDGET_LEVEL_WORD[level]}.`;
  return reset ? `${head} ${reset}` : head;
}

/* ═══════════════════════ 2. Vysvetlivka (Note) ════════════════════════════ */

/**
 * Tri varianty vysvetlivky podľa predlohy (`.note`, `.note.warn`, `.note.err`).
 * Názvy sú zámerne krátke a prevzaté z predlohy; mapovanie na projektové tóny
 * drží `NOTE_TONE`, aby sa nikde nezaviedla štvrtá slovná zásoba stavov.
 */
export type NoteVariant = 'info' | 'warn' | 'err';

/** Vysvetlivka → stavový tón §3.2. `info` je pokoj, nie „nič". */
export const NOTE_TONE: Readonly<Record<NoteVariant, StatusTone>> = {
  info: 'idle',
  warn: 'attention',
  err: 'critical',
};

/** Trieda panelu v `globals.css`. Vysvetlivka nemá vlastný vzhľad — dedí `.ovl-note`. */
export const NOTE_CLASS: Readonly<Record<NoteVariant, string>> = {
  info: 'ovl-note',
  warn: 'ovl-note ovl-note--attention',
  err: 'ovl-note ovl-note--critical',
};

/**
 * Značka vysvetlivky. NIE je napísaná — je ODVODENÁ z `TONE_ICON` cez
 * `NOTE_TONE`, takže sa od koreňového slovníka nemá ako rozísť. Presne tento
 * druh ručne prepísanej kópie stál 19. 8. 2026 za dvoma rôznymi tabuľkami
 * `TONE_GLYPH` v tej istej appke.
 */
export const NOTE_ICON: Readonly<Record<NoteVariant, IconName>> = {
  info: TONE_ICON[NOTE_TONE.info],
  warn: TONE_ICON[NOTE_TONE.warn],
  err: TONE_ICON[NOTE_TONE.err],
};

/**
 * Chybová vysvetlivka kričí (`alert`), ostatné len oznamujú (`status`).
 * Rozdiel je počuteľný: `alert` preruší čítačku uprostred vety, `status` počká.
 */
export function noteRole(variant: NoteVariant): 'alert' | 'status' {
  return variant === 'err' ? 'alert' : 'status';
}

/* ═════════════════════════ 3. Smer zmeny (StatTile) ═══════════════════════ */

/** Smer zmeny oproti minulému obdobiu. */
export type TrendDirection = 'up' | 'down' | 'flat';

/**
 * Či je smer pre používateľa dobrý, zlý alebo bez hodnotenia. Predvolene
 * `idle` — rast čísla nie je sám osebe dobrá správa (rastúce náklady sú
 * zlá), takže dlaždica farbí smer LEN vtedy, keď volajúci povie zmysel.
 */
export type TrendMeaning = 'good' | 'bad' | 'idle';

/**
 * Značka smeru. Šípka je dekoratívna — vedľa nej vždy stojí slovo.
 *
 * Do 19. 8. 2026 to boli znaky `↑ ↓ →`. Prvé dva v Interi SÚ, tretí NIE — tá
 * istá trojica sa teda kreslila dvoma rôznymi písmami vedľa seba a „bez zmeny"
 * malo inú hrúbku aj šírku než „nárast". Ikony to zjednotili.
 */
export const TREND_ICON: Readonly<Record<TrendDirection, IconName>> = {
  up: 'arrowUp',
  down: 'arrowDown',
  flat: 'arrowRight',
};

/** Slovo smeru — bez neho by šípka bola len obrázok. */
export const TREND_WORD: Readonly<Record<TrendDirection, string>> = {
  up: 'nárast',
  down: 'pokles',
  flat: 'bez zmeny',
};

/** Význam smeru → stavový tón §3.2. */
export function trendTone(meaning: TrendMeaning): StatusTone {
  if (meaning === 'good') return 'good';
  if (meaning === 'bad') return 'critical';
  return 'idle';
}
