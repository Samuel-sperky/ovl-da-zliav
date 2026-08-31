/**
 * Aura Zľavy — NEZNÁMY PREDAJ SA DO PÁSMA NEZARADÍ (D121, 28. 8. 2026).
 *
 * Prečo to má vlastný súbor: do 28. 8. 2026 bral `soldBucketOf()` `number`,
 * takže „nevieme" sa doň nedalo vyjadriť. Neznámy predaj prišiel ako nula,
 * spadol do vedra `none` a dostal `DEFAULT_TIER_PERCENT.none`, teda **30 %** —
 * najhlbšiu zľavu v appke. Kým je obohacovanie pozastavené (D118, ~207 dní na
 * celý katalóg pri ~200 čítaniach/deň), vyzerá tak väčšina katalógu, takže by
 * tisíce produktov dostali 30 % na základe čísla, ktoré appka nezmerala.
 * Zapísaná zľava je nevratná (I7), takže je to fail-closed.
 *
 * Testy nižšie držia OBE strany rozdielu:
 *  - `null` (nevieme) → do pásma NEIDE,
 *  - `0` (zmerané, nepredalo sa nič) → pásmo `none` si DRŽÍ.
 * Keby sa zliali, appka by buď zlacnila to, o čom nič nevie, alebo prestala
 * zlacňovať skutočné ležiaky.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TIER_PERCENT,
  buildTiers,
  discountWriteRequest,
  soldBucketOf,
  type SelectableRow,
} from '@/components/campaigns/discounts-model';
import { parseCatalogPage } from '@/components/campaigns/zlavy-api';
import { parseCatalogSearch } from '@/components/products/catalog-api';

function row(productId: number, unitsSold: number | null): SelectableRow {
  return {
    productId,
    name: `Produkt ${productId}`,
    reference: null,
    price: '10.00',
    unitsSold,
    discountedNow: false,
  };
}

describe('soldBucketOf — „nevieme" nie je nula (D121)', () => {
  it('`null` vráti `null`, nie vedro `none`', () => {
    expect(soldBucketOf(null)).toBeNull();
  });

  it('ZMERANÁ nula si vedro `none` drží — je to odpoveď, nie nevedomosť', () => {
    expect(soldBucketOf(0)).toBe('none');
  });

  it('neznáme a zmerané sa nesmú zliať: `null` a `0` dávajú RÔZNY výsledok', () => {
    expect(soldBucketOf(null)).not.toBe(soldBucketOf(0));
  });

  it('nečíslo (NaN, Infinity) je tiež „nevieme", nie nula', () => {
    // Fail-closed: rozbité číslo sa nesmie stať najhlbšou zľavou.
    expect(soldBucketOf(Number.NaN)).toBeNull();
    expect(soldBucketOf(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('hranice vedier zostali nedotknuté (1–2 low, 3–9 mid, 10+ high)', () => {
    expect(soldBucketOf(1)).toBe('low');
    expect(soldBucketOf(2)).toBe('low');
    expect(soldBucketOf(3)).toBe('mid');
    expect(soldBucketOf(9)).toBe('mid');
    expect(soldBucketOf(10)).toBe('high');
  });
});

describe('buildTiers — neznámy predaj nedostane pásmo ani zľavu (D121)', () => {
  it('produkt s `null` je v `unknownProductIds` a v ŽIADNOM pásme', () => {
    const { tiers, unknownProductIds } = buildTiers([row(1, null), row(2, 5)], 180);

    expect(unknownProductIds).toEqual([1]);
    const vsetkyVPasmach = tiers.flatMap((t) => t.productIds);
    expect(vsetkyVPasmach).toEqual([2]);
    expect(vsetkyVPasmach).not.toContain(1);
  });

  it('NEDOSTANE 30 % — presne to, čo sa dialo do 28. 8. 2026', () => {
    const { tiers } = buildTiers([row(1, null)], 180);

    // Žiadne pásmo nevznikne, takže niet čím produkt zlacniť.
    expect(tiers).toEqual([]);
    // A keby niekto vedro `none` vrátil, toto tvrdenie ho usvedčí.
    const noneTier = tiers.find((t) => t.bucket === 'none');
    expect(noneTier).toBeUndefined();
    expect(DEFAULT_TIER_PERCENT.none).toBe(30);
  });

  it('ZMERANÁ nula pásmo `none` dostane — ležiaky sa zlacňovať neprestali', () => {
    const { tiers, unknownProductIds } = buildTiers([row(1, 0)], 180);

    expect(unknownProductIds).toEqual([]);
    expect(tiers).toHaveLength(1);
    expect(tiers[0]!.bucket).toBe('none');
    expect(tiers[0]!.percent).toBe(DEFAULT_TIER_PERCENT.none);
    expect(tiers[0]!.productIds).toEqual([1]);
  });

  it('zmiešaná sada: neznáme sa oddelia, zmerané sa rozdelia normálne', () => {
    const { tiers, unknownProductIds } = buildTiers(
      [row(1, null), row(2, 0), row(3, 1), row(4, 5), row(5, 50), row(6, null)],
      180,
    );

    expect(unknownProductIds).toEqual([1, 6]);
    expect(tiers.map((t) => t.bucket)).toEqual(['none', 'low', 'mid', 'high']);
    expect(tiers.flatMap((t) => t.productIds)).toEqual([2, 3, 4, 5]);
  });

  it('sada, kde NEVIEME NIČ, nevyrobí ani jedno pásmo', () => {
    const { tiers, unknownProductIds } = buildTiers([row(1, null), row(2, null)], 180);

    // Toto je stav appky, kým je IP zabanovaná a obohacovanie stojí. Správna
    // odpoveď je „nemám čo zlacniť", nie „zlacním všetko o 30 %".
    expect(tiers).toEqual([]);
    expect(unknownProductIds).toEqual([1, 2]);
  });

  it('písmená pásiem sa neznámymi produktmi nerozhodia', () => {
    const { tiers } = buildTiers([row(1, null), row(2, 5), row(3, 50)], 180);

    // Preskočený produkt nesmie po sebe nechať dieru v abecede.
    expect(tiers.map((t) => t.letter)).toEqual(['A', 'B']);
    expect(tiers.map((t) => t.ord)).toEqual([1, 2]);
  });
});

describe('discountWriteRequest — produkty a pásma sa nemajú ako rozísť (D121)', () => {
  it('do zápisu ide ZJEDNOTENIE pásiem, nie pôvodný výber', () => {
    const partition = buildTiers([row(1, null), row(2, 0), row(3, 7)], 180);
    const req = discountWriteRequest(partition);

    // Produkt 1 (neznámy predaj) vo výbere BOL, do zápisu nesmie.
    expect(req.productIds).toEqual([2, 3]);
    expect(req.productIds).not.toContain(1);
  });

  it('INVARIANT: `productIds` je presne zjednotenie `tiers[].productIds`', () => {
    /*
     * Toto je to tvrdenie, ktoré robí chybu nevyjadriteľnou. Keby sa
     * `productIds` niekedy začalo brať z iného zdroja než z pásiem, rozišlo by
     * sa s nimi — a tento test to zachytí bez ohľadu na to, odkiaľ ten druhý
     * zdroj je.
     */
    const partition = buildTiers(
      [row(1, null), row(2, 0), row(3, 1), row(4, 5), row(5, 99), row(6, null)],
      180,
    );
    const req = discountWriteRequest(partition);

    const zPasiem = req.tiers.flatMap((tier) => [...tier.productIds]).sort((a, b) => a - b);
    expect([...req.productIds].sort((a, b) => a - b)).toEqual(zPasiem);
    // A ani jeden neznámy produkt v tom zjednotení nie je.
    for (const id of partition.unknownProductIds) {
      expect(req.productIds, `neznámy produkt ${id} sa dostal do zápisu`).not.toContain(id);
    }
  });

  it('keď nevieme nič, do zápisu nejde ani jeden produkt a niet čo zapísať', () => {
    const req = discountWriteRequest(buildTiers([row(1, null), row(2, null)], 180));

    expect(req.productIds).toEqual([]);
    expect(req.tiers).toEqual([]);
  });

  it('percento hlavičky sa berie z tých istých pásiem', () => {
    const partition = buildTiers([row(1, 0), row(2, 99)], 180);
    const req = discountWriteRequest(partition);

    // `none` = 30 %, `high` = 10 % → hlavička nesie najvyššie.
    expect(req.percent).toBe(DEFAULT_TIER_PERCENT.none);
    expect(req.tiers.map((t) => t.percent)).toEqual([
      DEFAULT_TIER_PERCENT.none,
      DEFAULT_TIER_PERCENT.high,
    ]);
  });
});

/*
 * SERVEROVÁ POLOVICA D121 (31. 8. 2026). Model vyššie bol pripravený od
 * 28. 8. 2026, ale server posielal `unitsSold` vždy ako číslo a KLIENTSKE
 * parsery mali `?? 0`, takže „nevieme" sa na cestu k `buildTiers()` nikdy
 * nedostalo. Tieto testy hovoria o tvare, ktorý PRÍDE PO DRÔTE — a `?? 0`
 * v ktoromkoľvek z dvoch parserov ich zčervená (mutačne overené).
 */
describe('parsery odpovede — `null` z drôtu prežije až do pásiem (D121)', () => {
  /** Odpoveď servera pri okne, z ktorého nie sú stiahnuté dni. */
  const payload = {
    data: [
      { productId: 11, name: 'Neznámy', price: '10.00', unitsSold: null, discountedNow: false },
      { productId: 12, name: 'Zmeraná nula', price: '10.00', unitsSold: 0, discountedNow: false },
      { productId: 13, name: 'Predaný', price: '10.00', unitsSold: 7, discountedNow: false },
    ],
    page: 1,
    perPage: 50,
    total: 3,
    soldWindowDays: 180,
  };

  it('Produkty (`catalog-api`): `null` zostane `null`, nula zostane nulou', () => {
    const view = parseCatalogSearch(payload);
    expect(view?.data.map((row) => row.unitsSold)).toEqual([null, 0, 7]);
  });

  it('Nová zľava (`zlavy-api`): to isté — je to tá istá odpoveď', () => {
    const view = parseCatalogPage(payload);
    expect(view?.data.map((row) => row.unitsSold)).toEqual([null, 0, 7]);
  });

  it('chýbajúce pole je „nevieme", nie nula (odpoveď bez `unitsSold`)', () => {
    const view = parseCatalogPage({ data: [{ productId: 21, name: 'Bez poľa' }] });
    expect(view?.data[0]?.unitsSold).toBeNull();
  });

  it('`buildTiers()` nad parsovanou odpoveďou preskočí len neznámy riadok', () => {
    const view = parseCatalogPage(payload);
    const rows: SelectableRow[] = (view?.data ?? []).map((row) => ({
      productId: row.productId,
      name: row.name,
      price: row.price,
      unitsSold: row.unitsSold,
      discountedNow: row.discountedNow,
    }));
    const partition = buildTiers(rows, 180);

    expect(partition.unknownProductIds).toEqual([11]);
    // Vedro `none` (30 %) patrí VÝHRADNE zmeranej nule.
    const none = partition.tiers.find((tier) => tier.bucket === 'none');
    expect(none?.percent).toBe(DEFAULT_TIER_PERCENT.none);
    expect(none?.productIds).toEqual([12]);
  });
});
