/**
 * Aura Zľavy — test `clientIp()` z `defineRoute()` pipeline (S1).
 *
 * `X-Forwarded-For` je zoznam „client, proxy1, proxy2, …“: ĽAVÉ tokeny si
 * klient môže podvrhnúť sám (rotáciou obíde rate limit a zašpiní IP v audite).
 * Dôveryhodný je len PRAVÝ (posledný) token — ten pridal náš Caddy.
 */
import { describe, expect, it } from 'vitest';

import { clientIp } from '@/lib/http/define-route';

function req(headers: Record<string, string>): Request {
  return new Request('https://zlavy.local/api/x', { headers });
}

describe('clientIp — dôveruje len pravému tokenu XFF (S1)', () => {
  it('podvrhnutý ľavý token sa ignoruje, berie sa posledný (od Caddy)', () => {
    expect(clientIp(req({ 'X-Forwarded-For': '9.9.9.9, 127.0.0.1' }))).toBe('127.0.0.1');
  });

  it('viacnásobná rotácia ľavých tokenov nemení výsledok', () => {
    expect(clientIp(req({ 'X-Forwarded-For': '1.1.1.1, 2.2.2.2, 10.0.0.7' }))).toBe('10.0.0.7');
  });

  it('jediný token (bežný prípad za Caddy) sa vráti tak, ako je', () => {
    expect(clientIp(req({ 'X-Forwarded-For': '203.0.113.5' }))).toBe('203.0.113.5');
  });

  it('prázdny posledný token → fallback na X-Real-IP', () => {
    expect(clientIp(req({ 'X-Forwarded-For': '9.9.9.9, ', 'X-Real-IP': '10.0.0.9' }))).toBe(
      '10.0.0.9',
    );
  });

  it('bez hlavičiek → "unknown", nikdy nie prázdny string', () => {
    expect(clientIp(req({}))).toBe('unknown');
  });
});
