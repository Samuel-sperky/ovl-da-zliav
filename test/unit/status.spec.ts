/**
 * Aura Zľavy — testy stavového stroja kampaní (A7, D83, D33b, I3, BUILD-SPEC §4).
 *
 * Akceptačné kritériá A7:
 *  - tabuľka prechodov §4 je implementovaná 1 : 1 vrátane zakázaných prechodov,
 *  - `missed → running` bez NOVÉHO potvrdenia hodí výnimku (D33b),
 *  - prechod do `running` bez `confirmed_at`/`confirm_payload_hash` hodí
 *    výnimku (I3),
 *  - terminálne stavy nemajú žiadny odchádzajúci prechod.
 */
import { describe, expect, it } from 'vitest';

import {
  assertTransition,
  CAMPAIGN_STATUSES,
  canTransition,
  checkTransition,
  deriveCampaignView,
  finishTrigger,
  HARD_TERMINAL_STATUSES,
  needsAcknowledgement,
  nextStatuses,
  resolveFinalStatus,
  tallyItemStatuses,
  TRANSITIONS,
} from '@/lib/domain/status';
import { DomainError } from '@/lib/domain/errors';
import type { CampaignStatus, Sha256Hex } from '@/contracts';

/** Platné potvrdenie (I3). */
const CONFIRMED = {
  confirmedAt: new Date('2026-08-05T10:00:00Z'),
  confirmPayloadHash: 'a'.repeat(64) as Sha256Hex,
};

const code = (fn: () => unknown): string => {
  try {
    fn();
    throw new Error('malo hodiť DomainError');
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
};

describe('tabuľka prechodov §4 — povolené prechody', () => {
  it('draft → scheduled (create_scheduled)', () => {
    const rule = assertTransition('draft', 'scheduled', { trigger: 'create_scheduled' });
    expect(rule.effects).toContain('audit:campaign_created');
  });

  it('draft → running (create_eager) s potvrdením', () => {
    expect(() =>
      assertTransition('draft', 'running', { trigger: 'create_eager', ...CONFIRMED }),
    ).not.toThrow();
  });

  it('scheduled → running (tick_fire) s potvrdením', () => {
    const rule = assertTransition('scheduled', 'running', { trigger: 'tick_fire', ...CONFIRMED });
    expect(rule.effects).toContain('audit:campaign_claimed');
  });

  it('scheduled → needs_key / missed / cancelled', () => {
    expect(canTransition('scheduled', 'needs_key', 'tick_no_key')).toBe(true);
    expect(canTransition('scheduled', 'missed', 'tick_missed')).toBe(true);
    expect(canTransition('scheduled', 'cancelled', 'cancel')).toBe(true);
  });

  it('needs_key → running (key_saved) s potvrdením — auto-dopálenie D23/D24', () => {
    expect(() =>
      assertTransition('needs_key', 'running', { trigger: 'key_saved', ...CONFIRMED }),
    ).not.toThrow();
  });

  it('needs_key → lapsed / cancelled / missed', () => {
    expect(canTransition('needs_key', 'lapsed', 'window_lapsed')).toBe(true);
    expect(canTransition('needs_key', 'cancelled', 'cancel')).toBe(true);
  });

  it('running → done / partial / failed / needs_key / (reconcile)', () => {
    expect(canTransition('running', 'done', 'finish_done')).toBe(true);
    expect(canTransition('running', 'partial', 'finish_partial')).toBe(true);
    expect(canTransition('running', 'failed', 'finish_failed')).toBe(true);
    expect(canTransition('running', 'needs_key', 'key_wiped_during_run')).toBe(true);
    expect(canTransition('running', 'partial', 'reconcile')).toBe(true);
    expect(canTransition('running', 'failed', 'reconcile')).toBe(true);
  });

  it('missed → lapsed / cancelled', () => {
    expect(canTransition('missed', 'lapsed', 'window_lapsed')).toBe(true);
    expect(canTransition('missed', 'cancelled', 'cancel')).toBe(true);
  });
});

describe('I3 — žiadna cesta do running bez potvrdenia', () => {
  const routesToRunning: Array<[CampaignStatus, Parameters<typeof assertTransition>[2]]> = [
    ['draft', { trigger: 'create_eager' }],
    ['scheduled', { trigger: 'tick_fire' }],
    ['needs_key', { trigger: 'key_saved' }],
    ['missed', { trigger: 'manual_execute', freshConfirmation: true }],
  ];

  it('bez confirmed_at aj bez confirm_payload_hash hodí confirmation_required', () => {
    for (const [from, ctx] of routesToRunning) {
      expect(code(() => assertTransition(from, 'running', ctx))).toBe('confirmation_required');
    }
  });

  it('len jedno z dvojice (confirmed_at / hash) nestačí', () => {
    expect(
      code(() =>
        assertTransition('scheduled', 'running', {
          trigger: 'tick_fire',
          confirmedAt: CONFIRMED.confirmedAt,
        }),
      ),
    ).toBe('confirmation_required');
    expect(
      code(() =>
        assertTransition('scheduled', 'running', {
          trigger: 'tick_fire',
          confirmPayloadHash: CONFIRMED.confirmPayloadHash,
        }),
      ),
    ).toBe('confirmation_required');
  });
});

describe('D33b — missed → running len ručne s NOVÝM potvrdením', () => {
  it('manual_execute s freshConfirmation=true a potvrdením prejde', () => {
    expect(() =>
      assertTransition('missed', 'running', {
        trigger: 'manual_execute',
        freshConfirmation: true,
        ...CONFIRMED,
      }),
    ).not.toThrow();
  });

  it('bez freshConfirmation hodí fresh_confirmation_required — pôvodné potvrdenie nestačí', () => {
    expect(
      code(() =>
        assertTransition('missed', 'running', { trigger: 'manual_execute', ...CONFIRMED }),
      ),
    ).toBe('fresh_confirmation_required');
  });

  it('automatické spúšťače (tick_fire, key_saved) zo missed neexistujú', () => {
    expect(canTransition('missed', 'running', 'tick_fire')).toBe(false);
    expect(canTransition('missed', 'running', 'key_saved')).toBe(false);
    for (const trigger of ['tick_fire', 'key_saved'] as const) {
      expect(() =>
        assertTransition('missed', 'running', { trigger, freshConfirmation: true, ...CONFIRMED }),
      ).toThrow(DomainError);
    }
  });

  it('v module neexistuje žiadne „catch-up okno"', () => {
    // jediná cesta missed → running je manual_execute s requiresFreshConfirmation
    const rules = TRANSITIONS.filter((r) => r.from === 'missed' && r.to === 'running');
    expect(rules).toHaveLength(1);
    expect(rules[0]?.trigger).toBe('manual_execute');
    expect(rules[0]?.requiresFreshConfirmation).toBe(true);
  });
});

describe('zakázané prechody a terminálne stavy (§4)', () => {
  it('terminálne stavy done/cancelled/lapsed (+partial/failed) nemajú odchod', () => {
    for (const from of HARD_TERMINAL_STATUSES) {
      expect(nextStatuses(from)).toEqual([]);
      for (const to of CAMPAIGN_STATUSES) {
        expect(canTransition(from, to)).toBe(false);
        expect(code(() => assertTransition(from, to))).toBe('invalid_transition');
      }
    }
  });

  it('náhodné nezmyselné prechody sú odmietnuté', () => {
    for (const [from, to] of [
      ['scheduled', 'done'],
      ['needs_key', 'scheduled'],
      ['running', 'scheduled'],
      ['running', 'missed'],
      ['draft', 'missed'],
      ['missed', 'scheduled'],
    ] as Array<[CampaignStatus, CampaignStatus]>) {
      expect(canTransition(from, to)).toBe(false);
      expect(() => assertTransition(from, to)).toThrow(DomainError);
    }
  });

  it('neznámy stav je odmietnutý', () => {
    expect(() =>
      assertTransition('vymyslený' as CampaignStatus, 'running', CONFIRMED),
    ).toThrow(DomainError);
  });

  it('checkTransition nehádže — vracia ok:false s kódom', () => {
    const res = checkTransition('done', 'running');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('invalid_transition');
    const ok = checkTransition('scheduled', 'running', { trigger: 'tick_fire', ...CONFIRMED });
    expect(ok.ok).toBe(true);
  });
});

describe('koncový stav dávky (D34, D36)', () => {
  it('všetko ok/skipped → done', () => {
    expect(resolveFinalStatus(['ok', 'ok', 'skipped'])).toBe('done');
  });

  it('mix ok + zlyhanie → partial', () => {
    expect(resolveFinalStatus(['ok', 'failed'])).toBe('partial');
    expect(resolveFinalStatus(['ok', 'uncertain'])).toBe('partial');
    expect(resolveFinalStatus(['ok', 'not_found'])).toBe('partial');
    expect(resolveFinalStatus(['ok', 'interrupted'])).toBe('partial');
  });

  it('žiadna ok → failed (skipped sama osebe nezachráni... vlastne áno, done)', () => {
    expect(resolveFinalStatus(['failed', 'failed'])).toBe('failed');
    expect(resolveFinalStatus(['uncertain'])).toBe('failed');
    expect(resolveFinalStatus(['skipped'])).toBe('done'); // len skipped = done (D36)
  });

  it('finishTrigger mapuje na správny spúšťač', () => {
    expect(finishTrigger('done')).toBe('finish_done');
    expect(finishTrigger('partial')).toBe('finish_partial');
    expect(finishTrigger('failed')).toBe('finish_failed');
  });

  it('tallyItemStatuses počíta všetky kategórie', () => {
    const t = tallyItemStatuses(['ok', 'ok', 'failed', 'uncertain', 'pending', 'blocked']);
    expect(t).toMatchObject({ ok: 2, failed: 1, uncertain: 1, pending: 1, blocked: 1 });
  });
});

describe('derivované UI stavy a ack (O1, O6)', () => {
  it('done + dnes ≤ to = aktivna; done/partial + dnes > to = expirovana', () => {
    expect(deriveCampaignView('done', '2026-08-10', '2026-08-05')).toBe('aktivna');
    expect(deriveCampaignView('done', '2026-08-05', '2026-08-05')).toBe('aktivna');
    expect(deriveCampaignView('done', '2026-08-04', '2026-08-05')).toBe('expirovana');
    expect(deriveCampaignView('partial', '2026-08-04', '2026-08-05')).toBe('expirovana');
    expect(deriveCampaignView('partial', '2026-08-10', '2026-08-05')).toBe(null);
    expect(deriveCampaignView('scheduled', '2026-08-10', '2026-08-05')).toBe(null);
  });

  it('needsAcknowledgement (D17, O6)', () => {
    expect(needsAcknowledgement('partial', null)).toBe(true);
    expect(needsAcknowledgement('missed', null)).toBe(true);
    expect(needsAcknowledgement('partial', new Date())).toBe(false);
    expect(needsAcknowledgement('scheduled', null)).toBe(false);
  });
});
