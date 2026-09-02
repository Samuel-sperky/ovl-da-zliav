/**
 * Aura Zľavy — AUDIT STOPA V DETAILE ZĽAVY (V6b, D139, §4 kontraktu V6).
 *
 * Do V6b kreslil rozklik „História zápisov" bezhlavičkovú `<table>` s dvoma
 * bunkami: čas a veta. Appka pritom o každom riadku vie päť vecí a tri z nich
 * na obrazovku nepustila — KTO zápis urobil, AKO dopadol a KTORÝ kus sa ho
 * týkal. Prevod na `ui/Table` mal byť „krajšie, nie tichšie" (§4), takže
 * tieto tvrdenia držia práve to, čo pri takom prevode ide stratiť:
 *
 *  A. **Stĺpce sú tie isté ako v Histórii** (Kedy · Čo sa stalo · Kto).
 *     Dve histórie v jednej appke s inými stĺpcami znamenajú, že si človek
 *     prenesie návyk z jednej do druhej a prečíta niečo iné, než tam je.
 *  B. **Veta a príznak zlyhania sú TIE ISTÉ FUNKCIE** (`auditRowText()`,
 *     `showsFailureFlag()`), nie ich druhá kópia. Test ich preto porovnáva
 *     proti sebe, nie proti napísanému reťazcu.
 *  C. **Zlyhanie nesie tri kanály** — farbu, značku a SLOVO. Tlmený riadok
 *     (`rowMeta.muted`) je štvrtý, podporný; sám by bol iba farba.
 *  D. **Produkt sa menuje, keď sa menovať DÁ, a inak sa MLČÍ** (D116, K6).
 *     Vymyslené číslo na povrchu je horšie než ticho — a chýbajúca referencia
 *     je „zatiaľ nevieme", nie „produkt ju nemá" (D118, I11).
 *  E. **Prázdna história je odpoveď, nie prázdny rám.**
 *
 * Renderuje sa `renderToStaticMarkup` — bez prehliadača, bez DB, bez siete.
 * Preto má `AuditTrailTable` vlastný export: detail si dáta ťahá v efekte
 * a ten sa pri serverovom vykreslení nespustí, takže tvrdenia o riadkoch by
 * inak merali stav „Načítavam…".
 *
 * Vlastník: V6b, oblasť Zľavy — krok 3 (os a história).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { auditRowText, showsFailureFlag } from '@/components/audit/AuditTable';
import { auditActorLabel } from '@/components/audit/api';
import { AUDIT_TRAIL_SHOWN, AuditTrailTable, auditShown } from '@/components/campaigns/DiscountDetail';
import type { AuditRowView, DiscountItemView } from '@/components/campaigns/zlavy-api';

function row(patch: Partial<AuditRowView> = {}): AuditRowView {
  return {
    id: 1,
    ts: '2026-08-24T13:46:00.000Z',
    actor: 'scheduler',
    eventType: 'write_ok',
    ok: true,
    productId: 201,
    httpStatus: 200,
    message: 'Fronta zapísala 20 produktov',
    ...patch,
  };
}

function item(patch: Partial<DiscountItemView> = {}): DiscountItemView {
  return {
    id: 11,
    productId: 201,
    position: 1,
    status: 'ok',
    nameAtWrite: 'Náramok z chirurgickej ocele',
    reference: 'NR-0041',
    priceAtPreview: '19.90',
    priceAtWrite: '15.92',
    priceMismatch: false,
    hasAttributes: false,
    attemptCount: 1,
    httpStatus: 200,
    errorCode: null,
    errorMessage: null,
    finishedAt: '2026-08-24T13:46:00.000Z',
    ...patch,
  };
}

const html = (rows: readonly AuditRowView[], items: readonly DiscountItemView[] = [item()]) =>
  renderToStaticMarkup(createElement(AuditTrailTable, { rows, items }));

/* ═════════ A. Stĺpce sú tie isté ako v Histórii ═══════════════════════════ */

describe('A. história zľavy má tie isté stĺpce ako História v Nastaveniach', () => {
  it('Kedy · Čo sa stalo · Kto — a nič naviac', () => {
    const markup = html([row()]);
    for (const meno of ['Kedy', 'Čo sa stalo', 'Kto']) {
      expect(markup, `stĺpec ${meno} chýba`).toContain(meno);
    }
    /* Tri stĺpce, teda tri `<th>`. Štvrtý by znamenal, že sa história zľavy
       od Histórie odtrhla. */
    expect((markup.match(/<th\b/g) ?? []).length).toBe(3);
  });

  it('tabuľka má meno pre čítačku — `caption` nie je voliteľný', () => {
    expect(html([row()])).toContain('História zápisov tejto zľavy');
  });

  it('kreslí sa najviac osem posledných záznamov a počet je z jedného miesta', () => {
    const rows = Array.from({ length: 12 }, (_, i) => row({ id: i + 1 }));
    expect(auditShown(rows)).toHaveLength(AUDIT_TRAIL_SHOWN);
    const markup = html(rows);
    expect(markup).toContain('data-testid="detail-audit-row-1"');
    expect(markup).toContain(`data-testid="detail-audit-row-${AUDIT_TRAIL_SHOWN}"`);
    expect(markup).not.toContain(`data-testid="detail-audit-row-${AUDIT_TRAIL_SHOWN + 1}"`);
  });
});

/* ═════════ B. Jedno pravidlo, nie dve kópie ═══════════════════════════════ */

describe('B. veta o udalosti sa neopisuje druhýkrát', () => {
  it('bez vety zo servera sa kreslí PRELOŽENÝ kód, nikdy surový', () => {
    const bezVety = row({ message: null });
    const markup = html([bezVety]);
    /* Porovnáva sa proti tej istej funkcii, akú používa História — keby si
       detail napísal vlastné pravidlo, tieto dve by sa rozišli a test by to
       zachytil aj vtedy, keď obe „vyzerajú správne". */
    expect(markup).toContain(auditRowText(bezVety));
    expect(markup).not.toContain('write_ok');
  });

  it('veta zo servera vyhráva nad prekladom kódu', () => {
    expect(html([row()])).toContain('Fronta zapísala 20 produktov');
  });

  it('rolu píše `auditActorLabel()`, takže neznámu rolu appka nevypíše surovú', () => {
    expect(html([row({ actor: 'user' })])).toContain(auditActorLabel('user'));
    expect(html([row({ actor: 'nejaka-nova-rola' })])).toContain('appka');
    expect(html([row({ actor: 'nejaka-nova-rola' })])).not.toContain('nejaka-nova-rola');
  });
});

/* ═════════ C. Zlyhanie má tri kanály ═════════════════════════════════════ */

describe('C. „nepodarilo sa" nesie farbu, značku AJ slovo', () => {
  const failed = row({ id: 5, ok: false, message: 'Eshop odmietol zápis', productId: null });

  it('slovo stojí v bunke, nie iba v pozadí riadku', () => {
    expect(showsFailureFlag(failed)).toBe(true);
    const markup = html([failed]);
    expect(markup).toContain('data-testid="detail-audit-failed-5"');
    expect(markup).toContain('nepodarilo sa');
    /* `.flag` nesie farbu a v ňom stojí značka — kanály dva a tri. */
    expect(markup).toContain('class="flag"');
  });

  it('tlmenie riadku je len podpora, nie nosič stavu', () => {
    /* Riadok bez zlyhania nie je tlmený, takže tlmenie naozaj niečo znamená —
       a zároveň nie je JEDINÉ, čo o zlyhaní hovorí (bod C hlavičky). */
    const okMarkup = html([row({ id: 7 })]);
    const failMarkup = html([failed]);
    expect(failMarkup).not.toBe(okMarkup);
    expect(okMarkup).not.toContain('nepodarilo sa');
  });

  it('príznak sa NEZDVOJUJE, keď výsledok hovorí už samotná veta', () => {
    /* Preklad kódu („produkt sa nepodarilo zlacniť") výsledok obsahuje sám;
       druhý príznak vedľa by bol ten istý údaj dvakrát. */
    const bezVety = row({ id: 8, ok: false, message: null });
    expect(showsFailureFlag(bezVety)).toBe(false);
    expect(html([bezVety])).not.toContain('data-testid="detail-audit-failed-8"');
  });
});

/* ═════════ D. Pomenovanie produktu (D116, D118, K6) ══════════════════════ */

describe('D. o produkte sa hovorí referenciou a názvom, alebo sa mlčí', () => {
  it('produkt z načítaných položiek sa pomenuje „referencia · názov"', () => {
    const markup = html([row()]);
    expect(markup).toContain('data-testid="detail-audit-product-1"');
    expect(markup).toContain('NR-0041 · Náramok z chirurgickej ocele');
  });

  it('menuje sa názvom PRI ZÁPISE — história sa neprepisuje (I4)', () => {
    /* Položka nesie `nameAtWrite`; keby sa dosadzoval dnešný názov z katalógu,
       riadok histórie by po premenovaní produktu tvrdil niečo iné než vtedy,
       keď sa zapisovalo. */
    const markup = html([row()], [item({ nameAtWrite: 'Náramok — starý názov' })]);
    expect(markup).toContain('Náramok — starý názov');
  });

  it('chýbajúca referencia je „zatiaľ nevieme", nie „produkt ju nemá" (D118)', () => {
    const markup = html([row()], [item({ reference: null })]);
    expect(markup).toContain('kód produktu zatiaľ nevieme');
    /* Názov zostáva, takže riadok sa dá identifikovať aj bez referencie. */
    expect(markup).toContain('Náramok z chirurgickej ocele');
  });

  it('produkt, ktorý appka nemá načítaný, sa NEPOMENUJE ani číslom (K6)', () => {
    const markup = html([row({ productId: 999 })], [item()]);
    expect(markup).not.toContain('data-testid="detail-audit-product-1"');
    /* `#id` patrí do technického detailu, nie na povrch histórie. */
    expect(markup).not.toContain('#999');
    expect(markup).not.toContain('>999<');
  });

  it('udalosť bez produktu o produkte nič nepíše', () => {
    const markup = html([row({ productId: null })]);
    expect(markup).not.toContain('data-testid="detail-audit-product-1"');
  });
});

/* ═════════ E. Prázdna história ════════════════════════════════════════════ */

describe('E. prázdna história je odpoveď, nie prázdny rám', () => {
  it('kreslí sa veta o tom, že sa ešte nezapisovalo', () => {
    const markup = html([]);
    expect(markup).toContain('data-testid="detail-audit-empty"');
    expect(markup).toContain('Zatiaľ žiadny záznam');
    expect(markup).toContain('nezapisovalo');
  });

  it('prázdno NIE JE pomlčka v riadku', () => {
    /* Do V6b tu stál riadok „— | zatiaľ žiadny záznam", teda pomlčka v mieste
       času. Pomlčka je v tejto appke priznanie nevedomosti (I11), a „do zľavy
       sa ešte nezapisovalo" je meraný fakt — dve rôzne veci. */
    expect(html([])).not.toContain('data-value="unknown"');
  });
});
