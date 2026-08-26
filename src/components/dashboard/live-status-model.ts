/**
 * Aura Zľavy — ČISTÉ ROZHODOVANIE ŽIVÉHO STAVU (V9; kontrakt dokončenia C1–C3,
 * kontrakt UI 13. 8. 2026 body 3, 5 a 6).
 *
 * Prehľad má odpovedať na otázku „je všetko v poriadku?" do troch sekúnd a na
 * otázku „prečo sa nič nedeje?" bez otvorenia logu. Obe odpovede sú TVRDENIA
 * o produkčnom eshope, takže sa musia dať overiť bez prehliadača — presne ako
 * `overview-model.ts` pri fronte. Tento modul preto berie surové pohľady zo
 * `status-api.ts` a vracia hotové rozhodnutie; komponenty ho už len kreslia.
 *
 * ČO SA Z TOHTO MODULU 18. 8. VYPADLO A PREČO
 * -------------------------------------------
 * Sekcia „Živý stav" ukazovala štyri veci — spojenie, kľúč, rozpočet zápisov
 * a naplnenie katalógu — ktoré od 13. 8. nesie STAVOVÝ PRUH (chróm). Dve kópie
 * toho istého faktu sa vždy raz za čas rozídu o minútu a vtedy sa nedá povedať,
 * ktorá klame. Sekcia preto zanikla a s ňou `keyPill`, `catalogMeter`,
 * `budgetResetPhrase` a `liveStatusView`. Zostalo len to, čo pruh NEHOVORÍ:
 * spojenie so shopom, rozsah zľavy, poistky zápisu, posledný krok fronty a
 * priznané medzery. Skladá ich do jednej vety `overview-verdict.ts`.
 *
 * ČO SA V TOMTO MODULE NESMIE POKAZIŤ
 * -----------------------------------
 *
 * 1. **Stav nikdy nie je len farba.** Každý riadok aj každá pilulka nesú tón,
 *    GLYF a SLOVO. Glyf a slovo pridáva `globals.css` (`.sig`) alebo primitív
 *    (`StatusPill`, `BudgetMeter`); tento modul dodáva tón a slovo naraz, aby
 *    sa nemohli rozísť.
 * 2. **Vzhľad prekážky sa tu UŽ NEROZHODUJE.** Do 19. 8. tu stála vlastná
 *    tabuľka `RESOLUTION_LOOK` s tónmi `warn / lock / idle`, kým
 *    `campaigns/queue-model.ts` mal vedľa nej svoju s tónmi
 *    `critical / attention / idle`. Tá istá prekážka tak bola na Prehľade
 *    jantárová „rieši sa mimo appky" a na Detaile zľavy červená „mimo appky" —
 *    používateľ prešiel o obrazovku ďalej a to isté sa mu zmenilo z „pozor" na
 *    „chyba". Jediný slovník teraz žije v `ui/blocker-look.ts` a tento modul ho
 *    už len prepúšťa ďalej. Kto sem vráti vlastnú tabuľku, otvorí tú istú
 *    chybu znova; pravidlo „farbu volí `resolution`, nie `severity`" (K2) drží
 *    odteraz on.
 * 3. **Vety prekážok sa tu NEPREPISUJÚ.** `what` a `nextStep` skladá server;
 *    tento modul im dáva len poradie, tón a slovo o spôsobe riešenia.
 * 4. **Neznáme sa priznáva.** Chýbajúci údaj nikdy nevedie k upokojujúcej
 *    vete: buď je tón `idle` so slovom „nevieme", alebo sa riadok nekreslí.
 *    Nula ani „asi je to v poriadku" sa nedopĺňajú (P7).
 * 5. **Vnútorný kód sa nikdy nedostane na povrch** (K10). Kódy nečitateľných
 *    sekcií prekladá `SECTION_WORD`; keby pribudla siedma sekcia bez prekladu,
 *    riadok o nej radšej vypadne, než by sa vypísal surový.
 *
 * Vlastník: V9.
 */
import type {
  BlockerRow,
  CatalogSyncView,
  StatusSectionCode,
} from '@/components/dashboard/status-api';
import type { StatusTone } from '@/components/ui/ToneBadge';
import { formatDateTimeSk } from '@/lib/ui/format';

/**
 * Jediný slovník stavu prekážky. Prehľad ho len prepúšťa ďalej, aby staršie
 * importy (`resolutionLook` z tohto modulu) ostali funkčné — rozhoduje sa
 * v `ui/blocker-look.ts` a nikde inde.
 */
export {
  RESOLUTION_LOOK,
  SEVERITY_WORD,
  UNKNOWN_RESOLUTION_LOOK,
  resolutionLook,
  severityWord,
  toneSigClass,
} from '@/components/ui/blocker-look';
export type { BlockerLook, BlockerLook as ResolutionLook } from '@/components/ui/blocker-look';

/* ═══════════════════════ 1. Signálne značky (.sig) ════════════════════════ */

/**
 * Meno triedy `.sig.*` z `globals.css` — NIE druhá škála stavov.
 *
 * Sú to historické mená tried (`ok`, `warn`, `bad`) nad tou istou päticou
 * `--st-*`, ktorú vystavuje `StatusTone`. Nové miesta majú počítať v tónoch a
 * na triedu prekladať cez `toneSigClass()`; tento typ existuje pre miesta,
 * ktoré si tón ukladajú rovno ako meno triedy (`overview-verdict.ts`).
 *
 * `lock` je medzi nimi zámerne: patrí trvalému obmedzeniu, ktoré appka vedome
 * NEsignalizuje ako závažnosť (pilotný strop). Prekážke sa priradiť nesmie —
 * zámok je spôsob riešenia, a ten nesie `BlockerLook.locked`.
 */
export type SigTone = 'ok' | 'warn' | 'bad' | 'progress' | 'idle' | 'lock';

/**
 * Trieda značky pre `className`. Jediné miesto, kde sa `.sig` skladá.
 *
 * Trieda nesie IBA farbu — značku treba dokresliť `<SigMark variant={tone} />`
 * (`ui/StatusMark.tsx`) do toho istého uzla, kde stojí slovo. Platí to aj pre
 * `lock`: `scopeCheck()` (`overview-verdict.ts`) ho vracia v pilotnom rozsahu,
 * takže `class="sig lock"` reálne vzniká, hoci ten literál v `src/` nikde
 * nestojí. Mŕtvosť tejto rodiny sa grepom na literál dokázať NEDÁ.
 */
export function sigClass(tone: SigTone): string {
  return `sig ${tone}`;
}

/* ═══════════════════════ 2. Spojenie so shopom (StatusPill) ══════════════════ */

export interface PillView {
  readonly tone: StatusTone;
  /** Názov stavu po slovensky. */
  readonly label: string;
  /** Doplnok pod stavom (čas). Nikdy nie kľúč ani jeho časť. */
  readonly detail: string | null;
}

/**
 * Spojenie so shopom.
 *
 * Dôkazom spojenia je posledné ÚSPEŠNÉ čítanie katalógu — appka si kvôli
 * prístrojovej doske do shopu nevolá (to by míňalo rozpočet čítaní), takže
 * hovorí len to, čo naozaj vie. Doména sa tu zámerne NEOPAKUJE: je nad každou
 * obrazovkou v trvalom pruhu „PRODUKCIA — doména" a druhá kópia by bola len
 * ďalšie miesto, ktoré sa môže rozísť.
 *
 * ODMIETNUTIE NIE JE MLČANIE a od 26. 8. 2026 to pilulka rozlišuje. Do vtedy
 * mala na oba stavy jednu vetu — „Shop naposledy neodpovedal" — a pri bane na
 * IP adresu (platí od 19. 8. 2026) to bolo nepravdivé v tom jedinom slove, na
 * ktorom záleží: shop ODPOVEDAL, len nás nepustil. Rozdiel nie je slovíčkarenie,
 * je to iný ďalší krok — mlčanie prejde samo, odmietnutie adresy nie.
 */
export function shopPill(sync: CatalogSyncView | null): PillView {
  if (sync === null) {
    return { tone: 'idle', label: 'Spojenie so shopom nevieme', detail: null };
  }
  if (sync.ipBanned) {
    return {
      tone: 'attention',
      label: 'Shop odmieta našu IP adresu',
      detail: sync.lastReadAt === null ? null : formatDateTimeSk(sync.lastReadAt),
    };
  }
  if (sync.failedLastTime || sync.waiting === 'error') {
    return {
      tone: 'attention',
      label: 'Shop naposledy neodpovedal',
      detail: sync.lastReadAt === null ? null : formatDateTimeSk(sync.lastReadAt),
    };
  }
  if (sync.lastReadAt === null) {
    return { tone: 'idle', label: 'Zo shopu sme ešte nečítali', detail: null };
  }
  return {
    tone: 'good',
    label: 'Spojené so shopom',
    detail: formatDateTimeSk(sync.lastReadAt),
  };
}

/* ═══════════════════════ 3. Posledný krok fronty ══════════════════════════ */

export interface HeartbeatView {
  readonly lastTickAt: string | null;
  readonly stale: boolean;
}

export interface HeartbeatSummary {
  readonly tone: SigTone;
  readonly word: string;
  /** Meraný fakt, nikdy odhad. */
  readonly detail: string;
}

/**
 * Či appka frontu vôbec kontroluje.
 *
 * `stale` je FAKT z databázy (posledný krok fronty chýba dlhšie než povolené
 * okno) a je to jediná vec, ktorá odlíši „nič sa nezapisuje, lebo netreba" od
 * „nič sa nezapisuje, lebo appka nežije". Fail-closed: bez údaja platí to horšie.
 */
export function heartbeatSummary(heartbeat: HeartbeatView | null): HeartbeatSummary {
  const stale = heartbeat === null ? true : heartbeat.stale;
  const at = heartbeat?.lastTickAt ?? null;
  const detail = at === null ? 'posledný krok fronty nepoznáme' : `posledný krok ${formatDateTimeSk(at)}`;
  return {
    tone: stale ? 'warn' : 'ok',
    word: stale ? 'appka frontu nekontroluje' : 'appka kontroluje frontu',
    detail,
  };
}

/* ═══════════════════════ 4. Prekážky na obrazovke ═════════════════════════ */

/**
 * Prekážky, ktoré patria na Prehľad — VŠETKY TRI ÚROVNE (kontrakt UI, bod 6).
 *
 * Do 18. 8. sa `informuje` vynechávalo a trvalé obmedzenia (strop rozsahu,
 * neúplný katalóg) mala na starosti samostatná sekcia „Živý stav". Tá sekcia
 * zanikla — opakovala štyri veci zo stavového pruhu — a s ňou zanikol aj dôvod
 * filtrovať. Zoznam sa preto vracia celý; poradie zo servera sa NEMENÍ, je
 * súčasťou správania `blockers.ts` a má vlastný test.
 *
 * Funkcia zostáva ako JEDNO miesto, kde sa o obsahu zoznamu rozhoduje. Keby
 * sa raz niektorá úroveň znovu vynechávala, stane sa to tu a nikde inde.
 */
export function screenBlockers(blockers: readonly BlockerRow[]): readonly BlockerRow[] {
  return blockers;
}

/**
 * Stojí niečo appke v ceste? Podľa toho sa sekcia prekážok kreslí alebo mlčí.
 *
 * Bod 3 kontraktu UI hovorí: keď zápisu nič nebráni, sekcia sa NEKRESLÍ VÔBEC
 * a celou odpoveďou je zelená značka v stavovom pruhu. Bod 6 hovorí, že keď sa
 * kreslí, sú v nej všetky tri úrovne. Rozhodnutie je preto na závažnosti:
 * `blokuje` a `obmedzuje` sekciu otvárajú, samotné `informuje` nie — trvalé
 * pravidlo (napr. platný pilotný strop) nie je dôvod, prečo sa niečo nedeje,
 * a jeho miesto je v riadku kontrol pri dominante.
 */
export function hasObstacles(blockers: readonly BlockerRow[]): boolean {
  return blockers.some((row) => row.severity === 'blokuje' || row.severity === 'obmedzuje');
}

/** Popis cesty, kam prekážka vedie. Neznáma cesta dostane neutrálne sloveso. */
export function pathLabel(path: string): string {
  if (path === '/nastavenia') return 'Nastavenia';
  if (path === '/produkty') return 'Produkty';
  if (path === '/zlavy') return 'Zľavy';
  if (path === '/zlavy/nova') return 'Nová zľava';
  return 'Otvoriť';
}

/* ═══════════════════════ 5. Priznané medzery ══════════════════════════════ */

/** Kód sekcie stavu → slovenské pomenovanie. Bez neho by na povrch šiel kód. */
export const SECTION_WORD: Readonly<Record<StatusSectionCode, string>> = {
  writes: 'poistky zápisu',
  apiKey: 'kľúč na zápis',
  writeBudget: 'rozpočet zápisov',
  scope: 'rozsah zľavy',
  catalog: 'katalóg',
  catalogReads: 'rozpočet čítaní',
  salesSync: 'stav predajnosti',
};

/**
 * Veta o tom, čo sa nepodarilo prečítať — alebo `null`, keď sedí všetko.
 *
 * Appka radšej prizná medzeru, než by o nej mlčala: práve pri chybe databázy
 * vyzerá prístrojová doska najpokojnejšie a to je presne ten moment, keď klame.
 */
export function unreadableSentence(sections: readonly StatusSectionCode[]): string | null {
  const words = sections.map((code) => SECTION_WORD[code]).filter((word) => word !== undefined);
  if (words.length === 0) return null;
  return `Nedá sa prečítať: ${words.join(', ')}. Čísla o tom appka nedopĺňa.`;
}
