/**
 * Aura Zľavy — SPRIEVODCA NOVOU ZĽAVOU: ŽIVÉ SELEKTORY A PÁS TROCH KROKOV
 * (V6b, 2. 9. 2026; D139, D143, kontrakt V6 §4).
 *
 * PREČO TENTO SÚBOR VZNIKOL — CHYBA, KTORÚ TESTY VIDIEŤ NEMOHLI
 * ─────────────────────────────────────────────────────────────
 * Commit `ba8333b` prepol `NewDiscount.tsx` zo `zlavy.module.css` na
 * `new-discount.module.css` a agentovi skončila session pred prepisom mien
 * tried. V JSX teda zostalo `styles.nz`, `styles.nzHead`, `styles.nzCol`,
 * `styles.tiers`, `styles.win`, `styles.winline`, `styles.pushRight`,
 * `styles.nzEmpty`, `styles.note` — DEVÄŤ kľúčov, ktoré v novom module
 * NEEXISTUJÚ. V prehliadači je taký kľúč `undefined`, teda
 * `class="undefined"`: dvojstĺpcová mriežka, karty, tabuľka pásiem aj okno
 * platnosti sa rozsypali na jeden stĺpec neštýlovaného textu. Samuel to
 * ohlásil vetou „neviem vytvoriť zľavu".
 *
 * A TERAZ TÁ PASCA: 4651 testov zostalo ZELENÝCH a `class="undefined"` sa
 * v markupe nenašlo ANI RAZ. Vitest totiž `.module.css` rieši Proxy-om, ktorý
 * na KAŽDÝ kľúč vráti hašované meno — `styles.nz` je v testoch `_nz_e472ea`
 * aj vtedy, keď v súbore nič také nie je. Vykreslený markup teda o tejto
 * triede chýb nepovie NIČ a jediný spôsob, ako ju zmerať, je čítať CSS ako
 * TEXT. Preto skupina A.
 *
 * Zvyšok súboru stráži, že pás krokov (návod, pre ktorý celá oprava vznikla)
 * sa naozaj kreslí, a že priznanie D121 nad pásmami má číslo aj dôvod.
 *
 * Vlastník: V6b (oblasť Nová zľava, krok 1 — sprievodca).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import NewDiscount, {
  UNKNOWN_SOLD_PHRASE,
  WIZARD_STEPS,
  WIZARD_STEP_WORD,
  unknownTierNoteText,
  wizardStepStates,
  type NewDiscountInitial,
} from '@/components/campaigns/NewDiscount';
import { DEFAULT_CATALOG_FILTER } from '@/components/products/catalog-filter';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** Zdroj bez komentárov — `styles.foo` v komentári nie je vykreslená trieda. */
const bezKomentarov = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const MODUL = read('../../src/components/campaigns/new-discount.module.css');

/** Súbory, ktoré kreslia vzhľad sprievodcu z jeho vlastného CSS modulu. */
const KRESLIA = [
  '../../src/components/campaigns/NewDiscount.tsx',
  '../../src/components/campaigns/DiscountPresets.tsx',
] as const;

const INITIAL: NewDiscountInitial = {
  productIds: null,
  filter: { ...DEFAULT_CATALOG_FILTER, soldWindowDays: 180, soldBuckets: ['none'] },
  expectedTotal: null,
  window: null,
};

const html = renderToStaticMarkup(createElement(NewDiscount, { initial: INITIAL }));

/* ═════════ A. Každá modulová trieda naozaj existuje ══════════════════════ */

describe('A. `styles.*` sprievodcu sa v jeho module nájde', () => {
  it('oba súbory berú vzhľad z modulu sprievodcu, nie zo spoločného', () => {
    /* Bez tejto poistky by cyklus nižšie prešiel aj nad prázdnym zoznamom —
       presne tak vznikol zelený test o mŕtvych selektoroch v Produktoch. */
    for (const rel of KRESLIA) {
      expect(bezKomentarov(rel), rel).toContain(
        "from '@/components/campaigns/new-discount.module.css'",
      );
    }
    expect(MODUL.length).toBeGreaterThan(1000);
  });

  it('ani jeden použitý kľúč nechýba (inak je to `class="undefined"`)', () => {
    const chybajuce: string[] = [];
    let pouzitych = 0;
    for (const rel of KRESLIA) {
      const mena = new Set(
        [...bezKomentarov(rel).matchAll(/styles\.([a-zA-Z0-9_]+)/g)].map((m) => m[1]!),
      );
      pouzitych += mena.size;
      for (const meno of mena) {
        // `\b` nestačí: `.name` je podreťazcom `.nameRow`, a taká zhoda by
        // z testu spravila náhodu. Trieda končí zátvorkou, čiarkou alebo
        // medzerou pred zátvorkou.
        if (!new RegExp(`\\.${meno}(?![a-zA-Z0-9_-])`).test(MODUL)) chybajuce.push(`${meno}`);
      }
    }
    expect(pouzitych).toBeGreaterThan(20);
    expect(chybajuce, 'tieto triedy v new-discount.module.css nie sú').toEqual([]);
  });

  it('ani jedna deklarovaná trieda nezostala bez volajúceho (D139)', () => {
    /*
     * Druhý smer toho istého pravidla. Mŕtva trieda v module je presne ten
     * dlh, pre ktorý D139 hovorí „prevedená obrazovka si staré triedy zmaže":
     * o mesiac ju niekto použije v domnení, že niečo kreslí, alebo ju upraví
     * a nič sa nestane. Modul sprievodcu kreslia práve dva súbory, takže
     * „nikto ju nevolá" sa dá zmerať bez pochybnosti.
     */
    const pouzite = new Set(
      KRESLIA.flatMap((rel) => [
        ...bezKomentarov(rel).matchAll(/styles\.([a-zA-Z0-9_]+)/g),
      ]).map((m) => m[1]!),
    );
    const deklarovane = [...MODUL.matchAll(/^\.([a-zA-Z][a-zA-Z0-9_]*)/gm)].map((m) => m[1]!);
    expect(deklarovane.length).toBeGreaterThan(20);
    const mrtve = [...new Set(deklarovane)].filter((meno) => !pouzite.has(meno));
    expect(mrtve, 'tieto triedy modulu nikto nekreslí').toEqual([]);
  });

  it('staré mená zo `zlavy.module.css` sa nevrátili', () => {
    /* Deväť kľúčov, ktoré prepnutý import osirel. Keby sa niektorý vrátil,
       vyzeral by v prehliadači znova ako `class="undefined"`. */
    const STARE = ['nz', 'nzCol', 'nzHead', 'nzTitle', 'nzName', 'nzEmpty', 'tiers', 'winline'];
    const src = KRESLIA.map((rel) => bezKomentarov(rel)).join('\n');
    for (const meno of STARE) {
      expect(src, `styles.${meno} v module nie je`).not.toMatch(
        new RegExp(`styles\\.${meno}(?![a-zA-Z0-9_])`),
      );
    }
  });

  it('vykreslená obrazovka nemá ani jednu prázdnu triedu', () => {
    /* Druhý pás k skupine A. Sám by nestačil (Proxy v testoch chýbajúci kľúč
       zamaskuje), ale zachytí `undefined` vpísané do template stringu. */
    expect(html).not.toContain('class="undefined"');
    expect(html).not.toContain('undefined"');
  });
});

/* ═════════ B. Pás troch krokov je NÁVOD, nie navigácia ═══════════════════ */

describe('B. sprievodca hovorí, kde človek stojí', () => {
  it('pás krokov sa naozaj kreslí a má všetky tri kroky', () => {
    expect(html).toContain('data-testid="new-discount-steps"');
    for (const step of WIZARD_STEPS) {
      expect(html, step.key).toContain(`data-testid="wizard-step-${step.key}"`);
      expect(html, step.key).toContain(step.title);
    }
    // Zoznam, nie rad `<div>`-ov: poradie je obsah a čítačka ho tak prečíta.
    expect(html).toMatch(/<ol[^>]*data-testid="new-discount-steps"/);
  });

  it('krok nesie SLOVO, nie iba farbu (kontrakt V6 §4, bod 3)', () => {
    // Prázdna obrazovka stojí v prvom kroku: „teraz, potom, potom".
    const stavy = wizardStepStates({
      discountedCount: 0,
      planReady: false,
      previewFresh: false,
      created: false,
    });
    expect(stavy).toEqual(['now', 'next', 'next']);
    for (const stav of stavy) expect(html).toContain(WIZARD_STEP_WORD[stav]);
    // A farba je len TRETÍ kanál — číslo a slovo stoja v markupe pred ňou.
    expect(html).toMatch(/data-state="now"/);
  });

  it('na kroky sa nedá klikať — kroky sa nepreskakujú (I3)', () => {
    /*
     * Pás je návod. Keby bol z tlačidiel alebo odkazov, tvrdil by, že sa dá
     * skočiť na potvrdenie bez skúšky naprázdno — a to je presne to, čo I3
     * zakazuje. Rez ide od začiatku `<ol>` po jeho koniec.
     */
    const od = html.indexOf('data-testid="new-discount-steps"');
    const po = html.indexOf('</ol>', od);
    expect(od).toBeGreaterThan(-1);
    expect(po).toBeGreaterThan(od);
    const pas = html.slice(od, po);
    expect(pas).not.toContain('<button');
    expect(pas).not.toContain('<a ');
    expect(pas).not.toContain('href=');
  });

  it('tretí krok je „hotové" až po zaradení do fronty, nie po skúške', () => {
    /* Poistka k B: `previewFresh` NIE JE koniec — dovtedy chýba ručne vpísaný
       počet, teda posledná brzda pred produkčným eshopom (I3). */
    expect(
      wizardStepStates({
        discountedCount: 12,
        planReady: true,
        previewFresh: true,
        created: false,
      }),
    ).toEqual(['done', 'done', 'now']);
    expect(
      wizardStepStates({
        discountedCount: 12,
        planReady: true,
        previewFresh: true,
        created: true,
      }),
    ).toEqual(['done', 'done', 'done']);
  });
});

/* ═════════ C. Priznanie D121 má číslo aj dôvod ═══════════════════════════ */

describe('C. koľko produktov do pásiem nespadlo — číslom (D121, I11)', () => {
  it('veta povie počet, okno, dôvod aj veľkosť zápisu', () => {
    const veta = unknownTierNoteText({
      unknownCount: 195,
      soldWindowDays: 180,
      discountedCount: 5,
      selectedCount: 200,
    });
    expect(veta).not.toBeNull();
    expect(veta!).toContain('195');
    expect(veta!).toContain('180');
    expect(veta!).toContain(UNKNOWN_SOLD_PHRASE);
    // Obe čísla naraz: koľko vypadlo A koľko sa naozaj zapíše.
    expect(veta!).toContain('Zľavu dostane 5 z 200');
  });

  it('nula sa NEVYSVETĽUJE — veta o nule oslabí tú istú vetu, keď platí', () => {
    expect(
      unknownTierNoteText({
        unknownCount: 0,
        soldWindowDays: 180,
        discountedCount: 200,
        selectedCount: 200,
      }),
    ).toBeNull();
  });

  it('jeden produkt sa skloňuje ako jeden, nie ako „produktov"', () => {
    const veta = unknownTierNoteText({
      unknownCount: 1,
      soldWindowDays: 1,
      discountedCount: 0,
      selectedCount: 1,
    });
    expect(veta!).toContain('1 vybraný produkt nemá');
    expect(veta!).toContain('za 1 deň');
  });

  it('formulácia je JEDNA — sprievodca si druhú kópiu nepíše', () => {
    /*
     * Tá istá veta stojí v priznaní nad prúžkom výberu, v priznaní nad
     * tabuľkou pásiem a v prázdnej tabuľke pásiem. Keby si ju niektoré miesto
     * opísalo, po prvej úprave by appka o tom istom fakte hovorila dvakrát
     * inak (kontrakt V6 §4, bod 1). Do 2. 9. 2026 bola v JSX nad prúžkom
     * výberu vpísaná ručne — konštanta existovala a nikto ju nepoužíval.
     *
     * ČO TENTO TEST VEDOME NEKRYJE: `queueBlockedReason()` má pri nulovom
     * zápise VLASTNÚ, dlhšiu vetu („…takže pásmo sa im určiť nedá. Zľava sa
     * z nemeraného predpokladu nezapíše.") a je to zámer — je to dôvod
     * ZÁMKU, nie priznanie počtu, a hovorí navyše to, čo sa NEstane. Stráži
     * ju `test/unit/nova-zlava-potvrdenie.spec.ts` (skupina brány I3).
     */
    const src = bezKomentarov('../../src/components/campaigns/NewDiscount.tsx');
    const kopie = [...src.matchAll(/pásmo sa im určiť nedá, zľavu nedostanú/g)];
    expect(
      kopie,
      'veta je v zdroji vpísaná ručne — má prísť z UNKNOWN_SOLD_PHRASE',
    ).toHaveLength(1);
    expect(src).toMatch(/UNKNOWN_SOLD_PHRASE = 'pásmo sa im určiť nedá, zľavu nedostanú'/);
    // A všetky tri miesta na obrazovke berú konštantu, nie vlastný reťazec.
    expect([...src.matchAll(/UNKNOWN_SOLD_PHRASE/g)].length).toBeGreaterThanOrEqual(4);
  });
});

/* ═════════ D. Drôtovanie: priznanie je na obrazovke, nie len v modeli ════ */

describe('D. priznanie D121 sa nad tabuľku pásiem naozaj drôtuje', () => {
  /*
   * MERIA SA ZDROJ A JE TO VEDOMÉ. Riadky výberu prichádzajú z
   * `/api/catalog/search`, takže `renderToStaticMarkup` vetu nikdy nezastihne
   * — pri statickom vykreslení je `rows === null` a pásma sa ešte nepočítali.
   * Model stráži skupina C, telo odpovede
   * `test/integration/sprievodca-pasma-z-odpovede.spec.ts`, a to, že veta
   * naozaj svieti nad tabuľkou, preklik v prehliadači. Tu sa stráži len to,
   * čo z toho ide prečítať bez siete: že hodnota má NA OBRAZOVKE hostiteľa
   * a nekončí v premennej, ktorú nikto nevykreslí.
   */
  const src = bezKomentarov('../../src/components/campaigns/NewDiscount.tsx');

  it('hodnota sa počíta funkciou a nie druhým výrazom v JSX', () => {
    expect(src).toContain('unknownTierNoteText({');
    expect(src).toMatch(/const unknownTierNote = unknownTierNoteText\(/);
  });

  it('hodnota má hostiteľa a stojí NAD tabuľkou pásiem', () => {
    expect(src).toContain('testId="tiers-unknown-note"');
    expect(src).toContain('{unknownTierNote}');
    // Priznanie pred tabuľkou, nie za ňou: kto vypĺňa percentá, musí vedieť,
    // prečo je súčet pásiem menší než výber, PREDTÝM než ich vypíše.
    expect(src.indexOf('tiers-unknown-note')).toBeLessThan(src.indexOf('columns={tierColumns}'));
  });

  it('prázdna tabuľka pásiem prizná dôvod tou istou vetou', () => {
    const od = src.indexOf('columns={tierColumns}');
    const po = src.indexOf('testId="tiers-table"', od);
    expect(od).toBeGreaterThan(-1);
    expect(po).toBeGreaterThan(od);
    expect(src.slice(od, po)).toContain('UNKNOWN_SOLD_PHRASE');
  });
});
