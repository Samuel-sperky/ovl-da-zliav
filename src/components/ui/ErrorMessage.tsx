/**
 * Aura Zľavy — chybová / stavová hláška (D15, §8).
 *
 * Slovenská veta + rozbaľovací raw kód/odpoveď API. Raw obsah prechádza
 * centrálnym redaktorom už pri ukladaní (I1) — sem prichádza redigovaný.
 *
 * Redizajn (V20): nie každý neúspešný stav je chyba. `tone` rozhoduje o tóne
 * panelu — `info` pre `preskočený`/`čaká`, `attention` pre neistý/prerušený/
 * nenájdený, `critical` (default) pre skutočné odmietnutie shopom. Default
 * zostáva `critical`, takže existujúce volania sa nemenia.
 */
import type { StatusTone } from '@/components/ui/ToneBadge';

export type ErrorTone = 'info' | 'attention' | 'critical';

const TONE_CLASS: Record<ErrorTone, string> = {
  info: 'ovl-note',
  attention: 'ovl-note ovl-note--attention',
  critical: 'ovl-note ovl-note--critical',
};

const TONE_GLYPH: Record<ErrorTone, string> = {
  info: '○',
  attention: '▲',
  critical: '✕',
};

/** Mapovanie stavového tónu (§3.2) na tón panelu — pre volajúcich s `StatusTone`. */
export function paneToneFor(tone: StatusTone): ErrorTone {
  if (tone === 'critical') return 'critical';
  if (tone === 'attention') return 'attention';
  return 'info';
}

export interface ErrorMessageProps {
  /** Zrozumiteľná slovenská veta. */
  message: string;
  /** Raw kód chyby z API (napr. `invalid_dates`). */
  rawCode?: string | null;
  /** Redigovaná raw odpoveď / detail pre rozbaľovací blok. */
  rawDetail?: string | null;
  /** Tón panelu; default `critical` (spätná kompatibilita). */
  tone?: ErrorTone;
}

export function ErrorMessage({ message, rawCode, rawDetail, tone = 'critical' }: ErrorMessageProps) {
  const hasRaw = Boolean(rawCode) || Boolean(rawDetail);
  return (
    <div
      className={TONE_CLASS[tone]}
      role={tone === 'critical' ? 'alert' : 'status'}
      data-tone={tone}
    >
      <span className="ovl-note-glyph" aria-hidden="true">
        {TONE_GLYPH[tone]}
      </span>
      <span>{message}</span>
      {hasRaw ? (
        <details>
          <summary>Technický detail</summary>
          {rawCode ? (
            <div>
              kód: <code>{rawCode}</code>
            </div>
          ) : null}
          {rawDetail ? <pre>{rawDetail}</pre> : null}
        </details>
      ) : null}
    </div>
  );
}

export default ErrorMessage;
