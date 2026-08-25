/**
 * Aura Zľavy — SNÍMKOVAČ: čo sa dá na obrazovke zmerať namiesto pozerania.
 *
 * Funkcia `zbierNalezy()` sa NESPÚŠŤA v Node — Playwright ju pošle do
 * prehliadača a vyhodnotí nad hotovou obrazovkou. Preto nesmie siahať na nič
 * mimo seba: žiadne importy, žiadne premenné zvonku. Všetko, čo potrebuje, si
 * nesie vnútri.
 *
 * MERIA SA ŠESŤ VECÍ, KAŽDÁ Z PRAVIDLA, KTORÉ APPKA UŽ MÁ
 * -------------------------------------------------------
 *  1. Pretekanie — vodorovné posúvanie stránky a text, ktorý si nesadol do
 *     svojho rámu (P4: appka má fungovať na polovici monitora).
 *  2. Únik z rodiča — dieťa, ktoré prečnieva von z karty. Tak vyzerá prekryv.
 *  3. Farba bez slova — uzly `.sig/.flag/.state` bez textu. Tvrdé pravidlo
 *     appky znie „stav nie je nikdy len farba".
 *  4. Nula namiesto pomlčky — hodnota označená ako neznáma, ktorá napriek tomu
 *     ukazuje číslicu (P7: nula je tvrdenie, pomlčka je priznaná medzera).
 *  5. Emodži — na obrazovke nesmie byť ani jedno.
 *  6. Výška nad 1,5 obrazovky (P4).
 *
 * Nálezy sa LEN POPISUJÚ. Snímkovač nič neopravuje.
 *
 * Vlastník: snímkovač (`scripts/snimky.ts`).
 */

/** Jeden nález — čo a kde. */
export interface Nalez {
  readonly druh: string;
  readonly popis: string;
}

/** Beží v prehliadači nad hotovou obrazovkou. Bez importov, bez zatvorenia. */
export function zbierNalezy(): { druh: string; popis: string }[] {
  const nalezy: { druh: string; popis: string }[] = [];
  const VIDITELNE = 6;

  const kde = (el: Element): string => {
    const id = el.getAttribute('data-testid');
    if (id !== null) return `[data-testid="${id}"]`;
    const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/).slice(0, 3).join('.');
    return cls === '' ? el.tagName.toLowerCase() : `${el.tagName.toLowerCase()}.${cls}`;
  };

  const skratka = (text: string, n = 70): string => {
    const t = text.replace(/\s+/g, ' ').trim();
    return t.length <= n ? t : `${t.slice(0, n)}…`;
  };

  /**
   * Zatvorený rozklik (`<details>` bez `open`) má vnútri plne rozložený obsah,
   * ktorý prehliadač len neukazuje. Bez tejto podmienky by snímkovač hlásil
   * „prečnieva o 108 px" pri každom Technickom detaile na obrazovke — a to nie
   * je nález, to je zatvorená zásuvka.
   */
  const vRozkliku = (el: Element): boolean => el.closest('details:not([open])') !== null;

  const vidno = (el: Element): boolean => {
    if (vRozkliku(el)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = window.getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };

  const vsetko = Array.from(document.querySelectorAll('body *'));

  /* ── 1. Vodorovné pretekanie ─────────────────────────────────────────── */

  const sirkaOkna = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > sirkaOkna + 1) {
    nalezy.push({
      druh: 'pretekanie',
      popis: `stránka sa posúva vodorovne: ${document.documentElement.scrollWidth} px pri okne ${sirkaOkna} px`,
    });
  }

  let pretecenych = 0;
  for (const el of vsetko) {
    if (!vidno(el)) continue;
    const s = window.getComputedStyle(el);
    const skryte = s.overflowX === 'hidden' || s.overflowX === 'clip';
    const posuva = s.overflowX === 'auto' || s.overflowX === 'scroll';
    if (posuva) continue; // vlastný rám na posúvanie je zámer, nie chyba
    // Riadkové prvky nemajú `clientWidth` — je vždy 0, takže by každý `<span>`
    // vyzeral ako pretečený. Merať sa dá len na blokovom rámci.
    if (s.display.startsWith('inline') && s.display !== 'inline-block') continue;
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      pretecenych += 1;
      if (pretecenych <= VIDITELNE) {
        nalezy.push({
          druh: 'pretekanie',
          popis: `${kde(el)} — obsah je o ${el.scrollWidth - el.clientWidth} px širší než rám${
            skryte ? ' a je odrezaný' : ''
          }: „${skratka(el.textContent ?? '')}"`,
        });
      }
    }
  }
  if (pretecenych > VIDITELNE) {
    nalezy.push({ druh: 'pretekanie', popis: `…a ďalších ${pretecenych - VIDITELNE} uzlov` });
  }

  /* ── 2. Únik z rodiča ────────────────────────────────────────────────── */

  let unikov = 0;
  for (const el of vsetko) {
    if (!vidno(el)) continue;
    const rodic = el.parentElement;
    if (rodic === null || rodic === document.body) continue;
    const sr = window.getComputedStyle(rodic);
    if (sr.overflow !== 'visible' || sr.position === 'absolute') continue;
    const s = window.getComputedStyle(el);
    if (s.position === 'absolute' || s.position === 'fixed') continue;
    const a = el.getBoundingClientRect();
    const b = rodic.getBoundingClientRect();
    const von = Math.max(a.right - b.right, b.left - a.left, a.bottom - b.bottom);
    if (von > 6 && (el.textContent ?? '').trim() !== '') {
      unikov += 1;
      if (unikov <= VIDITELNE) {
        nalezy.push({
          druh: 'prekryv',
          popis: `${kde(el)} prečnieva o ${Math.round(von)} px von z ${kde(rodic)}: „${skratka(
            el.textContent ?? '',
            50,
          )}"`,
        });
      }
    }
  }
  if (unikov > VIDITELNE) {
    nalezy.push({ druh: 'prekryv', popis: `…a ďalších ${unikov - VIDITELNE} uzlov` });
  }

  /* ── 3. Farba bez značky a slova ─────────────────────────────────────── */

  const stavove = Array.from(document.querySelectorAll('.sig, .flag, .state, .dot, .pill'));
  let bezSlova = 0;
  for (const el of stavove) {
    if (!vidno(el)) continue;
    if (el.getAttribute('aria-hidden') === 'true') continue;
    const text = (el.textContent ?? '').replace(/\s+/g, '').trim();
    if (text === '') {
      bezSlova += 1;
      if (bezSlova <= VIDITELNE) {
        nalezy.push({
          druh: 'farba-bez-slova',
          popis: `${kde(el)} nesie stav bez jediného slova (len farba a značka)`,
        });
      }
    }
  }
  if (bezSlova > VIDITELNE) {
    nalezy.push({ druh: 'farba-bez-slova', popis: `…a ďalších ${bezSlova - VIDITELNE} uzlov` });
  }

  /* ── 4. Nula tam, kde má byť pomlčka ─────────────────────────────────── */

  // Značka nesie SLOVO, nie pravdivostnú hodnotu: `ano` = nevieme, `nie` =
  // vieme. Bez tohto rozlíšenia by každá zmeraná dlaždica vyzerala ako medzera.
  for (const el of Array.from(document.querySelectorAll('[data-unknown="ano"]'))) {
    if (!vidno(el)) continue;
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (/\d/.test(text)) {
      nalezy.push({
        druh: 'nula-namiesto-pomlcky',
        popis: `${kde(el)} je označené ako neznáme, ale ukazuje „${skratka(text, 30)}"`,
      });
    }
  }

  /* ── 5. Emodži ───────────────────────────────────────────────────────── */

  const emodzi = /\p{Extended_Pictographic}/u;
  const chodec = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const najdene = new Set<string>();
  for (let uzol = chodec.nextNode(); uzol !== null; uzol = chodec.nextNode()) {
    const text = uzol.textContent ?? '';
    if (!emodzi.test(text)) continue;
    const rodic = uzol.parentElement;
    if (rodic === null || rodic.tagName === 'STYLE' || rodic.tagName === 'SCRIPT') continue;
    const znaky = Array.from(text).filter((z) => emodzi.test(z)).join(' ');
    najdene.add(`${znaky} v ${kde(rodic)}: „${skratka(text, 40)}"`);
  }
  for (const zaznam of najdene) nalezy.push({ druh: 'emodzi', popis: zaznam });

  /* ── 6. Výška stránky ────────────────────────────────────────────────── */

  const vyska = document.documentElement.scrollHeight;
  const okno = window.innerHeight;
  if (vyska > okno * 1.5) {
    nalezy.push({
      druh: 'vyska-p4',
      popis: `stránka má ${vyska} px, čo je ${(vyska / okno).toFixed(2)}× obrazovka (strop P4 je 1,5×)`,
    });
  }

  return nalezy;
}
