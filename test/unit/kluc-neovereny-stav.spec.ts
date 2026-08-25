/**
 * Aura Zľavy — NEOVERENÝ KĽÚČ SA NESMIE HLÁSIŤ AKO PLATNÝ (S2, 24. 8. 2026).
 *
 * ČO SA STALO
 * -----------
 * `keyRowState()` v `settings/KeysSection.tsx` sa na `verifyStatus` nepozeralo
 * vôbec. Všetkých päť vetiev sa rozhodovalo len podľa `secondsLeft`, takže
 * kľúč, ktorý eshop NIKDY nepotvrdil, dostal na obrazovke zelené slovo
 * „vložený a platný" — len preto, že mu ešte neuplynul čas.
 *
 * Na živých dátach to bol kľúč na objednávky s `verify_status = 'unverified'`:
 * appka tvrdila platnosť, ktorú nikdy nezmerala. Je to najhoršia podoba tejto
 * chyby — človek podľa toho slova usúdi, že kľúč funguje, a príčinu hľadá inde.
 *
 * TRI STAVY, KTORÉ SA NESMÚ ZLIAŤ
 * -------------------------------
 *   „neoverený"         — NEVIEME, či funguje (sonda neprebehla alebo neprešla),
 *   „eshop ho neprijal" — VIEME, že nefunguje,
 *   „čoskoro vyprší"    — VIEME, že funguje, ale nie dlho.
 *
 * Tri rôzne poznatky, tri rôzne vety a tri rôzne tóny. Zelená patrí jedinému
 * stavu: eshop kľúč potvrdil A čas mu ešte nedochádza.
 *
 * ČO TENTO SÚBOR MERIA
 * --------------------
 * Vykreslený komponent, nie zdrojový text. Reťazec v `.tsx` by o tom, čo
 * z funkcie naozaj vypadne, nepovedal nič — presne tak by ušla aj mutácia,
 * ktorá `verifyStatus` z rozhodovania zase vyhodí.
 *
 * Vlastník: S2, 24. 8. 2026.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import KeysSection, { keyRowState } from '@/components/settings/KeysSection';
import type { KeyMetaView } from '@/components/settings/api';

import { hostitelia, text } from '../helpers/znacky';

const GLOBALS = readFileSync(
  fileURLToPath(new URL('../../src/app/globals.css', import.meta.url)),
  'utf8',
);

const HODINA = 3600;
const DEN = 24 * HODINA;

const noop = () => {};

/**
 * Kľúč, ktorý eshop potvrdil a ktorému zostáva dvadsaťšesť dní. `last4` je
 * zjavne vymyslené — hodnota kľúča sa do testu nedostane ani v náznaku.
 */
function kluc(over: Partial<KeyMetaView> = {}): KeyMetaView {
  return {
    present: true,
    last4: '0000',
    savedAt: '2026-08-20T09:00:00.000Z',
    expiresAt: '2026-09-19T09:00:00.000Z',
    secondsLeft: 26 * DEN,
    verifyStatus: 'valid',
    ...over,
  };
}

/**
 * Čo na obrazovke NAOZAJ stojí v stĺpci „Stav". Rozreže sa vykreslený markup,
 * nájdu sa hostitelia stavu (`.sig …`) a z každého sa prečíta slovo. Kľúč na
 * zápis je prvý riadok tabuľky, kľúč na objednávky druhý.
 */
function stavyNaObrazovke(ordersKey: KeyMetaView | null): {
  readonly write: string;
  readonly orders: string;
  readonly html: string;
} {
  const html = renderToStaticMarkup(
    createElement(KeysSection, { writeKey: kluc(), ordersKey, onStored: noop }),
  );
  const uzly = hostitelia(html);
  expect(uzly.length, 'tabuľka kľúčov nekreslí práve dva stavy').toBe(2);
  return { write: text(uzly[0]!), orders: text(uzly[1]!), html };
}

/* ═══ A. Neoverený kľúč s ďalekou expiráciou sa nehlási ako platný ═════════ */

describe('neoverený kľúč na obrazovke', () => {
  it('kľúč s ďalekou expiráciou a `unverified` nepovie „platný"', () => {
    const { orders } = stavyNaObrazovke(kluc({ verifyStatus: 'unverified' }));

    expect(orders, 'appka tvrdí platnosť, ktorú nikdy nezmerala').not.toContain('platný');
    expect(orders, 'neoverenie sa musí PRIZNAŤ, nie zamlčať').toContain('neoverený');
  });

  it('rovnako sa chová `verifyStatus: null` — sonda tiež neprebehla', () => {
    const { orders } = stavyNaObrazovke(kluc({ verifyStatus: null }));

    expect(orders).not.toContain('platný');
    expect(orders).toContain('neoverený');
  });

  it('neoverený kľúč nemá zelený tón — zelená patrí len zmeranej platnosti', () => {
    expect(keyRowState(kluc({ verifyStatus: 'unverified' })).tone).not.toBe('good');
    expect(keyRowState(kluc({ verifyStatus: null })).tone).not.toBe('good');
  });
});

/* ═══ B. Tri poznatky = tri vety ═══════════════════════════════════════════ */

describe('tri stavy, ktoré sa nesmú zliať', () => {
  it('„neoverený", „eshop ho neprijal" a „čoskoro vyprší" sú tri rôzne vety', () => {
    const nevieme = keyRowState(kluc({ verifyStatus: 'unverified' }));
    const viemeZeNie = keyRowState(kluc({ verifyStatus: 'invalid' }));
    const viemeAleKratko = keyRowState(kluc({ verifyStatus: 'valid', secondsLeft: 2 * HODINA }));

    expect(new Set([nevieme.label, viemeAleKratko.label, viemeZeNie.label]).size).toBe(3);

    // „nevieme" nie je ani zelené (netvrdíme, že funguje) ani červené
    // (netvrdíme, že ho eshop odmietol) — je to priznanie, nie verdikt.
    expect(nevieme.tone).toBe('idle');
    expect(viemeZeNie.tone).toBe('critical');
    expect(viemeAleKratko.tone).toBe('attention');
  });

  it('`forbidden` sa nezlieva s `invalid` — sú to dve rôzne zistenia', () => {
    expect(keyRowState(kluc({ verifyStatus: 'forbidden' })).label).not.toBe(
      keyRowState(kluc({ verifyStatus: 'invalid' })).label,
    );
  });

  it('kód overenia, ktorý appka nepozná, sa prizná a nepredstiera platnosť', () => {
    // Server je za typom; za behu cezeň dorazí čokoľvek. Zámerne obchádzame typ.
    const cudzi = { ...kluc(), verifyStatus: 'rate_limited' } as unknown as KeyMetaView;
    const stav = keyRowState(cudzi);

    expect(stav.label).not.toContain('platný');
    expect(stav.label).toContain('neznám');
    expect(stav.tone).toBe('attention');
  });
});

/* ═══ C. Zelená má jediného majiteľa ═══════════════════════════════════════ */

describe('kedy smie byť kľúč zelený', () => {
  it('overený kľúč s dostatkom času je jediný zelený stav', () => {
    expect(keyRowState(kluc())).toEqual({ label: 'vložený a platný', tone: 'good' });
  });

  it('žiadny iný stav kľúča zelený nie je', () => {
    const ostatne: readonly (KeyMetaView | null)[] = [
      null,
      kluc({ present: false }),
      kluc({ secondsLeft: 0 }),
      kluc({ secondsLeft: 2 * HODINA }),
      kluc({ verifyStatus: 'unverified' }),
      kluc({ verifyStatus: null }),
      kluc({ verifyStatus: 'invalid' }),
      kluc({ verifyStatus: 'forbidden' }),
      kluc({ secondsLeft: null }),
    ];
    for (const meta of ostatne) {
      expect(keyRowState(meta).tone, `zelená pri ${String(meta?.verifyStatus)}`).not.toBe('good');
    }
  });

  it('neznáma expirácia netvrdí platnosť, ani keď eshop kľúč potvrdil', () => {
    const stav = keyRowState(kluc({ secondsLeft: null, expiresAt: null }));
    expect(stav.label).not.toContain('platný');
    expect(stav.tone).not.toBe('good');
  });
});

/* ═══ D. Povrch: farba + značka + slovo, do 90 znakov, bez vnútorných kódov ═ */

/** Každý stav, ktorý vie táto tabuľka nakresliť. */
const VSETKY_STAVY: readonly (KeyMetaView | null)[] = [
  null,
  kluc({ present: false }),
  kluc(),
  kluc({ secondsLeft: null, expiresAt: null }),
  kluc({ secondsLeft: 0 }),
  kluc({ secondsLeft: 2 * HODINA }),
  kluc({ verifyStatus: 'unverified' }),
  kluc({ verifyStatus: null }),
  kluc({ verifyStatus: 'unverified', secondsLeft: 2 * HODINA }),
  kluc({ verifyStatus: 'invalid' }),
  kluc({ verifyStatus: 'forbidden' }),
];

describe('povrch stavu kľúča', () => {
  it('ani jeden stav nepresiahne 90 znakov (P2)', () => {
    for (const meta of VSETKY_STAVY) {
      const { label } = keyRowState(meta);
      expect(label.length, `pridlhé: „${label}"`).toBeLessThanOrEqual(90);
    }
  });

  it('na povrch sa nedostane vnútorný kód (K10)', () => {
    const ZAKAZANE = [
      'unverified',
      'verifyStatus',
      'verify_status',
      'forbidden',
      'invalid',
      'ip_banned',
      '403',
      'null',
      'undefined',
    ];
    for (const meta of VSETKY_STAVY) {
      const { label } = keyRowState(meta);
      for (const kod of ZAKAZANE) {
        expect(label.toLowerCase(), `kód „${kod}" na povrchu: „${label}"`).not.toContain(
          kod.toLowerCase(),
        );
      }
    }
  });

  it('žiadny stav netvrdí príčinu (P8) — appka vie ČO, nie PREČO', () => {
    for (const meta of VSETKY_STAVY) {
      const { label } = keyRowState(meta);
      expect(label.toLowerCase(), `príčina v stave: „${label}"`).not.toMatch(
        /\bpreto(že)?\b|\blebo\b|\bkvôli\b|\bzapríčin/,
      );
    }
  });

  it('každý stav je farba + značka + slovo, nikdy iba farba', () => {
    for (const meta of VSETKY_STAVY) {
      const { html } = stavyNaObrazovke(meta);
      const uzol = hostitelia(html)[1]!;

      // FARBA — trieda nesie tón a ten má v `globals.css` naozaj farbu.
      const ton = uzol.triedy.filter((t) => t !== 'sig');
      expect(ton.length, `stav bez tónu: ${uzol.triedy.join(' ')}`).toBe(1);
      expect(
        new RegExp(`\\.sig\\.${ton[0]!}\\s*\\{[^}]*color:\\s*var\\(--`, 'm').test(GLOBALS),
        `tón ${ton[0]} nemá v globals.css farbu`,
      ).toBe(true);

      // ZNAČKA — práve jedna, a stojí PRED slovom.
      expect((uzol.vnutro.match(/<svg\b[^>]*class="[^"]*\bovl-ic\b/g) ?? []).length).toBe(1);
      expect(/^\s*<svg\b[^>]*class="[^"]*\bovl-ic\b/.test(uzol.vnutro)).toBe(true);

      // SLOVO — po odstránení značky zostane text.
      expect(text(uzol).length, 'stav bez slova').toBeGreaterThanOrEqual(4);
    }
  });

  it('stav kľúča je pomenovaný uzol — inak ho žiadny test neuvidí', () => {
    const { html } = stavyNaObrazovke(kluc({ verifyStatus: 'unverified' }));
    const mena = hostitelia(html).map((u) => u.atributy['data-testid'] ?? null);
    expect(mena).toEqual(['key-row-write-state', 'key-row-orders-state']);
  });
});

/* ═══ E. Vety zo servera sa naozaj dostanú na obrazovku ════════════════════ */

/**
 * Slovo v tabuľke hovorí ČO, veta hovorí, čo s tým. Pri zablokovanej adrese je
 * `verifyNote` jediné miesto, kde sa človek dozvie, že nový kľúč nepomôže —
 * takže keby route vetu poslala a obrazovka ju zahodila, celá oprava z 24. 8.
 * by skončila v odpovedi API a na obrazovku by sa nedostala.
 */
describe('vety z `/api/key` na obrazovke', () => {
  function markupFor(over: Partial<KeyMetaView>): string {
    return renderToStaticMarkup(
      createElement(KeysSection, {
        writeKey: kluc(over),
        ordersKey: kluc(over),
        onStored: noop,
      }),
    );
  }

  it('`verifyNote` sa vykreslí pri riadku, ktorého sa týka', () => {
    const veta = 'Kľúč je uložený, ale overiť sa ho nedalo: shop odmieta našu IP adresu.';
    const markup = markupFor({ verifyStatus: 'unverified', verifyNote: veta });

    expect(markup).toContain('data-testid="key-row-write-verify-note"');
    expect(markup).toContain('data-testid="key-row-orders-verify-note"');
    expect(markup).toContain('shop odmieta našu IP adresu');
  });

  it('overený kľúč vetu o neoverení nekreslí', () => {
    expect(markupFor({ verifyStatus: 'valid', verifyNote: null })).not.toContain('verify-note');
  });

  it('`sameKeyNote` stojí RAZ, nie v každom riadku', () => {
    const veta = 'Oba kľúče končia rovnako, takže to vyzerá na ten istý kľúč.';
    const markup = markupFor({ sameKeyNote: veta });

    // Raz — je to tvrdenie o dvojici kľúčov, nie o jednom.
    expect((markup.match(/vyzerá na ten istý kľúč/g) ?? []).length).toBe(1);
    expect(markup).toContain('data-testid="keys-same-key-note"');
  });

  it('bez tej vety sa nekreslí prázdna poznámka', () => {
    expect(markupFor({ sameKeyNote: null })).not.toContain('keys-same-key-note');
  });
});
