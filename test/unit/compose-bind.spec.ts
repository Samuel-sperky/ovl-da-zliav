/**
 * Aura Zľavy — test invariantu I5 a pasce R10 nad compose konfiguráciou
 * (BUILD-SPEC §12, D78, D96). Blokujúci v CI.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  checkComposeFiles,
  checkComposeText,
  parseComposeServices,
} from '../../scripts/check-compose-bind';

const repoRoot = join(__dirname, '..', '..');
const composeText = readFileSync(join(repoRoot, 'docker-compose.yml'), 'utf8');

describe('docker-compose.yml — invariant I5 + R10', () => {
  const services = parseComposeServices(composeText);
  const byName = new Map(services.map((s) => [s.name, s]));

  it('obsahuje presne služby ovl-zliav-app, ovl-zliav-db, ovl-zliav-caddy', () => {
    expect(byName.has('ovl-zliav-app')).toBe(true);
    expect(byName.has('ovl-zliav-db')).toBe(true);
    expect(byName.has('ovl-zliav-caddy')).toBe(true);
  });

  it('nepoužíva zakázané mená služieb app/db/web/caddy (R10)', () => {
    for (const forbidden of ['app', 'db', 'web', 'caddy']) {
      expect(byName.has(forbidden)).toBe(false);
    }
  });

  it('ovl-zliav-app nemá ports: (I5)', () => {
    expect(byName.get('ovl-zliav-app')?.ports).toEqual([]);
  });

  it('ovl-zliav-db nemá ports: (I5)', () => {
    expect(byName.get('ovl-zliav-db')?.ports).toEqual([]);
  });

  it('ovl-zliav-caddy publikuje výhradne 127.0.0.1:3050:3050 (I5, D96)', () => {
    expect(byName.get('ovl-zliav-caddy')?.ports).toEqual(['127.0.0.1:3050:3050']);
  });

  it('celý repo check prechádza (vrátane override súborov)', () => {
    const result = checkComposeFiles(repoRoot);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('checkComposeText — detekcia porušení', () => {
  it('zlyhá, keď app dostane ports:', () => {
    const mutated = composeText.replace(
      '    env_file: [./.env]',
      '    ports:\n      - "3000:3000"\n    env_file: [./.env]',
    );
    const result = checkComposeText(mutated);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('ovl-zliav-app'))).toBe(true);
  });

  it('zlyhá, keď db dostane ports: (inline flow zápis)', () => {
    const mutated = composeText.replace(
      '    image: mariadb:11.4',
      '    image: mariadb:11.4\n    ports: ["3306:3306"]',
    );
    const result = checkComposeText(mutated);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('ovl-zliav-db'))).toBe(true);
  });

  it('zlyhá, keď caddy publikuje iný bind než 127.0.0.1:3050:3050', () => {
    const mutated = composeText.replace('127.0.0.1:3050:3050', '0.0.0.0:3050:3050');
    const result = checkComposeText(mutated);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('0.0.0.0:3050:3050'))).toBe(true);
  });

  it('zlyhá, keď caddy pridá druhý publikovaný port', () => {
    const mutated = composeText.replace(
      '      - "127.0.0.1:3050:3050"',
      '      - "127.0.0.1:3050:3050"\n      - "127.0.0.1:8443:8443"',
    );
    const result = checkComposeText(mutated);
    expect(result.ok).toBe(false);
  });

  it('zlyhá na zakázané meno služby (R10)', () => {
    const result = checkComposeText(
      ['services:', '  app:', '    image: x', '  ovl-zliav-caddy:', '    ports:', '      - "127.0.0.1:3050:3050"'].join(
        '\n',
      ),
      { requireAll: false },
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("'app'"))).toBe(true);
  });

  it('zlyhá, keď chýba povinná služba', () => {
    const result = checkComposeText('services:\n  ovl-zliav-app:\n    image: x\n');
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('ovl-zliav-caddy'))).toBe(true);
  });
});
