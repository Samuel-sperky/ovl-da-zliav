/**
 * Aura Zľavy — testy preview tokenu (A1/V6, BUILD-SPEC §7, O2, I3, K4).
 *
 * Preview token je nosič invariantu I3: bez platného, jednorazového tokenu so
 * zhodným `payloadHash` neexistuje cesta k ostrému zápisu. Testy preto pokrývajú
 * všetky spôsoby, ako sa token dá odmietnuť:
 *  - pozmenený podpis / iný secret / iný algoritmus,
 *  - expirácia po 15 minútach,
 *  - podvrhnutý `payloadHash` v claimoch,
 *  - token vydaný pre inú sadu parametrov,
 *  - druhé použitie toho istého tokenu (replay).
 *
 * K4 pridáva druhú vrstvu: hash sa počíta STREAMOVO nad trojicami
 * `<product_id>:<percent>:<price_at_preview>` a musí zniesť 10 000 položiek bez
 * toho, aby sa postavil jeden obrí reťazec. Testy to nielen tvrdia — merajú to.
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
  streamPayloadHash,
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

/**
 * Sada tak, ako ju pozná POŽIADAVKA: bez cien a bez percent pásiem — tie
 * prídu z tokenu (verify si ich doplní, ich pravosť dokazuje `payloadHash`).
 */
const expectedOf = (input: IssueInput = BASE) => ({
  kind: input.kind,
  productIds: input.productIds,
  percent: input.percent,
  from: input.from,
  to: input.to,
});

/** Sada tak, ako sa HASHUJE: aj s cenami (K4, D39c). */
const hashedOf = (input: IssueInput = BASE) => ({
  ...expectedOf(input),
  pricesAtPreview: input.pricesAtPreview,
});

function makeService(nowRef?: { ms: number }) {
  return createPreviewTokenService({
    secret: SECRET,
    now: nowRef ? () => new Date(nowRef.ms) : undefined,
  });
}

/* ═════════════════════════════ payloadHash ════════════════════════════════ */

describe('preview-token: kanonický payloadHash (§7, K4)', () => {
  it('nezávisí od poradia productIds', () => {
    const a = computePayloadHash({ ...hashedOf(), productIds: [7, 15, 42] });
    const b = computePayloadHash({ ...hashedOf(), productIds: [42, 15, 7] });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  /**
   * KONTRAKT SA ZMENIL (K4). Do V2 sa hashoval kanonický JSON
   * `{from, kind, percent, productIds, to}` — jedno percento na celú kampaň a
   * jeden materializovaný reťazec. Pásma (K3) urobili z percenta vlastnosť
   * položky a strop 10 000 (K1) zakázal materializáciu, takže tvrdenie sa
   * prepisuje na nový kanonický tvar: hlavička + trojica na položku.
   *
   * Hlavička `kind/from/to/count` v texte K4 nie je, ale hashuje sa vedome —
   * bez nej by token potvrdený na september autorizoval zápis na december a I3
   * by prestalo platiť. Toto tvrdenie hlavičku pribíja, aby ju nikto nezahodil
   * ako „nadbytočnú".
   */
  it('je SHA-256 hlavičky a trojíc <id>:<percent>:<price> vzostupne (K4)', () => {
    const canonical =
      'kind:new\n' +
      'from:2026-09-01\n' +
      'to:2026-09-30\n' +
      'count:3\n' +
      '7:20:19.90\n' +
      '15:20:5.00\n' +
      '42:20:129.00\n';
    expect(computePayloadHash(hashedOf())).toBe(
      createHash('sha256').update(canonical, 'utf8').digest('hex'),
    );
  });

  it('cena sa kanonizuje, takže 19.9 a 19.90 dajú ten istý hash', () => {
    expect(
      computePayloadHash({
        ...expectedOf(),
        pricesAtPreview: { '7': '19.9', '15': '5', '42': '129.00' },
      }),
    ).toBe(computePayloadHash(hashedOf()));
  });

  it('zmena ktoréhokoľvek parametra zmení hash', () => {
    const base = computePayloadHash(hashedOf());
    expect(computePayloadHash({ ...hashedOf(), percent: 21 })).not.toBe(base);
    expect(computePayloadHash({ ...hashedOf(), from: '2026-09-02' })).not.toBe(base);
    expect(computePayloadHash({ ...hashedOf(), to: '2026-10-01' })).not.toBe(base);
    expect(computePayloadHash({ ...hashedOf(), kind: 'extend' })).not.toBe(base);
    expect(computePayloadHash({ ...hashedOf(), productIds: [7, 15] })).not.toBe(base);
    // K4 — cena aj percento sú v hashi per POLOŽKA (D39c, K3).
    expect(
      computePayloadHash({
        ...hashedOf(),
        pricesAtPreview: { ...BASE.pricesAtPreview, '15': '5.01' },
      }),
    ).not.toBe(base);
    expect(computePayloadHash({ ...hashedOf(), percents: { '15': 10 } })).not.toBe(base);
  });

  it('fail-closed odmietne nezmyselnú sadu (K1, I9)', () => {
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
    // K3 — percento POLOŽKY má rovnaké hranice ako percento kampane (1–30).
    expect(() => computePayloadHash({ ...expectedOf(), percents: { '15': 31 } })).toThrow(
      PreviewTokenError,
    );
    expect(() => computePayloadHash({ ...expectedOf(), percents: { '15': 0 } })).toThrow(
      PreviewTokenError,
    );
    // Cena, ktorá nie je peňažná hodnota, sa nesmie potichu zahashovať (D39c).
    expect(() =>
      computePayloadHash({ ...expectedOf(), pricesAtPreview: { '15': 'zadarmo' } }),
    ).toThrow(PreviewTokenError);
  });

  it('strop je 10 000 položiek — zhodný s CHECK v DB (K1 bod 3)', () => {
    expect(PREVIEW_MAX_PRODUCTS).toBe(10_000);
  });
});

/* ═══════════════════ payloadHash pri 10 000 položkách (K4) ════════════════ */

describe('preview-token: payloadHash pri 10 000 položkách (K4)', () => {
  const COUNT = 10_000;

  /** Deterministická sada: id, percento pásma a cena sa dajú prepočítať. */
  const bigItems = (): Array<{ productId: number; percent: number; priceAtPreview: string }> =>
    Array.from({ length: COUNT }, (_, i) => ({
      productId: 1000 + i,
      percent: (i % 30) + 1,
      priceAtPreview: `${10 + (i % 900)}.${String(i % 100).padStart(2, '0')}`,
    }));

  const bigInput = (items = bigItems()) => ({
    kind: 'new' as const,
    from: '2026-09-01',
    to: '2026-09-30',
    items,
  });

  it('hash je stabilný a nezávisí od poradia položiek na vstupe', () => {
    const items = bigItems();
    const first = computePayloadHash(bigInput(items));
    const again = computePayloadHash(bigInput(items));
    expect(first).toBe(again);
    expect(first).toMatch(/^[0-9a-f]{64}$/);

    // Obrátené poradie, náhodne premiešané poradie — hash sa nesmie pohnúť,
    // lebo K4 hashuje VZOSTUPNE podľa product_id.
    expect(computePayloadHash(bigInput([...items].reverse()))).toBe(first);

    const shuffled = [...items];
    let seed = 42;
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const j = seed % (i + 1);
      const tmp = shuffled[i]!;
      shuffled[i] = shuffled[j]!;
      shuffled[j] = tmp;
    }
    expect(computePayloadHash(bigInput(shuffled))).toBe(first);
  });

  it('zmena jedinej ceny alebo jediného percenta hash zmení', () => {
    const base = computePayloadHash(bigInput());

    const onePriceChanged = bigItems();
    onePriceChanged[7_777] = { ...onePriceChanged[7_777]!, priceAtPreview: '999.99' };
    expect(computePayloadHash(bigInput(onePriceChanged))).not.toBe(base);

    const onePercentChanged = bigItems();
    const victim = onePercentChanged[4_242]!;
    onePercentChanged[4_242] = { ...victim, percent: victim.percent === 30 ? 29 : victim.percent + 1 };
    expect(computePayloadHash(bigInput(onePercentChanged))).not.toBe(base);

    // A ubratie jedinej položky tiež — `count` v hlavičke to zachytí okamžite.
    expect(computePayloadHash(bigInput(bigItems().slice(0, COUNT - 1)))).not.toBe(base);
  });

  /**
   * Meranie, nie tvrdenie: `streamPayloadHash()` je JEDINÝ zdroj bajtov, ktoré
   * `computePayloadHash()` sype do `hash.update()`. Ak by sa 10 000 položiek
   * zlialo do jedného reťazca, tento test to uvidí — kúskov by bolo pár a boli
   * by obrovské.
   */
  it('sype do hashu po položkách, nie jeden obrí reťazec', () => {
    const chunks: string[] = [];
    streamPayloadHash(bigInput(), (chunk) => chunks.push(chunk));

    expect(chunks).toHaveLength(4 + COUNT); // kind, from, to, count + trojice
    const longest = chunks.reduce((max, chunk) => Math.max(max, chunk.length), 0);
    expect(longest).toBeLessThanOrEqual(64);

    // Celková dĺžka je rádovo stovky kilobajtov — presne to, čo sa NESMIE
    // objaviť ako jeden reťazec v pamäti.
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    expect(total).toBeGreaterThan(100_000);

    // A tok je naozaj to, z čoho hash vzniká.
    expect(createHash('sha256').update(chunks.join(''), 'utf8').digest('hex')).toBe(
      computePayloadHash(bigInput()),
    );
  });

  it('rovnomerný a položkový tvar vstupu dajú ten istý hash', () => {
    const items = bigItems();
    const uniform = {
      kind: 'new' as const,
      productIds: items.map((item) => item.productId),
      percent: 30,
      from: '2026-09-01',
      to: '2026-09-30',
      pricesAtPreview: Object.fromEntries(
        items.map((item) => [String(item.productId), item.priceAtPreview]),
      ),
      percents: Object.fromEntries(items.map((item) => [String(item.productId), item.percent])),
    };
    expect(computePayloadHash(uniform)).toBe(computePayloadHash(bigInput(items)));
  });
});

/* ══════════════════════════════ issue/verify ══════════════════════════════ */

describe('preview-token: vydanie a overenie', () => {
  it('roundtrip vráti claims so sadou, cenami a hashom', async () => {
    const service = makeService();
    const { token, jti, payloadHash } = await service.issue(BASE);

    expect(token.split('.')).toHaveLength(3);
    expect(payloadHash).toBe(computePayloadHash(hashedOf()));

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

  it('vydá token s pásmami a percentá nesie per produkt (K3)', async () => {
    const service = makeService();
    const percents = { '7': 30, '15': 20, '42': 20 };
    const { token } = await service.issue({ ...BASE, percent: 30, percents });

    const claims = await service.verify(token, { ...expectedOf(), percent: 30 });
    expect(claims.percents).toEqual(percents);
    // Položka 7 zlacnie o 30 %, položky 15 a 42 o 20 % — a hlavička kampane je
    // to najvyššie z toho (K3).
    expect(claims.percent).toBe(30);
  });

  it('odmietne vydanie, keď hlavička nie je najvyššie percento pásiem (K3)', async () => {
    const service = makeService();
    await expect(
      service.issue({ ...BASE, percent: 20, percents: { '7': 30, '15': 20, '42': 20 } }),
    ).rejects.toBeInstanceOf(PreviewTokenError);
  });

  it('odmietne vydanie pre percentá mimo sady (K3)', async () => {
    const service = makeService();
    await expect(
      service.issue({ ...BASE, percents: { '999': 20 } }),
    ).rejects.toBeInstanceOf(PreviewTokenError);
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
