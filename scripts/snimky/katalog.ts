/**
 * Aura Zľavy — SNÍMKOVAČ: vymyslený katalóg šperkov.
 *
 * PREČO SA NEBERIE SKUTOČNÝ EXPORT
 * --------------------------------
 * `test/e2e/fixtures/katalog-vzorka.ndjson` je výsek z ostrého eshopu. Snímky
 * odchádzajú z počítača von, takže v nich nesmie byť ani jeden riadok
 * skutočných dát. Názvy sa preto skladajú tu — ale zámerne v tom istom TVARE
 * ako ostré: dlhé, so slovenskou diakritikou, s rozmermi a pomlčkami. Krátke
 * názvy by z tabuľky spravili vzdušnú obrazovku, ktorá u používateľa nikdy
 * nevznikne, a hustota by sa posudzovala nad niečím, čo neexistuje.
 *
 * Generátor je DETERMINISTICKÝ (vlastný lineárny kongruentný generátor), takže
 * dva behy snímkovača dajú tie isté riadky a snímky sa dajú porovnávať.
 *
 * Vlastník: snímkovač (`scripts/snimky.ts`).
 */
import type { CatalogRowView } from '@/components/products/catalog-api';

import { okamih } from './datumy';

const DRUH = [
  'Oceľové náušnice',
  'Oceľový prívesok',
  'Náramok z chirurgickej ocele',
  'Dámsky prstienok',
  'Piercing do pupka',
  'Piercing do brady a pery',
  'Retiazka z chirurgickej ocele',
  'Strieborný prsteň',
  'Náhrdelník z ocele',
  'Oceľové manžetové gombíky',
] as const;

const DOPLNOK = [
  'so zirkónmi',
  's čírym kameňom',
  's perleťovým vzorom',
  's matným povrchom',
  's dvoma guličkami',
  's výrezmi a geometrickými tvarmi',
  'so srdiečkom a retiazkou',
  's vyrezávanými motýľmi',
  's farebnými pásikmi',
  's obrázkom lebky',
] as const;

const CHVOST = [
  '',
  ' — pár',
  ' žltej a ružovej farby',
  ', háčiky',
  ' 4 / 5 mm',
  ' rozpínací, vzor kocky a čiary',
  ' v darčekovej krabičke',
  ' pre alergikov, bez niklu',
] as const;

/** Lineárny kongruentný generátor — rovnaký beh, rovnaké riadky. */
function nahoda(seed: number): () => number {
  let stav = seed >>> 0;
  return () => {
    stav = (stav * 1_664_525 + 1_013_904_223) >>> 0;
    return stav / 4_294_967_296;
  };
}

/** Vymyslený katalóg — `pocet` riadkov v tvare, aký kreslí tabuľka. */
export function vyrobKatalog(pocet: number): readonly CatalogRowView[] {
  const r = nahoda(20_260_824);
  const rows: CatalogRowView[] = [];

  for (let i = 0; i < pocet; i += 1) {
    const druh = DRUH[Math.floor(r() * DRUH.length)]!;
    const doplnok = DOPLNOK[Math.floor(r() * DOPLNOK.length)]!;
    const chvost = CHVOST[Math.floor(r() * CHVOST.length)]!;
    const predane = Math.floor(r() * r() * 42);
    const cena = (2 + r() * 68).toFixed(2);

    rows.push({
      productId: 4100 + i * 7,
      name: `${druh} ${doplnok}${chvost}`,
      price: cena,
      hasAttributes: r() < 0.35,
      shopStatus: r() < 0.04 ? 'not_found' : 'ok',
      unitsSold: predane,
      everDiscounted: r() < 0.45,
      discountedNow: r() < 0.12,
      fetchedAt: okamih(-60 * 9),
      origin: r() < 0.06 ? 'shop' : 'mirror',
    });
  }

  return rows;
}

/** Jeden katalóg pre celý beh — obrazovky musia ukazovať tie isté riadky. */
export const KATALOG = vyrobKatalog(240);
