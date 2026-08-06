/**
 * Aura Zľavy — test umiestnenia tooltipu grafov (U10).
 *
 * Tooltip sa doteraz kreslil vždy vpravo dole od kurzora a na pravom/spodnom
 * okraji grafu pretiekol von. `tooltipTransform()` je čistá funkcia, ktorá
 * pri hrozbe pretečenia preklopí tooltip na opačnú stranu kurzora
 * (`translate(-100%)`), takže zostáva vnútri rámu grafu.
 */
import { describe, expect, it } from 'vitest';

import {
  TOOLTIP_MAX_WIDTH_PX,
  TOOLTIP_OFFSET_PX,
  tooltipTransform,
} from '@/components/charts/ChartFrame';

describe('tooltipTransform (U10 — clamp na okrajoch)', () => {
  const RECT_W = 600;
  const RECT_H = 300;

  it('v strede grafu kreslí vpravo dole od kurzora (offset +12 px)', () => {
    const t = tooltipTransform(100, 100, RECT_W, RECT_H);
    expect(t).toContain(`translate(${100 + TOOLTIP_OFFSET_PX}px, ${100 + TOOLTIP_OFFSET_PX}px)`);
    expect(t).not.toContain('-100%');
  });

  it('pri pravom okraji sa preklopí doľava — x + šírka > rect.width', () => {
    const x = RECT_W - 20; // 12 + 288 by pretieklo
    const t = tooltipTransform(x, 100, RECT_W, RECT_H);
    expect(t).toContain('translate(-100%, 0)');
    expect(t).toContain(`translate(${x - TOOLTIP_OFFSET_PX}px`);
  });

  it('pri spodnom okraji sa preklopí nahor', () => {
    const t = tooltipTransform(100, RECT_H - 10, RECT_W, RECT_H);
    expect(t).toContain('translate(0, -100%)');
  });

  it('v pravom spodnom rohu sa preklopí v oboch osiach', () => {
    const t = tooltipTransform(RECT_W - 5, RECT_H - 5, RECT_W, RECT_H);
    expect(t).toContain('translate(-100%, -100%)');
  });

  it('presne na hranici (x + offset + šírka = rect.width) sa ešte nepreklápa', () => {
    const x = RECT_W - TOOLTIP_OFFSET_PX - TOOLTIP_MAX_WIDTH_PX;
    expect(tooltipTransform(x, 100, RECT_W, RECT_H)).not.toContain('-100%');
  });

  it('neznámy rozmer kontajnera (0) nepreklápa — správa sa ako doteraz', () => {
    expect(tooltipTransform(500, 250, 0, 0)).not.toContain('-100%');
  });
});
