/**
 * Aura Zľavy — OSNOVA NADPISOV.
 *
 * Čítačka obrazovky sa po stránke pohybuje podľa nadpisov. Dva `h1` na jednej
 * stránke jej hovoria, že sú to dva dokumenty; preskočený stupeň (`h1` a hneď
 * `h3`) zase, že medzi nimi niečo chýba.
 *
 * Vzniklo to pri prestavbe Zliav na majster/detail: shell dostal `<h1>Zľavy</h1>`
 * a detail si svoje `<h1>` s názvom zľavy nechal, takže na `/zlavy/[id]` boli
 * zrazu dve. Oko to nevidí — obe sú štýlované inak — a preto to musí vidieť test.
 *
 * Meria sa nad ZDROJOM, nie nad vykresleným markupom: komponenty detailu
 * potrebujú fixtúry z pol tucta modulov a tento test má strážiť jedinú vec,
 * ktorú sa dá prečítať priamo — v ktorom súbore aký stupeň nadpisu stojí.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const KOREN = resolve(process.cwd(), 'src');

/** Všetky `.tsx` pod `src/`, bez ohľadu na hĺbku. */
function subory(dir: string): readonly string[] {
  const out: string[] = [];
  for (const polozka of readdirSync(dir, { withFileTypes: true })) {
    const cesta = join(dir, polozka.name);
    if (polozka.isDirectory()) out.push(...subory(cesta));
    else if (polozka.name.endsWith('.tsx')) out.push(cesta);
  }
  return out;
}

/** Komentáre preč — inak by za nadpis prešla veta, ktorá o ňom len píše. */
function bezKomentarov(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const SUBORY = subory(KOREN);

describe('osnova nadpisov', () => {
  it('meranie vôbec niečo našlo', () => {
    /* Bez tejto poistky by testy nižšie prešli aj nad prázdnym zoznamom. */
    expect(SUBORY.length).toBeGreaterThan(20);
    expect(SUBORY.filter((f) => bezKomentarov(readFileSync(f, 'utf8')).includes('<h1'))).not
      .toHaveLength(0);
  });

  it('h1 kreslí najviac jeden komponent na strom, a nie je ním detail', () => {
    /*
     * Detail zľavy a detail produktu stoja VNÚTRI obrazovky, ktorá `h1` už má.
     * Ich nadpis je preto `h2`. Keby si niektorý `h1` vzal späť, na jednej
     * stránke by boli dva.
     */
    const VNORENE = [
      'campaigns/DiscountDetail.tsx',
      'campaigns/NewDiscountConfirm.tsx',
      'products/ProductDetailPanel.tsx',
      'products/ProductVariants.tsx',
    ];
    for (const rel of VNORENE) {
      const zhody = SUBORY.filter((f) => f.split(sep).join('/').endsWith(rel));
      expect(zhody, `${rel} v strome nie je — zoznam je zastaraný`).toHaveLength(1);
      expect(bezKomentarov(readFileSync(zhody[0]!, 'utf8')), `${rel} kreslí h1`).not.toContain(
        '<h1',
      );
    }
  });

  it('detail zľavy nesie h2 a jeho sekcie h3, teda bez preskočeného stupňa', () => {
    const detail = bezKomentarov(
      readFileSync(join(KOREN, 'components/campaigns/DiscountDetail.tsx'), 'utf8'),
    );
    expect(detail, 'názov zľavy nie je h2').toContain('<h2>{campaign.name}</h2>');
    expect(detail, 'sekcia detailu ostala na h2 vedľa názvu').not.toContain('<h2>Priebeh');
    expect(detail, 'sekcie detailu nie sú h3').toContain('<h3>');
  });

  it('hlavička sekcie vyzerá rovnako na h2 aj h3', () => {
    /*
     * Sekcia na detaile je o stupeň nižšie než na ostatných obrazovkách, ale
     * vyzerať má rovnako. Bez tohto pravidla by `h3` spadol na východiskovú
     * veľkosť prehliadača a detail by sa rozsypal.
     */
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
    expect(css).toContain('.sec-h h3,\n.sec-h h2 {');
  });
});
