/**
 * Aura Zľavy — ľudská hláška pre neúspešnú mutáciu.
 *
 * ODKIAĽ SA TENTO MODUL VZAL
 * --------------------------
 * Pôvodne (`lib/ui/first-run.ts`) riešil dva stavy: prvý beh appky bez účtu
 * a chýbajúcu session. Oba zmizli 27. 8. 2026 s prihlásením (D99). Zostal dôvod,
 * pre ktorý modul vznikol, a ten je stále živý:
 *
 *   Používateľ vložil API kľúč do produkčného shopu, dostal červený obdĺžnik,
 *   pole sa vyprázdnilo — a myslel si, že kľúč je uložený.
 *
 * Chybová hláška musí povedať NIE LEN „nepodarilo sa", ale aj „a preto sa NIČ
 * nezmenilo". To je priamo prvé pravidlo projektu (I11): tvrdenie „nezapísali
 * sme nič" je iné než „nevieme, či sme zapísali", a appka ich nesmie zliať.
 *
 * Modul je zámerne čistý — bez Reactu a bez `fetch` —, aby sa dal testovať
 * jednotkovo. Strážené testom `test/unit/action-failure.spec.ts`.
 */

/** Tón panelu `ErrorMessage` (drží sa jeho `ErrorTone` bez importu z `.tsx`). */
export type FailureTone = 'info' | 'attention' | 'critical';

export interface ActionErrorLike {
  code?: string | null;
  message?: string | null;
}

export interface ActionFailure {
  /** Slovenská veta pre používateľa. */
  message: string;
  /** Raw kód do rozbaľovacieho technického detailu. */
  rawCode: string | null;
  tone: FailureTone;
}

/**
 * Zloží hlášku pre neúspešnú mutáciu.
 *
 * `action` je podstatná fráza akcie v prvom páde, napr. `'Uloženie API kľúča'`
 * — použije sa vtedy, keď server neposlal vlastnú hlášku, aby veta aspoň
 * pomenovala, ČO zlyhalo.
 *
 * POZOR NA JEDNU VETU, KTORÁ SEM NEPATRÍ. Hláška NESMIE tvrdiť „nič sa
 * nezmenilo". Pri neznámej chybe to appka NEVIE — mutácia mohla spadnúť aj
 * uprostred. Pôvodná verzia modulu to tvrdila výhradne pri 401 `unauthorized`,
 * kde to preukázateľne platilo (request bol odmietnutý pred akoukoľvek prácou);
 * tá vetva zmizla s prihlásením (D99) a s ňou musela zmiznúť aj tá veta.
 * Tvrdiť „nezapísali sme nič", keď to nevieme, je presne to, čo I11 zakazuje —
 * len obrátene.
 */
export function describeActionFailure(
  error: ActionErrorLike | null | undefined,
  opts: { action: string },
): ActionFailure {
  const code = error?.code ?? null;
  const serverMessage = error?.message?.trim();
  if (serverMessage) {
    return { message: serverMessage, rawCode: code, tone: 'critical' };
  }
  return {
    message: `${opts.action} sa nepodarilo. Skús to znova.`,
    rawCode: code,
    tone: 'critical',
  };
}
