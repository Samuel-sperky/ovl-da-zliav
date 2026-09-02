/**
 * Aura Zľavy — ŠESŤ ODPOVEDÍ NA OTÁZKU „PREČO TU NIČ NIE JE" (D134, D142).
 *
 * PREČO TENTO SÚBOR EXISTUJE
 * --------------------------
 * V tejto appke je prázdna obrazovka BEŽNÝ stav, nie výnimka. `shop_write` kľúč
 * dnes chýba, predaje sa nesynchronizovali a obohatených je zlomok katalógu
 * (R4 kontraktu V6), takže „nič tu nie je" vidí človek na väčšine plôch. Preto
 * sa prázdny stav navrhuje ako plnohodnotná obrazovka a hovorí tri veci:
 * **čo sa stalo · čo to znamená · čo má človek urobiť.**
 *
 * A preto sa tie stavy nesmú zliať. Prázdna plocha má v tejto appke ŠESŤ
 * rôznych príčin a každá má iný ďalší krok. Tri z nich si používateľ zamieňa
 * najčastejšie a zámena je vždy nepravda:
 *
 *   · „nič tu ešte nevzniklo"        → `EmptyState`      (dá sa to vytvoriť)
 *   · „hľadanie nič nenašlo"         → `NoResultsState`  (zoznam nie je prázdny)
 *   · „nevieme, lebo sme nemerali"   → `UnmeasuredState` (nie je to nula)
 *
 * Tretia z nich je dôvod, prečo je táto rodina v TEJTO appke cennejšia než
 * inde: appka má pri každom čísle tretiu možnosť a invariant I11 jej zakazuje
 * vydávať ju za nulu. Prázdny stav, ktorý povie „žiadne dáta", to robí — len na
 * úrovni celého panela namiesto jednej bunky.
 *
 * ROZDIEL MEDZI HODNOTOU A PLOCHOU
 * --------------------------------
 * Keď sa nevie JEDNA hodnota, patrí na jej miesto **pomlčka** (`PRODUCT_DASH`,
 * U+2014) s dôvodom v `title` — nie stavová obrazovka. Táto rodina kreslí až
 * to, keď sa nevie CELÁ plocha. Kto pomlčku vymení za `UnmeasuredState`,
 * stratí riadok, ktorý sa dal prečítať; kto celú plochu vyplní pomlčkami,
 * povie šesťkrát to isté a ani raz prečo.
 *
 * KDE SÚ VETY TEJTO RODINY LEN NÁHRADNÍK
 * --------------------------------------
 * Obrazovka, ktorá o svojom prázdne vie viac, má hovoriť SVOJU vetu — presne to
 * robí `catalogEmptyView()` (`products/catalog-status.ts`), ktorá rozlišuje tri
 * príbehy prázdnej tabuľky katalógu a každému dá iný ďalší krok, alebo
 * `enrichPageNote()` (`products/enrich-note.ts`), ktorá povie ČÍSLOM, koľko
 * z denného cieľa obohatenia zostáva. Tento slovník ich NENAHRADZUJE a nesmie
 * ich zdvojiť: sú to náhradné vety pre plochy, ktoré o sebe nevedia nič
 * konkrétne.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Ani jedna veta netvrdí nulu.** „Žiadne dáta", „0 záznamov" ani „nič sa
 *    nenašlo" bez rozlíšenia príbehu sem nepatria. Prázdno je odpoveď len
 *    v `prazdno`; v ostatných piatich je to dôsledok niečoho iného.
 * 2. **Zlyhanie netvrdí, čo sa (ne)zapísalo.** Veta príbehu `zlyhalo` nesmie
 *    povedať „nič sa nezmenilo" — pri neznámej chybe to appka NEVIE a tvrdiť to
 *    je porušenie I11 obráteným smerom (pozri `lib/ui/action-failure.ts`).
 * 3. **Pomlčka je U+2014.** V týchto vetách stojí ako interpunkcia, ale je to
 *    ten istý znak, ktorým appka priznáva „nevieme" — spojovník ani pomlčka
 *    „–" tu nemajú čo robiť (I11, stráži `test/unit/stavove-komponenty.spec.ts`).
 * 4. **Jedna veta.** `meaning` je predvolený `description` prázdneho stavu
 *    a kontrakt UI bod 11 dovoľuje jednu vetu (pozri hlavičku `EmptyState.tsx`,
 *    bod 2). Kto potrebuje druhú, má pre ňu slot `note`.
 *
 * Modul je ČISTÝ (žiadny React), aby sa dal overiť bez prehliadača — rovnaký
 * dôvod ako pri `ui/primitives.ts`.
 *
 * Vlastník: V6a (rodina stavov, D134).
 */

/**
 * Prečo je plocha prázdna. Uzavretý zoznam — šiesty príbeh sa pridáva TU, nie
 * ako nová veta na obrazovke.
 */
export const STATE_STORIES = [
  'prazdno',
  'hladanie',
  'nemerane',
  'bez_pristupu',
  'zlyhalo',
  'nacitava',
] as const;

export type StateStory = (typeof STATE_STORIES)[number];

/** Jeden príbeh: ako sa volá, čo hovorí nadpis, čo to znamená a kto to kreslí. */
export interface StateStoryCopy {
  /** Krátke pomenovanie príbehu — pre hlásenia testov a pre report, nie pre UI. */
  readonly word: string;
  /** Predvolený nadpis stavu: ČO SA STALO. */
  readonly title: string;
  /**
   * Predvolený `description`: ČO TO ZNAMENÁ. Jedna veta a nikdy nie tvrdenie
   * o nule.
   */
  readonly meaning: string;
  /** Komponent, ktorý tento príbeh kreslí. Test overuje, že súbor existuje. */
  readonly component: string;
}

/**
 * Šesť príbehov, šesť vetí. Poradie je poradím rozhodovania na obrazovke:
 * najprv sa pýtaj, či odpoveď vôbec došla, potom či neprišla ako chyba, potom
 * či sme sa mali čím pozrieť, a až nakoniec, či je prázdno naozaj prázdno.
 */
export const STATE_STORY: Readonly<Record<StateStory, StateStoryCopy>> = {
  prazdno: {
    word: 'nič tu ešte nevzniklo',
    title: 'Zatiaľ tu nie je čo ukázať',
    meaning: 'Táto vec ešte nevznikla — nie je to porucha ani nula.',
    component: 'EmptyState',
  },
  hladanie: {
    word: 'hľadanie nič nenašlo',
    title: 'Hľadanie nič nenašlo',
    meaning:
      'Filtru ani hľadanému výrazu neodpovedá ani jeden riadok — prázdny zoznam to neznamená.',
    component: 'NoResultsState',
  },
  nemerane: {
    word: 'nevieme, lebo sme to nemerali',
    title: 'Toto sme nemerali',
    /* Veta hovorí o DÔSLEDKU pre plochu, nie o príčine: príčinu prináša
       `reason` zo spoločného slovníka medzier a dve vety o tom istom by si
       navzájom brali silu. */
    meaning: 'Preto tu nie sú čísla, ktoré by sa dali čítať — nie je to nula.',
    component: 'UnmeasuredState',
  },
  bez_pristupu: {
    word: 'appka sa tam nemá čím pozrieť',
    title: 'Appka na to teraz nemá prístup',
    meaning: 'Appka sa nemala čím pozrieť, takže prázdno tu nie je odpoveď o obsahu.',
    component: 'ForbiddenState',
  },
  zlyhalo: {
    word: 'požiadavka zlyhala',
    title: 'Údaje sa nepodarilo načítať',
    meaning: 'Prázdno je dôsledok zlyhania, nie zistenie — appka nevie, čo tu malo byť.',
    component: 'ErrorState',
  },
  nacitava: {
    word: 'odpoveď ešte nedošla',
    title: 'Načítavam…',
    meaning: 'Kým odpoveď nedošla, appka o obsahu netvrdí nič — ani to, že je prázdny.',
    component: 'LoadingState',
  },
};

/**
 * Text tlačidla, ktoré zopakuje neúspešnú požiadavku.
 *
 * Slovo je tu preto, aby dve obrazovky nemali dve rôzne („Skúsiť znova" /
 * „Znova"). Samotné tlačidlo dodáva volajúci — pozri hlavičku `ErrorState.tsx`.
 */
export const RETRY_LABEL = 'Skúsiť znova';

/** Text akcie, ktorá zruší filtre. Jediná správna akcia príbehu `hladanie`. */
export const RESET_FILTERS_LABEL = 'Zrušiť filtre';

/** Slovo, ktoré drží načítavanie čitateľné aj bez animácie. */
export const LOADING_LABEL = STATE_STORY.nacitava.title;
