/**
 * Aura Zľavy — checksum migrácií a konce riadkov (D88, I14).
 *
 * PREČO TENTO SÚBOR VZNIKOL
 * -------------------------
 * `scripts/migrate.ts` odmieta spustiť appku, keď sa checksum už aplikovanej
 * migrácie líši od súboru v repe. Je to správne a je to poistka proti tichej
 * zmene schémy. Lenže na Windows dá `git` pre ten istý commit raz LF a raz
 * CRLF (`.gitattributes` má `text=auto eol=lf`, ale `git status` pri porovnaní
 * normalizuje, takže rozdiel nikde nevidno) — a appka sa po úplne nevinnej
 * operácii s gitom odmietla spustiť. Stalo sa to 12. 8. 2026: produkčná DB
 * mala checksumy spočítané z CRLF, kanonický checkout dal LF, a osem migrácií
 * zrazu „nesedelo".
 *
 * Checksum sa preto počíta z obsahu s normalizovanými koncami riadkov a rozdiel
 * vysvetliteľný LEN koncami riadkov sa uzná.
 *
 * ČO TU STRÁŽIME: že sa tým D88 NEOSLABIL. Skutočná zmena obsahu — čo i len
 * jeden znak, jedna medzera navyše, iné poradie príkazov — musí naďalej
 * skončiť ako `drift`, teda STOP.
 *
 * Vlastník: A0.
 */
import { describe, expect, it } from 'vitest';

import {
  checksumsFor,
  classifyChecksum,
  normalizeEol,
  sha256,
  toCrlf,
} from '../../scripts/migrate';

const SQL = [
  '-- 0001_core.sql',
  'CREATE TABLE users (',
  '  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,',
  "  username VARCHAR(64) NOT NULL DEFAULT 'x'",
  ') ENGINE=InnoDB;',
  '',
].join('\n');

describe('normalizácia koncov riadkov', () => {
  it('CRLF aj osamotené CR sa zrovnajú na LF', () => {
    expect(normalizeEol('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('normalizácia je idempotentná a CRLF prevod je jej opak', () => {
    expect(normalizeEol(normalizeEol(SQL))).toBe(normalizeEol(SQL));
    expect(normalizeEol(toCrlf(SQL))).toBe(normalizeEol(SQL));
  });

  it('obsah bez koncov riadkov normalizácia nemení', () => {
    expect(normalizeEol('bez konca riadku')).toBe('bez konca riadku');
  });
});

describe('checksum je nezávislý od koncov riadkov', () => {
  it('LF a CRLF podoba tej istej migrácie majú ROVNAKÝ checksum', () => {
    expect(checksumsFor(SQL).checksum).toBe(checksumsFor(toCrlf(SQL)).checksum);
  });

  it('varianty vždy pokryjú CRLF podobu — to je tá, ktorú mala produkčná DB', () => {
    expect(checksumsFor(SQL).eolVariants).toContain(sha256(toCrlf(SQL)));
    expect(checksumsFor(toCrlf(SQL)).eolVariants).toContain(sha256(toCrlf(SQL)));
  });
});

describe('classifyChecksum — čo je drift a čo len konce riadkov', () => {
  const file = checksumsFor(SQL);

  it('zhodný checksum je `ok`', () => {
    expect(classifyChecksum(file.checksum, file)).toBe('ok');
  });

  it('checksum z CRLF podoby je `eol_only`, nie drift', () => {
    // Presne prípad z 12. 8.: v DB `a6f0…` (CRLF), v repe `af3c…` (LF).
    expect(classifyChecksum(sha256(toCrlf(SQL)), file)).toBe('eol_only');
  });

  it('pri LF súbore je starý surový checksum zároveň kanonický, teda `ok`', () => {
    // Normalizácia LF obsah nemení, takže DB s LF checksumom (napr. testovacia)
    // po zmene spôsobu počítania nič nepocíti. Preto sa 12. 8. rozišla len
    // produkčná DB — tá jediná mala CRLF.
    expect(sha256(SQL)).toBe(file.checksum);
    expect(classifyChecksum(sha256(SQL), file)).toBe('ok');
  });

  /* ─────────── a teraz to podstatné: D88 musí ďalej hrýzť ─────────── */

  it('JEDEN znak navyše je DRIFT, nie konce riadkov', () => {
    const zmenene = SQL.replace('VARCHAR(64)', 'VARCHAR(65)');
    expect(classifyChecksum(checksumsFor(zmenene).checksum, file)).toBe('drift');
  });

  it('jedna medzera navyše je DRIFT — normalizujú sa LEN konce riadkov', () => {
    const zmenene = SQL.replace('CREATE TABLE users', 'CREATE  TABLE users');
    expect(classifyChecksum(checksumsFor(zmenene).checksum, file)).toBe('drift');
  });

  it('pridaný riadok je DRIFT aj vtedy, keď má správne konce riadkov', () => {
    const zmenene = `${SQL}DROP TABLE users;\n`;
    expect(classifyChecksum(checksumsFor(zmenene).checksum, file)).toBe('drift');
    expect(classifyChecksum(checksumsFor(toCrlf(zmenene)).checksum, file)).toBe('drift');
  });

  it('úplne cudzí checksum je DRIFT', () => {
    expect(classifyChecksum('0'.repeat(64), file)).toBe('drift');
  });

  it('prázdny alebo nezmyselný uložený checksum je DRIFT, nie `ok`', () => {
    expect(classifyChecksum('', file)).toBe('drift');
    expect(classifyChecksum('nezmysel', file)).toBe('drift');
  });
});
