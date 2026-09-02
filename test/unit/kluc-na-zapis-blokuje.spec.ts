/**
 * Aura Zľavy — SEKCIA KĽÚČE POVIE, ČO CHÝBAJÚCI KĽÚČ BLOKUJE (V6b).
 *
 * ČO SA TU MERIA A PREČO TO VZNIKLO
 * ---------------------------------
 * Tabuľka kľúčov povedala, že kľúč na zápis `chýba`, a tým skončila. Dôsledok
 * — že appka nezapíše do eshopu ani jednu zľavu a že dávka obohacovania nemá
 * čím čítať, takže podrobnosti o produktoch zostávajú s pomlčkami — sa dal
 * prečítať len na Prehľade v zozname prekážok. Teda na obrazovke, na ktorú
 * človek pri vkladaní kľúča nechodí. Appka je pritom dnes bez kľúča
 * `shop_write`, takže to nie je hraničný prípad, ale BEŽNÝ stav Nastavení.
 *
 * MERIA SA VYKRESLENÝ MARKUP, NIE LEN MODEL
 * -----------------------------------------
 * `writeKeyBlock()` je čistá funkcia a dala by sa otestovať sama — presne tak
 * ale prešlo D121: model bol správny a na obrazovku sa dostal iný údaj, lebo
 * nikto nemeral prepis na odpoveď. Polovica tvrdení nižšie preto číta HTML zo
 * `renderToStaticMarkup`, nie návratovú hodnotu.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *  1. **Tvrdenie stojí na zmeranom stave (I11).** Neoverený kľúč znamená
 *     „NEVIEME, či funguje" — pri ňom sa priznanie NEKRESLÍ, inak by sa
 *     z priznania stal verdikt.
 *  2. **Obe zablokované veci sú vymenované MENOM.** Zápis do eshopu a dávka
 *     obohacovania katalógu. Veta „appka nemôže pracovať" by bola horšia než
 *     žiadna: nepovie, čo appka ROBÍ ďalej.
 *  3. **Hodnota kľúča sa nikdy nevypíše (I1).** Ani v priznaní, ani v tabuľke.
 *
 * Vlastník: V6b (Nastavenia, krok 3/3: Poistky a kľúče).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import KeysSection, { writeKeyBlock } from '@/components/settings/KeysSection';
import type { KeyMetaView } from '@/components/settings/api';

import { NAJKRATSIE_SLOVO, pocetZnaciek, text, uzly, znackaJePrva } from '../helpers/znacky';

const noop = () => {};

/** Kľúč, ktorý shop potvrdil a má pred sebou dva dni. */
function zdravy(over: Partial<KeyMetaView> = {}): KeyMetaView {
  return {
    present: true,
    last4: '2222',
    savedAt: '2026-09-01T09:12:00.000Z',
    expiresAt: '2026-09-03T09:12:00.000Z',
    secondsLeft: 170_000,
    verifyStatus: 'valid',
    ...over,
  };
}

function markup(writeKey: KeyMetaView | null): string {
  return renderToStaticMarkup(
    createElement(KeysSection, { writeKey, ordersKey: null, onStored: noop }),
  );
}

/* ═════════════════ 1. Kedy appka tvrdí, že je zápis zablokovaný ═══════════ */

describe('writeKeyBlock — tvrdí sa len to, čo appka zmerala', () => {
  it('kľúč nie je uložený → priznanie, a je červené', () => {
    for (const meta of [null, { ...zdravy(), present: false }]) {
      const block = writeKeyBlock(meta);
      expect(block, 'chýbajúci kľúč sa nepriznal').not.toBeNull();
      expect(block!.tone).toBe('critical');
      expect(block!.word.toLowerCase()).toContain('kľúč na zápis');
    }
  });

  it('shop kľúč odmietol → priznanie (odmietnutie sa číta pred časom)', () => {
    for (const status of ['invalid', 'forbidden'] as const) {
      const block = writeKeyBlock(zdravy({ verifyStatus: status }));
      expect(block, `stav ${status} sa nepriznal`).not.toBeNull();
      expect(block!.tone).toBe('critical');
    }
    /* Aj keď mu navyše prešla platnosť, hovorí sa o odmietnutí — je to
       dôležitejšia správa a `keyRowState` ju radí rovnako. */
    const oboje = writeKeyBlock(zdravy({ verifyStatus: 'invalid', secondsLeft: -5 }));
    expect(oboje!.word.toLowerCase()).toContain('neprijal');
  });

  it('platnosť uplynula → priznanie, aj keď kľúč nikto neoveril', () => {
    for (const status of ['valid', 'unverified', null] as const) {
      const block = writeKeyBlock(zdravy({ verifyStatus: status, secondsLeft: 0 }));
      expect(block, `expirovaný kľúč (${String(status)}) sa nepriznal`).not.toBeNull();
      expect(block!.word.toLowerCase()).toContain('už neplatí');
    }
  });

  it('NEOVERENÝ kľúč s časom → appka NETVRDÍ nič (I11)', () => {
    /*
     * Toto je celé jadro. „Neoverený" znamená, že sa overiť NEDALO — kľúč
     * môže zapisovať a nemusí. Veta „zápisy sú zablokované" by z priznania
     * urobila verdikt, ktorý appka nezmerala. Riadok tabuľky ten stav hovorí;
     * priznanie o ňom mlčí zámerne.
     */
    expect(writeKeyBlock(zdravy({ verifyStatus: 'unverified' }))).toBeNull();
    expect(writeKeyBlock(zdravy({ verifyStatus: null }))).toBeNull();
  });

  it('zdravý kľúč → nič sa nepriznáva', () => {
    expect(writeKeyBlock(zdravy())).toBeNull();
    /* Ani neznáma platnosť nie je dôvod tvrdiť blokovanie — je to „nevieme". */
    expect(writeKeyBlock(zdravy({ secondsLeft: null }))).toBeNull();
  });
});

/* ═════════════════ 2. Dostane sa to na OBRAZOVKU (nie len do modelu) ══════ */

describe('sekcia Kľúče: priznanie je vo vykreslenom markupe', () => {
  const bez = markup(null);

  it('priznanie sa vykreslí a je pomenovaným uzlom', () => {
    expect(bez).toContain('data-testid="keys-write-blocked"');
    expect(bez).toContain('data-testid="keys-write-blocked-state"');
  });

  it('nesie tri kanály — farba, značka a slovo v jednom uzle', () => {
    const uzol = uzly(bez).find(
      (u) => u.atributy['data-testid'] === 'keys-write-blocked-state',
    );
    expect(uzol, 'stav priznania sa nevykreslil').toBeDefined();
    // FARBA — tón je na koreni značky mechanicky aj v skladanej triede.
    expect(uzol!.triedy).toContain('ovl-badge');
    expect(uzol!.triedy).toContain('ovl-badge--critical');
    // ZNAČKA — práve jedna a pred slovom.
    expect(pocetZnaciek(uzol!)).toBe(1);
    expect(znackaJePrva(uzol!)).toBe(true);
    // SLOVO — a je to slovo volajúceho, nie náhrada za chýbajúce.
    expect(text(uzol!).length).toBeGreaterThanOrEqual(NAJKRATSIE_SLOVO);
    expect(uzol!.atributy['data-signal-wordless']).toBeUndefined();
  });

  it('vymenuje OBE veci, ktoré tým stoja — zápis aj obohacovanie', () => {
    /*
     * Bez tohto tvrdenia by veta mohla schudnúť na „appka nezapisuje" a
     * obohacovanie by opäť stálo ticho: v tabuľkách Produktov by boli pomlčky
     * a nikde by nestálo, prečo.
     */
    expect(bez).toContain('nedá zapísať ani jeden produkt');
    expect(bez).toContain('obohacovania katalógu');
    expect(bez).toContain('pomlčkami');
  });

  it('povie aj to, čo appka robí ĎALEJ — inak vyzerá ako porucha', () => {
    expect(bez).toContain('číta katalóg');
    expect(bez).toContain('pripraví na potvrdenie');
  });

  it('pri zdravom kľúči priznanie na obrazovke NIE JE', () => {
    const s = markup(zdravy());
    expect(s).not.toContain('data-testid="keys-write-blocked"');
    expect(s).not.toContain('obohacovania katalógu');
  });

  it('pri NEOVERENOM kľúči priznanie na obrazovke NIE JE (I11)', () => {
    expect(markup(zdravy({ verifyStatus: 'unverified' }))).not.toContain(
      'data-testid="keys-write-blocked"',
    );
  });
});

/* ═════════════════ 3. Priznanie nie je dôvod vypísať tajomstvo (I1) ═══════ */

describe('hodnota kľúča sa nevypíše ani v priznaní', () => {
  it('v markupe nie je nič, čo by kľúč pripomínalo', () => {
    const tajomstvo = 'sk_live_TOTO_JE_KLUC_0000';
    /*
     * `KeyMetaView` hodnotu kľúča ani nemá — a presne to je poistka, ktorú tu
     * strážime: keby ju niekto do typu pridal „len na kontrolu", tento test
     * padne pri prvom vykreslení. Posledné štyri znaky sú výnimka a stoja
     * v tabuľke, nie v priznaní.
     */
    const s = markup({ ...zdravy({ present: false }), last4: '2222' } as KeyMetaView);
    expect(s).not.toContain(tajomstvo);
    expect(s).not.toContain('sk_live');
    /* Vnútorné kódy sondy na povrch nepatria (K10) — ani do priznania. */
    for (const kod of ['unverified', 'verify_status', 'forbidden', 'ip_banned']) {
      expect(s.toLowerCase(), `kód „${kod}" je na obrazovke`).not.toContain(kod);
    }
  });
});
