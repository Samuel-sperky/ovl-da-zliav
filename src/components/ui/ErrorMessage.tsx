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
 *
 * DVA SLOVNÍKY, KTORÉ TU UŽ NIE SÚ (19. 8. 2026)
 * ----------------------------------------------
 * Tento súbor mal vlastnú `TONE_CLASS` aj vlastnú `TONE_GLYPH` — a obe boli
 * znak po znaku rovnaké ako `NOTE_CLASS` / `NOTE_GLYPH` v `ui/primitives.ts`.
 * Dva slovníky pre tú istú vec sa raz rozídu; tento sa rozísť nestihol len
 * preto, že si ho nikto nevšimol. Zostal z nich JEDEN prevod
 * `ErrorTone → NoteVariant` a všetko ostatné sa berie z vysvetlivky, ktorá
 * sama odvodzuje značku z koreňového `TONE_ICON` (`ui/ToneBadge.tsx`).
 * Reťaz je teda
 *
 *     ErrorTone → NoteVariant → NOTE_TONE → TONE_ICON
 *
 * a nie je v nej ani jedna druhá ručne písaná tabuľka.
 */
import Icon from '@/components/ui/Icon';
import { NOTE_CLASS, NOTE_ICON, type NoteVariant } from '@/components/ui/primitives';
import type { StatusTone } from '@/components/ui/ToneBadge';

export type ErrorTone = 'info' | 'attention' | 'critical';

/**
 * Jediný prevod, ktorý tomuto súboru zostal. Mená variantov vysvetlivky sú
 * prevzaté z predlohy (`.note`, `.note.warn`, `.note.err`), mená tónov panelu
 * z §3.2 — sú to tie isté tri veci pod dvoma menami.
 */
const NOTE_VARIANT: Readonly<Record<ErrorTone, NoteVariant>> = {
  info: 'info',
  attention: 'warn',
  critical: 'err',
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
  const variant = NOTE_VARIANT[tone];
  return (
    <div
      className={NOTE_CLASS[variant]}
      role={tone === 'critical' ? 'alert' : 'status'}
      data-tone={tone}
    >
      <Icon className="ovl-note-glyph" name={NOTE_ICON[variant]} size={0.9} />
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
