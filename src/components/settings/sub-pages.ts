/**
 * Aura Zľavy — NASTAVENIA AKO ROZCESTNÍK (kontrakt UI 13. 8. 2026, body 13–15).
 *
 * PREČO SA JEDNA DLHÁ STRÁNKA ROZPADLA NA PODSTRÁNKY
 * --------------------------------------------------
 * Nastavenia mali 12 sekcií a merali 4,7 obrazovky pri 1440×900 — proti
 * pravidlu P4 (max 1,5) a P5 (max 4 sekcie) to nebolo tesné, bol to
 * trojnásobok. Kotvy v bočnom stĺpci ten problém neriešili, iba ho urobili
 * navigovateľným: človek stále skroloval cez rozpočty a audit, aby sa dostal
 * k prepínaču rozsahu. A práve prepínač rozsahu je vec, ktorú používateľ
 * mesiace nenašiel.
 *
 * Rozcestník teda nie je kozmetika. Je to jediná zmena, ktorá zmestí každú
 * obrazovku Nastavení pod pravidlo P4 bez toho, aby sa čokoľvek zmazalo.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *  1. **Poradie kotiev sa NEMENÍ.** `SETTINGS_ANCHORS` je ploché poradie
 *     odvodené z tejto štruktúry a strážia ho testy: `covie` je prvé (to
 *     používateľ nenašiel), `rozsah` pred `rozpocet`, `zapisy` hneď za
 *     `rozsah`, `cervena` posledná. Rozdelenie na stránky sa deje NAD týmto
 *     poradím, nie namiesto neho.
 *  2. **Každá stará kotva musí ostať funkčná.** Po appke vedie na
 *     `/nastavenia#rozsah` a jemu podobné šesť odkazov (prekážky, AI pravidlá,
 *     zoznam funkcií). Keby sa kotva ocitla na inej podstránke, klik by skončil
 *     na rozcestníku bez vysvetlenia. Preto `subPagePathForAnchor()` — jedna
 *     tabuľka, ktorá starú kotvu preloží na novú cestu, a rozcestník podľa nej
 *     presmeruje.
 *  3. **Červená zóna NIE JE karta.** Maže oba kľúče a ruší čakajúce zľavy;
 *     na rozcestník sa nedostane ani ako dlaždica (bod 14). Vedie k nej jediný
 *     odkaz zo spodku podstránky s brzdami a tam je ešte za rozklikom.
 *  4. **Štruktúra je JEDNA.** Rozcestník, podstránky, bočné kotvy, omrvinková
 *     cesta (D138) aj preklad starých odkazov čítajú `SETTINGS_PAGES`. Druhá
 *     kópia by sa rozišla a odkazy by viedli inam, než kam ukazujú.
 *
 * Čistý modul — žiadny React, žiadny fetch. Aby sa dal celý dokázať testom.
 *
 * Vlastník: V12.
 */

/**
 * Koreň Nastavení — rozcestník. Jedno miesto pre jeho názov aj cestu.
 *
 * Existuje kvôli omrvinke (D138): tá kreslí prvý krok „Nastavenia" a keby si
 * ten názov napísala sama, mohla by o mesiac volať rozcestník inak než sa volá
 * on sám. Omrvinka, ktorá pomenuje stránku inak než jej nadpis, je horšia než
 * žiadna. Preto to slovo čítajú OBAJA — `SettingsIndex` do `h1`, omrvinka do
 * prvého kroku — a `subPagePath()` odtiaľ berie aj predponu cesty.
 */
export const SETTINGS_ROOT: { readonly label: string; readonly path: string } = {
  label: 'Nastavenia',
  path: '/nastavenia',
};

/** Jedna kotva — sekcia, na ktorú vedie odkaz. */
export interface SettingsAnchor {
  readonly id: string;
  readonly label: string;
}

/** Skupina sekcií aj s otázkou, na ktorú spolu odpovedajú. */
export interface SettingsGroup {
  readonly title: string;
  readonly anchors: readonly SettingsAnchor[];
}

/** Slug podstránky — posledný kúsok cesty pod `/nastavenia`. */
export type SettingsPageSlug = 'co-vie' | 'napojenie' | 'co-smie' | 'historia' | 'cervena-zona';

/** Podstránka Nastavení. */
export interface SettingsPage {
  readonly slug: SettingsPageSlug;
  /** Nadpis podstránky — otázka, na ktorú odpovedá. */
  readonly title: string;
  /** Jedna veta pod nadpisom. Bez oslovenia (bod 9 kontraktu UI). */
  readonly lead: string;
  /**
   * Či sa má stránka ponúknuť ako dlaždica na rozcestníku. Červená zóna nie —
   * cesta k nej vedie výhradne cez podstránku s brzdami (bod 14).
   */
  readonly onIndex: boolean;
  readonly groups: readonly SettingsGroup[];
}

/**
 * Štruktúra celých Nastavení. Poradie skupín je poradie otázok, ktoré si človek
 * kladie: čo appka vie → na čo je napojená → čo smie robiť → koľko toho smie
 * → čo sa už stalo → ako ju zastaviť.
 */
export const SETTINGS_PAGES: readonly SettingsPage[] = [
  {
    slug: 'co-vie',
    title: 'Čo appka vie',
    lead: 'Zoznam všetkého, čo appka dokáže, aj s miestom, kde sa to robí. Nič sa tu nenastavuje.',
    onIndex: true,
    groups: [{ title: 'Čo appka vie', anchors: [{ id: 'covie', label: 'Zoznam funkcií' }] }],
  },
  {
    slug: 'napojenie',
    title: 'Na čo je napojená',
    lead: 'Adresa eshopu a oba kľúče. Kľúč sa po uložení už nikdy nezobrazí celý.',
    onIndex: true,
    groups: [
      {
        title: 'Na čo je napojená',
        anchors: [
          { id: 'pripojenie', label: 'Pripojenie' },
          { id: 'kluce', label: 'Kľúče' },
        ],
      },
    ],
  },
  {
    slug: 'co-smie',
    title: 'Čo smie robiť a koľko toho smie',
    lead:
      'Strop jednej zľavy, poistky zápisu a denné rozpočty. Tu sa dvíha strop ' +
      'z desiatich produktov na tisíce.',
    onIndex: true,
    groups: [
      {
        title: 'Čo smie robiť',
        anchors: [
          { id: 'rozsah', label: 'Rozsah zliav' },
          { id: 'zapisy', label: 'Zápisy do eshopu' },
        ],
      },
      { title: 'Koľko toho smie za deň', anchors: [{ id: 'rozpocet', label: 'Rozpočty' }] },
    ],
  },
  {
    slug: 'historia',
    title: 'Čo sa už stalo a ako appku zastaviť',
    lead:
      'Každý pokus o zápis aj s tým, ako skončil. Ďalej diagnostika, priznané ' +
      'medzery a brzdy.',
    onIndex: true,
    groups: [
      {
        title: 'História a hranice',
        anchors: [
          { id: 'historia', label: 'História' },
          { id: 'diagnostika', label: 'Diagnostika' },
          { id: 'zamknute', label: 'Zamknuté funkcie' },
        ],
      },
      {
        /* Kotva `odhlasenie` („Odhlásenie") tu stála do 28. 8. 2026. Prihlásenie
           zmazalo D99 spolu s `SignOut.tsx`, takže sekcia `id="odhlasenie"` už
           neexistuje a rozcestník ponúkal odkaz, ktorý nikam nevedie. Našiel to
           preklik v prehliadači, nie test — `nastavenia-v12.spec.ts` si tú kotvu
           z kontroly identifikátorov výslovne vyňal s tým, že „kryje ju e2e",
           a e2e ju nekryla. Tá výnimka je odteraz zrušená. */
        title: 'Núdzové brzdy',
        anchors: [{ id: 'poistky', label: 'Poistky' }],
      },
    ],
  },
  {
    slug: 'cervena-zona',
    title: 'Červená zóna',
    lead:
      'Jediná akcia, ktorá maže dáta: zmaže oba kľúče a zruší čakajúce zľavy. ' +
      'Je za rozklikom zámerne.',
    onIndex: false,
    groups: [{ title: 'Červená zóna', anchors: [{ id: 'cervena', label: 'Zmazať kľúče' }] }],
  },
];

/** Skupiny v poradí, v akom idú za sebou. Ploché — bez ohľadu na podstránky. */
export const SETTINGS_GROUPS: readonly SettingsGroup[] = SETTINGS_PAGES.flatMap(
  (page) => page.groups,
);

/** Ploché poradie kotiev. Odvodené, nikdy písané druhýkrát. */
export const SETTINGS_ANCHORS: readonly SettingsAnchor[] = SETTINGS_GROUPS.flatMap(
  (group) => group.anchors,
);

/** Podstránky, ktoré sa kreslia ako dlaždice na rozcestníku. */
export const INDEX_PAGES: readonly SettingsPage[] = SETTINGS_PAGES.filter((page) => page.onIndex);

/** Cesta na podstránku. Jediné miesto, kde sa cesta skladá zo slugu. */
export function subPagePath(slug: SettingsPageSlug): string {
  return `${SETTINGS_ROOT.path}/${slug}`;
}

/**
 * Omrvinková cesta na podstránku: rozcestník → táto stránka (D138).
 *
 * Žije TU, nie v komponente, z toho istého dôvodu ako bod 4 hlavičky: keby si
 * ju podstránka skladala sama, vznikla by druhá kópia štruktúry a časom by
 * ukazovala inam než rozcestník. Posledný krok cesty NEMÁ — omrvinka ju
 * poslednému kroku aj tak zahodí (`Breadcrumb.tsx`, bod 1).
 *
 * Tvar `{ label, href? }` je zámerne štruktúrny, nie importovaný typ: tento
 * modul je čistý a na komponent sa nevie ani typom.
 */
export function settingsTrail(
  slug: SettingsPageSlug,
): readonly { readonly label: string; readonly href?: string }[] {
  const page = pageBySlug(slug);
  const root = { label: SETTINGS_ROOT.label, href: SETTINGS_ROOT.path };
  if (page === null) return [root];
  return [root, { label: page.title }];
}

/** Podstránka podľa slugu, alebo `null` pri neznámom. Fail-closed. */
export function pageBySlug(slug: string): SettingsPage | null {
  return SETTINGS_PAGES.find((page) => page.slug === slug) ?? null;
}

/**
 * Na ktorej podstránke býva kotva. Vstup je `#kotva` aj `kotva`; neznáma kotva
 * vracia `null` a volajúci vtedy nechá človeka na rozcestníku — hádať sa
 * nesmie, lebo zlá podstránka je horšia než žiadna.
 */
export function subPagePathForAnchor(hash: string): string | null {
  const id = hash.startsWith('#') ? hash.slice(1) : hash;
  if (id === '') return null;
  for (const page of SETTINGS_PAGES) {
    for (const group of page.groups) {
      if (group.anchors.some((anchor) => anchor.id === id)) {
        return `${subPagePath(page.slug)}#${id}`;
      }
    }
  }
  return null;
}

/**
 * Odkaz použiteľný odkiaľkoľvek v appke. `#kotva` sa preloží na plnú cestu
 * s podstránkou, čokoľvek iné (`/produkty`) prejde nezmenené.
 *
 * Vďaka tomuto zostáva v `APP_CAPABILITIES` zapísaná KOTVA, nie cesta —
 * a keď sa sekcia raz presunie na inú podstránku, opraví sa to na jednom mieste.
 */
export function hrefForAnchor(href: string): string {
  if (!href.startsWith('#')) return href;
  return subPagePathForAnchor(href) ?? `/nastavenia${href}`;
}
