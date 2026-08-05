/**
 * Aura Zľavy — testy preview tokenu (A1, BUILD-SPEC §7, O2, I3).
 *
 * Preview token je nosič invariantu I3: bez platného, jednorazového tokenu so
 * zhodným `payloadHash` neexistuje cesta k ostrému zápisu. Testy preto pokrývajú
 * všetky spôsoby, ako sa token dá odmietnuť:
 *  - pozmenený podpis / iný secret / iný algoritmus,
 *  - expirácia po 15 minútach,
 *  - podvrhnutý `payloadHash` v claimoch,
 *  - token vydaný pre inú sadu parametrov,
 *  - druhé použitie toho istého tokenu (replay).
 */
import { createHash, randomBytes } from 'node:crypto';

import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import type { PreviewTokenClaims } from '@/contracts';
import {
  PREVIEW_MAX_PRODUCTS,
  PREVIEW_TOKEN_AUDIENCE,
  PREVIEW_TOKEN_ISSUER,
  PREVIEW_TOKEN_TTL_SECONDS,
  PreviewTokenError,
  computePayloadHash,
  createMemoryPreviewTokenStore,
  createPreviewTokenService,
} from '@/lib/crypto/preview-token';

const SECRET = randomBytes(32);

type IssueInput = Omit<PreviewTokenClaims, 'jti' | 'payloadHash'>;

const BASE: IssueInput = {
  sub: 1,
  kind: 'new',
  productIds: [42, 7, 15],
  percent: 20,
  from: '2026-09-01',
  to: '2026-09-30',
  pricesAtPreview: { '7': '19.90', '15': '5.00', '42': '129.00' },
};

const expectedOf = (input: IssueInput = BASE) => ({
  kind: input.kind,
  productIds: input.productIds,
  percent: input.percent,
  from: input.from,
  to: input.to,
});

function makeService(nowRef?: { ms: number }) {
  return createPreviewTokenService({
    secret: SECRET,
    now: nowRef ? () => new Date(nowRef.ms) : undefined,
  });
}

/* ═════════════════════════════ payloadHash ════════════════════════════════ */

describe('preview-token: kanonický payloadHash (§7)', () => {
  it('nezávisí od poradia productIds', () => {
    const a = computePayloadHash({ ...expectedOf(), productIds: [7, 15, 42] });
    const b = computePayloadHash({ ...expectedOf(), productIds: [42, 15, 7] });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('je SHA-256 kanonického JSON { from, kind, percent, productIds, to }', () => {
    const canonical = JSON.stringify({
      from: '2026-09-01',
      kind: 'new',
      percent: 20,
      productIds: [7, 15, 42],
      to: '2026-09-30',
    });
    expect(computePayloadHash(expectedOf())).toBe(
      createHash('sha256').update(canonical, 'utf8').digest('hex'),
    );
  });

  it('zmena ktoréhokoľvek parametra zmení hash', () => {
    const base = computePayloadHash(expectedOf());
    expect(computePayloadHash({ ...expectedOf(), percent: 21 })).not.toBe(base);
    expect(computePayloadHash({ ...expectedOf(), from: '2026-09-02' })).not.toBe(base);
    expect(computePayloadHash({ ...expectedOf(), to: '2026-10-01' })).not.toBe(base);
    expect(computePayloadHash({ ...expectedOf(), kind: 'extend' })).not.toBe(base);
    expect(computePayloadHash({ ...expectedOf(), productIds: [7, 15] })).not.toBe(base);
  });

  it('fail-closed odmietne nezmyselnú sadu (I2, I9)', () => {
    expect(() => computePayloadHash({ ...expectedOf(), percent: 0 })).toThrow(PreviewTokenError);
    expect(() => computePayloadHash({ ...expectedOf(), percent: 31 })).toThrow(PreviewTokenError);
    expect(() => computePayloadHash({ ...expectedOf(), percent: 10.5 })).toThrow(PreviewTokenError);
    expect(() => computePayloadHash({ ...expectedOf(), productIds: [] })).toThrow(PreviewTokenError);
    expect(() =>
      computePayloadHash({
        ...expectedOf(),
        productIds: Array.from({ length: PREVIEW_MAX_PRODUCTS + 1 }, (_, i) => i + 1),
      }),
    ).toThrow(PreviewTokenError);
    expect(() => computePayloadHash({ ...expectedOf(), productIds: [1, 1, 2] })).toThrow(
      PreviewTokenError,
    );
    expect(() => computePayloadHash({ ...expectedOf(), from: '2026-13-01' })).toThrow(
      PreviewTokenError,
    );
    expect(() => computePayloadHash({ ...expectedOf(), from: '01.09.2026' })).toThrow(
      PreviewTokenError,
    );
    expect(() =>
      computePayloadHash({ ...expectedOf(), from: '2026-09-30', to: '2026-09-01' }),
    ).toThrow(PreviewTokenError);
  });
});

/* ══════════════════════════════ issue/verify ══════════════════════════════ */

describe('preview-token: vydanie a overenie', () => {
  it('roundtrip vráti claims so sadou, cenami a hashom', async () => {
    const service = makeService();
    const { token, jti, payloadHash } = await service.issue(BASE);

    expect(token.split('.')).toHaveLength(3);
    expect(payloadHash).toBe(computePayloadHash(expectedOf()));

    const claims = await service.verify(token, expectedOf());
    expect(claims.jti).toBe(jti);
    expect(claims.sub).toBe(1);
    expect(claims.kind).toBe('new');
    expect(claims.productIds).toEqual([7, 15, 42]);
    expect(claims.percent).toBe(20);
    expect(claims.pricesAtPreview).toEqual(BASE.pricesAtPreview);
    expect(claims.payloadHash).toBe(payloadHash);
  });

  it('token neobsahuje nič tajné okrem podpisu (I1)', async () => {
    const service = makeService();
    const { token } = await service.issue(BASE);
    const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8'));
    expect(payload.iss).toBe(PREVIEW_TOKEN_ISSUER);
    expect(payload.aud).toBe(PREVIEW_TOKEN_AUDIENCE);
    expect(payload.exp - payload.iat).toBe(PREVIEW_TOKEN_TTL_SECONDS);
    expect(Object.keys(payload)).not.toContain('apiKey');
    expect(Object.keys(payload)).not.toContain('secret');
  });

  it('odmietne vydanie pre ceny mimo sady (D39c)', async () => {
    const service = makeService();
    await expect(
      service.issue({ ...BASE, pricesAtPreview: { ...BASE.pricesAtPreview, '999': '1.00' } }),
    ).rejects.toBeInstanceOf(PreviewTokenError);
  });

  it('odmietne vydanie bez prihláseného usera', async () => {
    const service = makeService();
    await expect(service.issue({ ...BASE, sub: 0 })).rejects.toBeInstanceOf(PreviewTokenError);
  });
});

describe('preview-token: dôvody odmietnutia (I3)', () => {
  const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
    try {
      await fn();
    } catch (error) {
      expect(error).toBeInstanceOf(PreviewTokenError);
      return (error as PreviewTokenError).code;
    }
    throw new Error('Očakávalo sa odmietnutie, ale verify() prešlo.');
  };

  it('chýbajúci alebo prázdny token', async () => {
    const service = makeService();
    expect(await codeOf(() => service.verify('', expectedOf()))).toBe('invalid_token');
    expect(await codeOf(() => service.verify('nie-jwt', expectedOf()))).toBe('invalid_token');
  });

  it('pozmenený podpis alebo iný secret', async () => {
    const service = makeService();
    const { token } = await service.issue(BASE);

    const parts = token.split('.');
    const broken = `${parts[0]}.${parts[1]}.${'A'.repeat(parts[2]!.length)}`;
    expect(await codeOf(() => service.verify(broken, expectedOf()))).toBe('invalid_token');

    const other = createPreviewTokenService({ secret: randomBytes(32) });
    expect(await codeOf(() => other.verify(token, expectedOf()))).toBe('invalid_token');
  });

  it('token po 15 minútach', async () => {
    const clock = { ms: Date.parse('2026-08-05T10:00:00.000Z') };
    const service = makeService(clock);
    const { token } = await service.issue(BASE);

    clock.ms += (PREVIEW_TOKEN_TTL_SECONDS - 5) * 1000;
    await expect(service.verify(token, expectedOf())).resolves.toBeTruthy();

    const { token: second } = await service.issue(BASE);
    clock.ms += (PREVIEW_TOKEN_TTL_SECONDS + 1) * 1000;
    expect(await codeOf(() => service.verify(second, expectedOf()))).toBe('expired');
  });

  it('podvrhnutý payloadHash v claimoch', async () => {
    // Token podpísaný správnym secretom, ale s hashom inej sady.
    const forged = await new SignJWT({
      kind: 'new',
      productIds: [7, 15, 42],
      percent: 20,
      from: '2026-09-01',
      to: '2026-09-30',
      pricesAtPreview: BASE.pricesAtPreview,
      payloadHash: computePayloadHash({ ...expectedOf(), percent: 30 }),
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(PREVIEW_TOKEN_ISSUER)
      .setAudience(PREVIEW_TOKEN_AUDIENCE)
      .setSubject('1')
      .setJti('01JZZZZZZZZZZZZZZZZZZZZZZZ')
      .setIssuedAt()
      .setExpirationTime(`${PREVIEW_TOKEN_TTL_SECONDS}s`)
      .sign(SECRET);

    const service = makeService();
    expect(await codeOf(() => service.verify(forged, expectedOf()))).toBe('payload_mismatch');
  });

  it('token pre inú sadu parametrov', async () => {
    const service = makeService();
    const { token } = await service.issue(BASE);

    expect(await codeOf(() => service.verify(token, { ...expectedOf(), percent: 25 }))).toBe(
      'payload_mismatch',
    );
    const { token: t2 } = await service.issue(BASE);
    expect(
      await codeOf(() => service.verify(t2, { ...expectedOf(), productIds: [7, 15] })),
    ).toBe('payload_mismatch');
    const { token: t3 } = await service.issue(BASE);
    expect(await codeOf(() => service.verify(t3, { ...expectedOf(), kind: 'overwrite' }))).toBe(
      'payload_mismatch',
    );
    const { token: t4 } = await service.issue(BASE);
    expect(await codeOf(() => service.verify(t4, { ...expectedOf(), to: '2026-10-31' }))).toBe(
      'payload_mismatch',
    );
  });

  it('token s natiahnutým TTL nad 15 min', async () => {
    const forgedExpected = expectedOf();
    const longLived = await new SignJWT({
      kind: forgedExpected.kind,
      productIds: [7, 15, 42],
      percent: forgedExpected.percent,
      from: forgedExpected.from,
      to: forgedExpected.to,
      pricesAtPreview: BASE.pricesAtPreview,
      payloadHash: computePayloadHash(forgedExpected),
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(PREVIEW_TOKEN_ISSUER)
      .setAudience(PREVIEW_TOKEN_AUDIENCE)
      .setSubject('1')
      .setJti('01JZZZZZZZZZZZZZZZZZZZZZZY')
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(SECRET);

    const service = makeService();
    expect(await codeOf(() => service.verify(longLived, expectedOf()))).toBe('invalid_token');
  });

  it('druhé použitie toho istého tokenu (replay)', async () => {
    const service = makeService();
    const { token } = await service.issue(BASE);

    await expect(service.verify(token, expectedOf())).resolves.toBeTruthy();
    expect(await codeOf(() => service.verify(token, expectedOf()))).toBe('replayed');
  });

  it('neúspešné overenie NESPÁLI token platnej sady', async () => {
    const service = makeService();
    const { token } = await service.issue(BASE);

    expect(await codeOf(() => service.verify(token, { ...expectedOf(), percent: 25 }))).toBe(
      'payload_mismatch',
    );
    // Ten istý token so správnou sadou musí ešte prejsť — a až potom byť spálený.
    await expect(service.verify(token, expectedOf())).resolves.toBeTruthy();
    expect(await codeOf(() => service.verify(token, expectedOf()))).toBe('replayed');
  });
});

/* ═════════════════════════════ replay guard ═══════════════════════════════ */

describe('preview-token: store jednorazovosti', () => {
  it('consume() je check-and-set a čistí expirované záznamy', async () => {
    const clock = { ms: Date.parse('2026-08-05T10:00:00.000Z') };
    const store = createMemoryPreviewTokenStore(() => new Date(clock.ms));
    const expiresAt = new Date(clock.ms + 60_000);

    expect(await store.consume('A', expiresAt)).toBe(true);
    expect(await store.consume('A', expiresAt)).toBe(false);
    expect(store.size()).toBe(1);

    clock.ms += 120_000;
    expect(store.size()).toBe(0);
    // Po expirácii tokenu je jti bezcenné — token aj tak neprejde `jwtVerify`.
    expect(await store.consume('A', new Date(clock.ms + 60_000))).toBe(true);
  });

  it('injektovaný store sa použije namiesto in-process (A9/A12 wiring)', async () => {
    const consumed: string[] = [];
    const service = createPreviewTokenService({
      secret: SECRET,
      store: {
        async consume(jti) {
          consumed.push(jti);
          return consumed.length === 1;
        },
      },
    });

    const { token, jti } = await service.issue(BASE);
    await service.verify(token, expectedOf());
    expect(consumed).toEqual([jti]);

    const { token: second } = await service.issue(BASE);
    await expect(service.verify(second, expectedOf())).rejects.toBeInstanceOf(PreviewTokenError);
  });
});
