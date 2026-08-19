/**
 * Aura Zľavy — STAV ŠTYROCH KARIET NA ROZCESTNÍKU NASTAVENÍ
 * (kontrakt UI 13. 8. 2026, bod 13: „každá so svojím stavom").
 *
 * PREČO MÁ KARTA STAV
 * -------------------
 * Rozcestník bez stavov je len menu — človek musí otvoriť všetky štyri
 * podstránky, aby zistil, či je niečo v neporiadku, a presne to sa doteraz
 * dialo s jednou dlhou stránkou. Karta so stavom obracia smer: obrazovka
 * povie, kam sa oplatí kliknúť, a zvyšné tri nechá na pokoji.
 *
 * ODKIAĽ SA STAV BERIE
 * --------------------
 * Prednosť má vždy PREKÁŽKA zo servera (`lib/status/blockers.ts`). Karta
 * nesklada vlastnú vetu o probléme — vezme `what` tak, ako prišla, a pridá
 * len tón a slovo o spôsobe riešenia. Dve vety o tom istom probléme by sa raz
 * rozišli a vtedy sa nedá povedať, ktorá klame.
 *
 * Keď v oblasti karty prekážka nie je, karta povie POKOJNÝ FAKT — čo je práve
 * nastavené. Nie „všetko v poriadku": to je hodnotenie, nie fakt, a pri
 * neúplnom čítaní by bolo klamstvo.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *  1. **Neznáme sa priznáva** (P7). Keď sa údaj nedá prečítať, veta to povie
 *     a tón je `idle`. Nikdy sa nedopĺňa nula ani upokojujúca veta.
 *  2. **Poradie prekážok sa neprehadzuje.** Server ich už zoradil podľa
 *     závažnosti; karta berie PRVÚ zo svojich oblastí.
 *  3. **Farbu volí `resolution`, nie `severity`** — rovnaké pravidlo ako na
 *     Prehľade. Vyčerpaný denný rozpočet blokuje, a napriek tomu je pokojný:
 *     o polnoci sa obnoví sám.
 *  4. **Karta „Čo appka vie" nemá prekážky.** Je to referenčný zoznam, nie
 *     stav; jej veta je počet funkcií a počet priznaných medzier.
 *
 * Čistý modul — žiadny React, žiadny fetch.
 *
 * Vlastník: V12.
 */
import type { BlockerWire, KeyMetaView, QueueView, SettingsView } from '@/components/settings/api';
import { SCOPE_MODE_LABELS } from '@/components/settings/api';
import { RESOLUTION_WORD, blockerTone } from '@/components/settings/blockers-view';
import { APP_CAPABILITIES } from '@/components/settings/FeatureIndex';
import { LOCKED_FEATURES } from '@/components/settings/LockedFeatures';
import type { SettingsPageSlug } from '@/components/settings/sub-pages';
import type { StatusTone } from '@/components/ui/ToneBadge';
import { formatDateSk, formatDateTimeSk } from '@/lib/ui/format';

/** Oblasti prekážok, ktoré patria danej karte. Prázdne = karta bez prekážok. */
export const CARD_AREAS: Readonly<Record<SettingsPageSlug, readonly BlockerWire['area'][]>> = {
  'co-vie': [],
  napojenie: ['kluc'],
  'co-smie': ['zapisy', 'rozsah', 'rozpocet', 'citanie'],
  historia: [],
  'cervena-zona': [],
};

/** Stav jednej karty — tón, veta a slovo o tom, čo s tým. */
export interface SettingsCardState {
  readonly tone: StatusTone;
  /** Čo je teraz. Jedna veta, konkrétna, bez hodnotenia. */
  readonly sentence: string;
  /** Čo s tým, jedným slovom. `null`, keď netreba robiť nič. */
  readonly word: string | null;
  /** Či veta pochádza z prekážky (`true`), alebo je to pokojný fakt. */
  readonly fromBlocker: boolean;
}

/** Všetko, z čoho sa dajú pokojné vety poskladať. Každý kus smie chýbať. */
export interface CardFacts {
  readonly settings: SettingsView | null;
  readonly writeKey: KeyMetaView | null;
  readonly ordersKey: KeyMetaView | null;
  readonly queue: QueueView | null;
  readonly blockers: readonly BlockerWire[] | null;
}

/** Prvá prekážka z oblastí karty. Poradie servera sa zachováva. */
export function cardBlocker(
  slug: SettingsPageSlug,
  blockers: readonly BlockerWire[] | null | undefined,
): BlockerWire | null {
  const areas = CARD_AREAS[slug];
  if (areas.length === 0 || !Array.isArray(blockers)) return null;
  return blockers.find((blocker) => areas.includes(blocker.area)) ?? null;
}

/* ═════════════════════ Pokojné vety jednotlivých kariet ═══════════════════ */

/**
 * Slovenský tvar podstatného mena podľa počtu: 1 → `one`, 2–4 → `few`,
 * 0 a 5+ → `many`.
 *
 * Bez tohto by na karte stálo „4 údajov" — a obrazovka, ktorá nevie skloňovať,
 * pôsobí ako obrazovka, ktorá nevie ani počítať. Pravidlo platí len pre celé
 * čísla; appka tu inými než celými nepočíta.
 */
export function countSk(n: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(Math.trunc(n));
  if (abs === 1) return `${n} ${forms[0]}`;
  if (abs >= 2 && abs <= 4) return `${n} ${forms[1]}`;
  return `${n} ${forms[2]}`;
}

/** „Čo appka vie" — koľko toho vie a koľko vecí priznane nedostane. */
function quietCoVie(): string {
  const can = countSk(APP_CAPABILITIES.length, ['vec', 'veci', 'vecí']);
  const missing = countSk(LOCKED_FEATURES.length, ['údaj', 'údaje', 'údajov']);
  return `Appka vie ${can}. ${missing} z eshopu nedostane.`;
}

/** „Na čo je napojená" — kľúč na zápis a dokedy platí. */
function quietNapojenie(facts: CardFacts): string {
  const key = facts.writeKey;
  if (key === null) return 'Stav kľúča sa nepodarilo prečítať.';
  if (!key.present) return 'Kľúč na zápis nie je uložený.';
  if (key.expiresAt === null) return 'Kľúč na zápis je uložený, platnosť appka nepozná.';
  return `Kľúč na zápis platí do ${formatDateSk(key.expiresAt)}.`;
}

/** „Čo smie robiť" — rozsah jednej zľavy a dnešný rozpočet zápisov. */
function quietCoSmie(facts: CardFacts): string {
  const settings = facts.settings;
  if (settings === null) return 'Rozsah ani rozpočet sa nepodarilo prečítať.';
  const mode = SCOPE_MODE_LABELS[settings.scopeMode];
  const cap = `Rozsah ${mode}: jedna zľava najviac ${settings.maxProductsPerCampaign} produktov.`;
  const budget = facts.queue?.budget ?? null;
  if (budget === null) return `${cap} Rozpočet zápisov na dnes appka nepozná.`;
  return `${cap} Dnes zapísaných ${budget.spent} z ${budget.budget}.`;
}

/** „Čo sa už stalo" — posledný krok fronty. Meraný fakt, nikdy odhad. */
function quietHistoria(facts: CardFacts): string {
  const tick = facts.queue?.heartbeat?.lastTickAt ?? null;
  if (tick === null) return 'Posledný krok fronty appka nepozná.';
  return `Posledný krok fronty ${formatDateTimeSk(tick)}.`;
}

const QUIET: Readonly<Record<SettingsPageSlug, (facts: CardFacts) => string>> = {
  'co-vie': () => quietCoVie(),
  napojenie: quietNapojenie,
  'co-smie': quietCoSmie,
  historia: quietHistoria,
  'cervena-zona': () => 'Oba kľúče a čakajúce zľavy sa dajú zmazať naraz.',
};

/**
 * Tón pokojnej vety.
 *
 * Zelená sa dáva len tam, kde appka naozaj NIEČO OVERILA — pri uloženom kľúči
 * s platnosťou. Všade inde je veta iba konštatovanie a tón zostáva pokojný;
 * zelená pri nedočítanom údaji by bola upokojenie bez krytia.
 */
function quietTone(slug: SettingsPageSlug, facts: CardFacts): StatusTone {
  if (slug !== 'napojenie') return 'idle';
  const key = facts.writeKey;
  if (key === null) return 'idle';
  if (!key.present) return 'critical';
  return key.expiresAt === null ? 'idle' : 'good';
}

/**
 * Stav karty. Prekážka prebíja pokojný fakt — a keď prekážka nie je, veta
 * hovorí, čo je nastavené, nie že je všetko v poriadku.
 */
export function cardState(slug: SettingsPageSlug, facts: CardFacts): SettingsCardState {
  const blocker = cardBlocker(slug, facts.blockers);
  if (blocker !== null) {
    return {
      tone: blockerTone(blocker),
      sentence: blocker.what,
      word: RESOLUTION_WORD[blocker.resolution],
      fromBlocker: true,
    };
  }
  return {
    tone: quietTone(slug, facts),
    sentence: QUIET[slug](facts),
    word: null,
    fromBlocker: false,
  };
}
