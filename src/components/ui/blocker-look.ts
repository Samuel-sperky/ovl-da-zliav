/**
 * Aura Zľavy — JEDEN SLOVNÍK STAVU PREKÁŽKY (tón, glyf, slovo, zámok).
 *
 * Tento súbor je odpoveďou na najvážnejší nález nezávislého review z 19. 8.
 * 2026: appka mala pre tú istú vec ŠTYRI prevodníky `resolution → vzhľad` a tri
 * z nich hovorili tri rôzne veci.
 *
 * AKO TO VZNIKLO (a prečo sa to už nesmie zopakovať)
 * --------------------------------------------------
 * Prekážky (`lib/status/blockers.ts`) sa na povrch dostávajú štyrmi cestami a
 * každá cesta si kedysi napísala vlastnú tabuľku vzhľadu:
 *
 *   • `dashboard/live-status-model.ts`  → `RESOLUTION_LOOK` (tóny warn/lock/idle),
 *   • `campaigns/queue-model.ts`        → `RESOLUTION_TONE/GLYPH/WORD`,
 *   • `settings/blockers-view.ts`       → `RESOLUTION_TONE/WORD`,
 *   • `layout/status.ts`                → `resolutionTone()` pre stavový pruh.
 *
 * Každá vznikla sama osebe rozumne: tá obrazovka práve vznikala, prevod bol tri
 * riadky a zdal sa lokálny. Lenže prevod NIE JE lokálny — je to tvrdenie appky
 * o jednej a tej istej prekážke. Výsledok bolo vidieť na snímkach: prekážka
 * `writes_disabled` bola na Prehľade jantárová „rieši sa mimo appky" a na
 * Detaile zľavy červená „mimo appky". Používateľ prešiel o jednu obrazovku
 * ďalej a to isté sa mu zmenilo z „pozor" na „chyba".
 *
 * Preto: **prevod žije TU a nikde inde.** Kto potrebuje z prekážky farbu, glyf
 * alebo slovo, importuje `resolutionLook()`. Staršie mapy v modeloch obrazoviek
 * zostali len ako kompatibilné okná do tohto slovníka — sú odvodené, nie
 * napísané. Kto by na obrazovke napísal vlastný `Record<…, StatusTone>` nad
 * `resolution`, otvorí presne tú istú chybu znova a `test/unit/stavy-slovnik`
 * mu spadne.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Farbu volí SPÔSOB RIEŠENIA, nie závažnosť** (kontrakt UI, bod 7). Má to
 *    dôvod: vyčerpaný denný rozpočet je závažnosťou `blokuje`, ale nie je to
 *    chyba — appka počká do polnoci (K2). Farbenie podľa závažnosti by z
 *    každého normálneho dňa spravilo poplach. Závažnosť preto nesie SLOVO
 *    (`SEVERITY_WORD`), nikdy farbu.
 *
 * 2. **Stav nikdy nie je len farba.** Každý `BlockerLook` nesie farbu, značku
 *    aj slovo naraz, aby sa tri kanály nemohli rozísť. V tmavej téme sú susedné
 *    tóny pod deuteranopiou takmer nerozlíšiteľné a samotný farebný bod povie
 *    časti používateľov presne nič.
 *
 * 3. **Tónov je päť a sú to `--st-*`** (critical / attention / progress / good
 *    / idle). Sú zmerané aj pri farbosleposti (`test/unit/paleta.spec.ts`).
 *    Teal (`--accent`), zlatá (`--gold*`) ani `--brand` nekódujú stav NIKDY.
 *
 * 4. **`lock` NIE JE tón.** Do 19. 8. mal Prehľad pre `sudo` šiesty „tón"
 *    `lock` (tlmená sivá) a tá istá prekážka bola na Zľavách jantárová. Zámok
 *    je SPÔSOB RIEŠENIA — „cesta existuje, len si vypýta heslo" — nie miera
 *    závažnosti, a preto je v tomto slovníku samostatné pole `locked` a
 *    samostatná ikona zámku. Tón `sudo` je `attention` ako pri `sam`, lebo
 *    používateľ s tým TERAZ vie pohnúť. Trieda `.sig.lock` v `globals.css`
 *    zostáva, ale patrí trvalému obmedzeniu (pilotný strop), nie prekážke.
 *
 * 5. **Červená je vyhradená pre zastavený zápis a stratu dát.** `mimo_appky`
 *    znamená, že zápis stojí a z obrazovky sa s tým nedá urobiť nič — presne
 *    ten prípad. `cakanie` je pokojné, nič sa nepokazilo.
 *
 * 6. **Vety sa tu neskladajú.** `what` a `nextStep` píše server; tento modul
 *    dodáva len tón, glyf a jedno slovo o spôsobe riešenia.
 *
 * Vlastník: R-A, opravná vlna 19. 8. 2026.
 */
import type { IconName } from '@/components/ui/Icon';
import { TONE_ICON, type StatusTone } from '@/components/ui/ToneBadge';

/* ═══════════════════ 1. Kódy zo servera (zrkadlo blockers.ts) ═════════════ */

/**
 * Ako sa prekážka odstráni. Zhodné s `BlockerResolution` v
 * `lib/status/blockers.ts`; keby tam pribudol piaty kód, tabuľky nižšie sa
 * neskompilujú a chyba sa ukáže tu, nie ako prázdne miesto na obrazovke.
 */
export type BlockerResolutionCode = 'sam' | 'sudo' | 'cakanie' | 'mimo_appky';

/** Čo cez prekážku neprejde. Zhodné s `BlockerSeverity` v `blockers.ts`. */
export type BlockerSeverityCode = 'blokuje' | 'obmedzuje' | 'informuje';

/** Poradie je poradím hľadania, nie dôležitosti — tú určuje server. */
export const BLOCKER_RESOLUTION_CODES: readonly BlockerResolutionCode[] = [
  'sam',
  'sudo',
  'cakanie',
  'mimo_appky',
];

/* ═══════════════════ 2. Vzhľad prekážky — tri kanály naraz ════════════════ */

/**
 * Ako sa prekážka kreslí. Tri kanály stavu v jednej hodnote, aby ich nikto
 * nemohol vziať po jednom a nechať zvyšné dva zastarať.
 */
export interface BlockerLook {
  /** Farba zo stavovej škály `--st-*`. Volí ju SPÔSOB RIEŠENIA. */
  readonly tone: StatusTone;
  /**
   * Druhý kanál — ikona zo sady `ui/Icon.tsx`. Nikdy nestojí namiesto slova,
   * vždy vedľa neho.
   */
  readonly icon: IconName;
  /**
   * @deprecated Textová podoba druhého kanála. Zostáva PRÁZDNA a je to zámer.
   *
   * `campaigns/BlockerList.tsx` ju ešte vypisuje do vlastného spanu; kým
   * prejde na `icon`, musí pole existovať, ale nesmie vrátiť znak — symbolové
   * glyfy sa kreslili iným písmom než zvyšok appky a `sudo` malo dokonca
   * FAREBNÚ emodži. Značku na tom mieste kreslí CSS maska
   * (`campaigns/zlavy.module.css`, `.blockerGlyph::before`).
   */
  /** Tretí kanál — kto a ako to vyrieši. Neosobne, bez oslovenia. */
  readonly word: string;
  /**
   * Cesta von existuje, ale vypýta si heslo. Je to VLASTNOSŤ spôsobu riešenia,
   * nie tón: obrazovka podľa nej kreslí zámok (`LockBadge`), farbu z toho
   * nikdy neodvodzuje.
   */
  readonly locked: boolean;
}

/**
 * Jediná tabuľka `resolution → vzhľad` v celej appke.
 *
 *  - `sam`        — jantár. Používateľ s tým vie pohnúť, len ešte nepohol.
 *  - `sudo`       — jantár rovnako ako `sam`: cesta v appke existuje, len si
 *                   vypýta heslo. Zámok nesie glyf a slovo, nie farba.
 *  - `cakanie`    — pokojná sivá. Nič sa nepokazilo, appka čaká na polnoc (K2).
 *  - `mimo_appky` — červená. Zápis stojí a z obrazovky sa s tým nedá urobiť
 *                   nič; červená je vyhradená pre stratu dát a zastavený zápis
 *                   a toto je presne ten druhý prípad.
 */
export const RESOLUTION_LOOK: Readonly<Record<BlockerResolutionCode, BlockerLook>> = {
  sam: {
    tone: 'attention',
    icon: TONE_ICON.attention,
    word: 'rieši sa v appke',
    locked: false,
  },
  sudo: {
    tone: 'attention',
    /* Zámok, nie trojuholník: `sudo` má rovnaký TÓN ako `sam`, takže ikona je
       jediné, čo tie dva spôsoby riešenia od seba na prvý pohľad odlíši. */
    icon: 'lock',
    word: 'rieši sa v appke, vypýta si heslo',
    locked: true,
  },
  cakanie: {
    tone: 'idle',
    icon: TONE_ICON.idle,
    word: 'čaká sa, netreba nič',
    locked: false,
  },
  mimo_appky: {
    tone: 'critical',
    icon: TONE_ICON.critical,
    word: 'rieši sa mimo appky',
    locked: false,
  },
};

/**
 * Prekážka, ktorej spôsob riešenia appka nepozná.
 *
 * Nič si o ňom nedomýšľa: tón je jantárový (treba sa pozrieť), nie červený
 * (netvrdíme poruchu) a nie sivý (netvrdíme, že netreba nič). Slovo to priznáva.
 */
export const UNKNOWN_RESOLUTION_LOOK: BlockerLook = {
  tone: 'attention',
  icon: TONE_ICON.attention,
  word: 'treba sa na to pozrieť',
  locked: false,
};

/** Vzhľad prekážky. Jediné povolené miesto tohto prevodu v celej appke. */
export function resolutionLook(
  resolution: BlockerResolutionCode | null | undefined,
): BlockerLook {
  if (resolution === null || resolution === undefined) return UNKNOWN_RESOLUTION_LOOK;
  return RESOLUTION_LOOK[resolution] ?? UNKNOWN_RESOLUTION_LOOK;
}

/**
 * Jeden kanál slovníka ako samostatná mapa.
 *
 * Existuje kvôli modelom obrazoviek, ktoré roky vystavovali `RESOLUTION_TONE`,
 * `RESOLUTION_ICON` a `RESOLUTION_WORD` zvlášť. Tie mapy zostali, ale sú
 * ODVODENÉ týmto volaním — nikto ich už nepíše ručne, takže sa nemajú od čoho
 * rozísť. Nové obrazovky majú siahať rovno po `resolutionLook()`.
 */
export function lookChannel<K extends keyof BlockerLook>(
  channel: K,
): Readonly<Record<BlockerResolutionCode, BlockerLook[K]>> {
  return {
    sam: RESOLUTION_LOOK.sam[channel],
    sudo: RESOLUTION_LOOK.sudo[channel],
    cakanie: RESOLUTION_LOOK.cakanie[channel],
    mimo_appky: RESOLUTION_LOOK.mimo_appky[channel],
  };
}

/* ═══════════════════ 3. Závažnosť — vždy slovom, nikdy farbou ═════════════ */

/**
 * Závažnosť ako SLOVO.
 *
 * Farba patrí spôsobu riešenia (bod 1 hlavičky), takže bez tohto slova by
 * riadok, ktorý zastavuje zápis, vyzeral rovnako ako riadok, ktorý len hlási
 * platné pravidlo. Do 19. 8. bolo toto slovo len na Prehľade — `BlockerRow`,
 * ktorý kreslí prekážky na Zľavách, Detaile aj Novej zľave, ho nevykresľoval
 * vôbec, takže oprava D6 platila na jednej zo štyroch obrazoviek. Odvtedy ho
 * kreslia oba riadky z tejto jednej tabuľky.
 */
export const SEVERITY_WORD: Readonly<Record<BlockerSeverityCode, string>> = {
  blokuje: 'zastavuje zápis',
  obmedzuje: 'spomaľuje zápis',
  informuje: 'nezastavuje nič',
};

/** Slovo o závažnosti. Neznáma závažnosť sa nedopĺňa — fail-closed je `blokuje`. */
export function severityWord(severity: BlockerSeverityCode): string {
  return SEVERITY_WORD[severity] ?? SEVERITY_WORD.blokuje;
}

/* ═══════════════════ 4. Tón → trieda signálnej značky ═════════════════════ */

/**
 * Tón → trieda `.sig` z `globals.css`.
 *
 * `.sig.*` sú mená TRIED, nie druhý slovník stavov: nesú tú istú päticu
 * `--st-*` pod historickými menami (`ok`, `warn`, `bad`) a cez masku v
 * `::before` aj ikonu, takže sa značka nedá zredukovať na samotnú farbu.
 *
 * `progress` tu do 19. 8. mapoval na `sig idle`, lebo `.sig` variantu
 * `progress` nemal — piaty stav tým prestal existovať a „prebieha" splynulo
 * s „nečinný". `.sig.progress` (farba `--st-progress`, vlastná ikona) medzitým
 * v `globals.css` pribudol, takže sa mapuje na seba.
 */
export const TONE_SIG_CLASS: Readonly<Record<StatusTone, string>> = {
  critical: 'sig bad',
  attention: 'sig warn',
  progress: 'sig progress',
  good: 'sig ok',
  idle: 'sig idle',
};

/** Trieda značky pre `className`. */
export function toneSigClass(tone: StatusTone): string {
  return TONE_SIG_CLASS[tone] ?? TONE_SIG_CLASS.idle;
}
