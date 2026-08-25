/**
 * Aura Zľavy — STAVOVÉ PRAVIDLÁ V `globals.css` (spoločný parser pre testy).
 *
 * PREČO EXISTUJE
 * --------------
 * Dva testy sa pýtali „existuje trieda, ktorú appka emituje?" cez `toContain`
 * nad celým CSS:
 *
 *   test/unit/stavy-slovnik.spec.ts  expect(css).toContain(`.${cls.replace(' ', '.')}`)
 *   test/unit/paleta.spec.ts         expect(CSS).toContain('.sig.progress')
 *
 * Obe tvrdenia sa dajú obísť premenovaním `.sig.progress {` na
 * `.sig.progress-strong {`: pôvodný reťazec v súbore ostane ako PODREŤAZEC,
 * oba testy zostanú zelené — a appka bude emitovať triedu, ktorá nekreslí nič.
 * To je presne tá regresia, kvôli ktorej `paleta.spec.ts` ten test dostal
 * (piaty stav „prebieha" splynul s „nečinný"). Navyše sa CSS pri hľadaní
 * nestrihalo od komentárov, hoci `globals.css` `.sig.lock` v komentári spomína.
 *
 * ČO S TÝM
 * --------
 * Otázka nie je „je ten reťazec v súbore", ale „existuje BLOK s tým presným
 * selektorom a nesie farbu". `stavovePravidla()` na to odpovedá: rozreže CSS
 * na pravidlá `.state.*` / `.sig.*` a vráti selektor + hodnotu `color:`.
 * Selektor sa potom porovnáva na ROVNOSŤ, nie na podreťazec.
 *
 * Parser sem prišiel z `test/unit/paleta.spec.ts` (kde stráži, že stav kreslí
 * výhradne stavová škála) — nie je to tretia kópia, ale presun jedinej, aby ju
 * mohol použiť aj `stavy-slovnik.spec.ts`. Rovnaká myšlienka „meno triedy
 * končí tam, kde končí meno" žije v `test/unit/mrtve-triedy.spec.ts`
 * (`maTriedu()`); tá kópia patrí cudziemu súboru a ostáva, kde je.
 */

/**
 * CSS bez komentárov. Komentáre smú spomínať čokoľvek (`globals.css` píše
 * o histórii tried), takže hľadať pravidlo v nich je omyl.
 */
export function bezKomentarov(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

export interface StavovePravidlo {
  /** Napr. `.sig.progress` alebo `.state.bezi` — presne tak, ako stojí v CSS. */
  selektor: string;
  /** Hodnota `color:` daného bloku, napr. `var(--st-progress)`. */
  farba: string;
}

/**
 * Pravidlá, ktorých selektor je stavový A ktoré naozaj nesú `color:`.
 *
 * Blok bez farby sa nevracia zámerne: stavová trieda, ktorá farbu nenastavuje,
 * pre volajúcich neexistuje — presne to je tá „trieda, čo nekreslí nič".
 */
export function stavovePravidla(css: string): StavovePravidlo[] {
  const out: StavovePravidlo[] = [];
  const re = /^(\.(?:state|sig)\.[a-z0-9-]+)\s*\{([^}]*)\}/gim;
  for (const m of bezKomentarov(css).matchAll(re)) {
    const telo = m[2] ?? '';
    const farba = telo.match(/(?:^|\s)color:\s*([^;]+);/);
    if (farba) out.push({ selektor: (m[1] ?? '').trim(), farba: (farba[1] ?? '').trim() });
  }
  return out;
}

/**
 * Nesie CSS blok s PRESNE týmto selektorom farbu? Odpoveď `undefined` znamená
 * „taký blok neexistuje" — a je to iná odpoveď než „existuje niečo, čo sa tak
 * začína".
 */
export function stavovePravidlo(css: string, selektor: string): StavovePravidlo | undefined {
  return stavovePravidla(css).find((p) => p.selektor === selektor);
}
