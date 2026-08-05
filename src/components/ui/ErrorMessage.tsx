/**
 * Aura Zľavy — chybová hláška (D15, §8).
 *
 * Slovenská veta + rozbaľovací raw kód/odpoveď API. Raw obsah prechádza
 * centrálnym redaktorom už pri ukladaní (I1) — sem prichádza redigovaný.
 */
export interface ErrorMessageProps {
  /** Zrozumiteľná slovenská veta. */
  message: string;
  /** Raw kód chyby z API (napr. `invalid_dates`). */
  rawCode?: string | null;
  /** Redigovaná raw odpoveď / detail pre rozbaľovací blok. */
  rawDetail?: string | null;
}

export function ErrorMessage({ message, rawCode, rawDetail }: ErrorMessageProps) {
  const hasRaw = Boolean(rawCode) || Boolean(rawDetail);
  return (
    <div className="ovl-error" role="alert">
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
