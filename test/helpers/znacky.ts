/**
 * Aura Zľavy — TRI KANÁLY STAVU NAD VYKRESLENÝM MARKUPOM (spoločný pomocník).
 *
 * ČO SA TU MERIA
 * --------------
 * Pravidlo appky znie: **stav nikdy nie je nesený iba farbou — vždy farba +
 * značka + slovo.** Farba sama je pre časť používateľov (deuteranopia,
 * protanopia, monochromatická tlač) prázdny kanál; stav, ktorý má len ju,
 * na obrazovke nevyzerá ako chyba, ale ako preklep. Tento súbor dáva testom
 * nástroje, ktorými sa to pravidlo dá zmerať:
 *
 *   FARBA  — trieda uzla nesie tón (`sig ok`, `state bezi`, `_flagCritical_…`),
 *            a v prípade globálnych tried aj skutočnú farbu v `globals.css`;
 *   ZNAČKA — vnútri TOHO ISTÉHO uzla stojí práve jedna `<svg class="ovl-ic">`;
 *   SLOVO  — po odstránení značiek v uzle zostane čitateľný text.
 *
 * PREČO PO VÝSKYTOCH A NIE PO SÚBOROCH
 * ------------------------------------
 * `test/unit/ikony.spec.ts` stráži to isté pravidlo s hrubosťou SÚBORU: pýta
 * sa „kreslí tento súbor aspoň jednu značku?". Keď má súbor dvoch tónovaných
 * hostiteľov a jednému z nich značka zmizne, druhý ho upokojí a test ostane
 * zelený. Presne tak prešiel defekt kontroly „Rozsah pilotný" (20. 8. 2026).
 * Preto sa tu meria VYKRESLENÝ výstup (`renderToStaticMarkup`), rozreže sa na
 * uzly a každý hostiteľ sa preveruje SÁM ZA SEBA.
 *
 * PREČO VLASTNÝ PARSER
 * --------------------
 * Prostredie testov je `node` bez DOM (`vitest.config.ts`) a otázku „je značka
 * VNÚTRI tohto uzla" sa regexom nad celým dokumentom položiť nedá — jej
 * hrubšia náhrada („je `<svg>` niekde v HTML") je práve tá diera, ktorá
 * mutáciu pustila. Pribrať kvôli jednému tvrdeniu jsdom by bola nová
 * závislosť, ktorú šprint zakazuje.
 *
 * AKO TENTO SÚBOR VZNIKOL
 * -----------------------
 * Zlúčením TROCH nezávislých kópií toho istého skenera, ktoré si vlna 1
 * šprintu 20 napísala trikrát vedľa seba:
 *
 *   - `znacky-prehlad-kontroly.spec.ts`  (A1) — `parse/classOf/textOf/hosts/
 *      hasMark/label`, stromový parser nad celým Prehľadom;
 *   - `znacky-zlavy-fronta.spec.ts`      (A2) — `uzly/text/hostitelia/maTon/
 *      overHostitelov`, dlaždice fronty a riadky prekážok;
 *   - `znacky-nastavenia-stavy.spec.ts`  (A3) — `stavoveUzly/maFarbu/
 *      overTriKanaly`, päť formulárov Nastavení.
 *
 * Rozdiely medzi nimi neboli chyby — každý meral inú obrazovku. Zlúčenie preto
 * NEvybralo jednu kópiu ako víťaza, ale zobralo od každej to, čo robila
 * PRÍSNEJŠIE, takže zvyšné dve tým zosilneli:
 *
 *   1. **Značka je `<svg class="ovl-ic">`, nie hocijaké `<svg>`** (od A2/A3).
 *      A1 hľadala len `<svg`, čiže by ju upokojila aj dekoratívna grafika bez
 *      ikony zo sady `ui/Icon.tsx`.
 *   2. **Značka je PRÁVE JEDNA, nie „aspoň jedna"** (od A3). Dve značky
 *      v jednom stave nie sú prísnejší stav, ale dva stavy pomiešané v jednom
 *      uzle.
 *   3. **Slovo má aspoň `NAJKRATSIE_SLOVO` znakov** (od A3). „neprázdne"
 *      (A1/A2) prejde aj nad interpunkciou.
 *   4. **Entity sa pri čítaní slova rozpúšťajú** (od A1). Bez toho uzol
 *      s obsahom `&nbsp;` prejde ako uzol so slovom — pritom slovo tam nie je.
 *   5. **Značka stojí PRED slovom** (od A1). Inak by sa značky na susedných
 *      riadkoch nezarovnali na to isté x.
 *   6. **Hostiteľ sa hľadá po CELÝCH tokenoch triedy a v ĽUBOVOĽNOM prvku**
 *      (od A1/A2). A3 hľadala regexom len `<span>`/`<p>`, ktorých trieda sa
 *      tokenom začína; `.checks`, `.stopq` ani hašované mená z CSS modulu
 *      (`_flagCritical_1a2b3`) hostiteľmi nie sú a ani byť nesmú.
 *   7. **Prázdny nález je PÁD, nie úspech** (od všetkých troch). Každé
 *      tvrdenie o „všetkých hostiteľoch" má pred sebou poistku na ich počet —
 *      bez nej by rozbitý parser svietil zeleno nad prázdnym zoznamom. Tak
 *      vznikol zelený test o troch mŕtvych selektoroch (19. 8. 2026).
 *
 * ČO SA NEZLÚČILO A PREČO
 * -----------------------
 *  - **Tón musí mať farbu v `globals.css`** (`maFarbu`) platí len tam, kde sú
 *    triedy globálne. Zľavy kreslia príznaky cez CSS moduly
 *    (`_flagCritical_587bce`) a Prehľad má holú `.flag` s predvoleným tónom —
 *    ani jedno v `globals.css` pod menom tónu nestojí. Je to preto samostatná
 *    funkcia, nie súčasť `overHostitelov`.
 *  - **Holá `.sig` bez tónu je ZÁMER, nie zabudnuté miesto** (`maTon`).
 *    `campaigns/BlockerList.tsx` ňou dáva závažnosti tvar značky, ale ani
 *    farbu, ani glyf — tie kóduje spôsob riešenia vedľa. Musí mať slovo
 *    a NESMIE mať značku; `overHostitelov` tvrdí oboje, aby sa výnimka nedala
 *    použiť ako zadné dvierka.
 *  - **Presný počet vs. dolná hranica hostiteľov.** Nad izolovaným renderom
 *    jedného komponentu sa počet tvrdí presne (`overHostitelov`). Nad celou
 *    obrazovkou zloženou z troch sekcií je to dolná hranica — inak by test
 *    padol pri každom ubratom riadku textu. Sú to dve rôzne merania, nie
 *    prísnejšie a voľnejšie; volí ich volajúci.
 *
 * PASCA: meria sa VÝSTUP, nie zdroj. Trieda `sig lock` v zdroji nikde nestojí —
 * skladá ju `sigClass(tone)` (`dashboard/live-status-model.ts`), `toneSigClass()`
 * a mapa `TONE_SIG_CLASS` (`ui/blocker-look.ts`) až za behu. Kto by tu hľadal
 * literál grepom, dokáže si nepravdu; tá pasca šprint už raz zdržala.
 */
import { expect } from 'vitest';

/* ═════════════════════════ 1. Rozrezanie markupu ══════════════════════════ */

/** Prvok vykresleného markupu aj s tým, čo je VNÚTRI neho. */
export interface Uzol {
  /** Meno prvku (`span`, `div`, `p`, …), vždy malými písmenami. */
  readonly tag: string;
  /** Atribúty ako mapa — `class`, `data-state`, `data-testid`, `data-any`. */
  readonly atributy: Readonly<Record<string, string>>;
  /** Trieda rozdelená na tokeny. CSS moduly sú tu ako `_queueTile_587bce`. */
  readonly triedy: readonly string[];
  /**
   * Vnútro uzla ako surové HTML — jediné miesto, kde smie stáť jeho značka.
   * Prvky bez obsahu (`<br/>`, `<path …/>`) majú prázdny reťazec.
   */
  readonly vnutro: string;
}

/** Prvky bez obsahu — React ich vypisuje ako `<br/>`, `<img …/>`. */
const PRAZDNE_PRVKY = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
const ATRIBUT = /([\w:-]+)="([^"]*)"/g;

function rozborAtributov(surove: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of surove.matchAll(ATRIBUT)) out[a[1]!] = a[2]!;
  return out;
}

function novyUzol(tag: string, surove: string, vnutro: string): Uzol {
  const atributy = rozborAtributov(surove);
  return {
    tag,
    atributy,
    triedy: (atributy.class ?? '').split(/\s+/).filter(Boolean),
    vnutro,
  };
}

/**
 * Rozreže vykreslený markup na uzly aj s ich vnútrom.
 *
 * Je to zámerne hlúpy skener a nie regex nad dokumentom: otázka „je značka
 * VNÚTRI tohto uzla" sa nad dokumentom položiť nedá. Nespárované zatváracie
 * značky sa ignorujú, prázdne a samozatvárajúce prvky sa vracajú tiež — inak
 * by sa `<input data-…>` z merania stratil.
 */
export function uzly(html: string): Uzol[] {
  const out: Uzol[] = [];
  const stack: { tag: string; surove: string; od: number }[] = [];
  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = TAG.exec(html)) !== null) {
    const zatvaraci = m[1] === '/';
    const tag = m[2]!.toLowerCase();
    const surove = m[3] ?? '';
    const samozatvaraci = m[4] === '/';

    if (zatvaraci) {
      // Nájdi najbližší otvorený rovnaký prvok; nespárované značky ignoruj.
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i]!.tag !== tag) continue;
        const otvoreny = stack[i]!;
        out.push(novyUzol(tag, otvoreny.surove, html.slice(otvoreny.od, m.index)));
        stack.length = i;
        break;
      }
      continue;
    }

    if (samozatvaraci || PRAZDNE_PRVKY.has(tag)) {
      out.push(novyUzol(tag, surove, ''));
      continue;
    }
    stack.push({ tag, surove, od: m.index + m[0]!.length });
  }
  return out;
}

/* ═══════════════════════════ 2. Tri kanály ════════════════════════════════ */

/** Značka zo sady `ui/Icon.tsx`, vykreslená. Nie hocijaké `<svg>`. */
export const IKONA = /<svg\b[^>]*class="[^"]*\bovl-ic\b/;

/** Tá istá značka, ale ukotvená na začiatok vnútra uzla. */
const IKONA_NA_ZACIATKU = /^\s*<svg\b[^>]*class="[^"]*\bovl-ic\b/;

/** Tokeny triedy, ktorými sa hostiteľ stavu ohlasuje. */
const RODINA = new Set(['sig', 'flag', 'state']);

/** Najkratšie slovo, ktoré sa ešte počíta za slovo (a nie za interpunkciu). */
export const NAJKRATSIE_SLOVO = 4;

/**
 * Varianty rodiny `.sig`/`.flag`/`.state`, ktoré nesú farbu v `globals.css`.
 *
 * Nie je to zoznam všetkých tónov appky — hašované triedy z CSS modulov
 * (`_flagCritical_587bce`) ani holá `.flag` s predvoleným tónom tu nie sú
 * a byť nemajú.
 */
export const TONY: readonly string[] = [
  'ok', 'warn', 'bad', 'progress', 'idle', 'lock', 'good', 'neutral',
  'attention', 'critical', 'live', 'done', 'pripravena', 'zapisuje', 'bezi',
  'skoncila',
];

/**
 * Hostitelia stavu — prvky, ktorých `class` obsahuje `sig`, `flag` alebo
 * `state` ako CELÝ token.
 *
 * Ako token, nie ako podreťazec: `.checks`, `.stopq` ani hašované mená z CSS
 * modulu (`_flagCritical_1a2b3`) hostiteľmi nie sú.
 */
export function hostitelia(html: string): Uzol[] {
  return uzly(html).filter((u) => u.triedy.some((t) => RODINA.has(t)));
}

/**
 * SLOVO — text, ktorý človek prečíta.
 *
 * Značky sa nahrádzajú medzerou (nie prázdnom), aby sa dve susedné slová
 * nezliali do jedného. Entity sa rozpúšťajú tiež: uzol, v ktorom je len
 * `&nbsp;`, slovo NEMÁ, hoci reťazec prázdny nie je.
 */
export function text(zdroj: string | Uzol): string {
  const html = typeof zdroj === 'string' ? zdroj : zdroj.vnutro;
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Koľko značiek nesie uzol priamo vo svojom vnútri. */
export function pocetZnaciek(u: Uzol): number {
  return (u.vnutro.match(/<svg\b[^>]*class="[^"]*\bovl-ic\b/g) ?? []).length;
}

/** Nesie uzol značku priamo vo svojom vnútri? Značka o uzol vedľa sa neráta. */
export function maZnacku(u: Uzol): boolean {
  return IKONA.test(u.vnutro);
}

/** Stojí značka PRED slovom? Inak sa riadky nezarovnajú na to isté x. */
export function znackaJePrva(u: Uzol): boolean {
  return IKONA_NA_ZACIATKU.test(u.vnutro);
}

/**
 * Nesie hostiteľ TÓN?
 *
 * Holá `.sig` (jediná trieda, žiadna ďalšia) je zámerná výnimka. Všetko
 * ostatné v rodine tón nesie, vrátane `.flag` bez modifikátora (predvolený
 * tón je `attention`) a tried z CSS modulu (`_flagCritical_…`).
 */
export function maTon(u: Uzol): boolean {
  return !(u.triedy.length === 1 && u.triedy[0] === 'sig');
}

/** Tóny uzla, ktoré majú v `globals.css` pomenovanú triedu. */
export function tony(u: Uzol): readonly string[] {
  return u.triedy.filter((t) => TONY.includes(t));
}

/** Má tón v danom CSS vlastnú farbu? Bez toho je „farba" prázdny sľub. */
export function maFarbu(ton: string, css: string): boolean {
  return new RegExp(`\\.(?:sig|flag|state)\\.${ton}\\s*\\{[^}]*color:\\s*var\\(--`, 'm').test(css);
}

/** Krátky popis uzla do hlásenia, aby bolo vidieť KTORÝ stav je pokazený. */
export function popis(u: Uzol): string {
  return `<${u.tag} class="${u.triedy.join(' ')}"> ${text(u).slice(0, 40)}`;
}

/* ═════════════════════ 3. Hotové merania pre spec súbory ══════════════════ */

/**
 * Pri KAŽDOM hostiteľovi v markupe tri kanály zvlášť.
 *
 * `ocakavany` je PRESNÝ počet hostiteľov — bez neho by tvrdenie prešlo aj nad
 * hostiteľom, ktorý z obrazovky zmizol úplne (nula uzlov je nula porušení).
 * Hlásenie pomenúva konkrétny uzol, nie súbor; inak by nepovedalo o nič viac
 * než to hrubé meranie, ktoré tieto testy nahrádzajú.
 */
export function overHostitelov(kde: string, html: string, ocakavany: number): void {
  const najdene = hostitelia(html);
  expect(najdene.length, `${kde}: iný počet hostiteľov, než test čaká`).toBe(ocakavany);

  for (const u of najdene) {
    const meno = `${kde} · <${u.tag} class="${u.triedy.join(' ')}">`;
    if (!maTon(u)) {
      // Holá `.sig` má slovo a značku mať NESMIE — výnimka nie sú zadné dvierka.
      expect(text(u), `${meno}: výnimka bez slova`).not.toBe('');
      expect(maZnacku(u), `${meno}: holá .sig si značku pribrala`).toBe(false);
      continue;
    }
    expect(pocetZnaciek(u), `${meno}: značka nie je práve jedna — stav je len farba a slovo`).toBe(1);
    expect(znackaJePrva(u), `${meno}: značka stojí za slovom, nie pred ním`).toBe(true);
    expect(
      text(u).length,
      `${meno}: bez slova — značka slovo nenahrádza`,
    ).toBeGreaterThanOrEqual(NAJKRATSIE_SLOVO);
  }
}

/**
 * To isté, ale nad obrazovkami s GLOBÁLNYMI triedami tónov (Nastavenia).
 *
 * Navyše sa tvrdí, že hostitelia sú menovite tí, ktorí tam majú byť
 * (`data-testid`), a že ich tón má v `css` naozaj svoju farbu. Tón bez farby
 * je prázdny sľub — kanál, ktorý sa v CSS stratil, a nikto si to nevšimol.
 */
export function overTriKanaly(
  markup: string,
  ocakavane: readonly string[],
  kde: string,
  css: string,
): void {
  const najdene = hostitelia(markup);
  expect(
    najdene
      .map((u) => u.atributy['data-testid'] ?? null)
      .filter((t): t is string => t !== null)
      .sort(),
    `${kde}: chýba stavový uzol`,
  ).toEqual([...ocakavane].sort());
  expect(najdene.length, `${kde}: nenašiel sa ani jeden stavový uzol`).toBe(ocakavane.length);

  for (const u of najdene) {
    const meno = `${kde} → ${u.atributy['data-testid'] ?? u.triedy.join(' ')}`;
    const t = tony(u);
    expect(t.length, `${meno}: trieda "${u.triedy.join(' ')}" nenesie tón, teda ani farbu`).toBe(1);
    expect(maFarbu(t[0]!, css), `${meno}: tón ${t[0]} nemá v globals.css farbu`).toBe(true);
    expect(pocetZnaciek(u), `${meno}: značka nie je práve jedna (stav je len farba a slovo)`).toBe(1);
    expect(znackaJePrva(u), `${meno}: značka stojí za slovom, nie pred ním`).toBe(true);
    expect(text(u).length, `${meno}: pri značke nestojí slovo`).toBeGreaterThanOrEqual(
      NAJKRATSIE_SLOVO,
    );
  }
}
