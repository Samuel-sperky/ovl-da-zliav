/**
 * Aura Zľavy — orientačná zľavnená cena (A7, D4, §2).
 *
 * Shop cez API zľavu NEVRACIA (backlog B1, I11), takže každá zľavnená cena,
 * ktorú appka zobrazí, je len ORIENTAČNÁ: `price × (1 − r/100)` z ceny, ktorú
 * sme naposledy videli. UI ju MUSÍ zobrazovať s upozornením (D4) a nikdy ju
 * nesmie prezentovať ako pravdu o shope (I11).
 *
 * Peniaze sa nikdy neporovnávajú ako float (§2): interne sa počíta v celých
 * centoch a von ide zase `MoneyString` (`DECIMAL(10,2)` tvar `1234.56`).
 *
 * Modul je čistý — žiadna DB, žiadna sieť. Vlastník: A7.
 */
import { DOMAIN_ERROR_CODES, DomainError } from '@/lib/domain/errors';
import { assertPercent } from '@/lib/domain/percent';
import type { DiscountPercent, MoneyString } from '@/contracts';

const MONEY_RE = /^-?\d{1,10}(\.\d{1,2})?$/;

/** `true` len pre string v tvare `DECIMAL(10,2)` (aj `12` a `12.5` sú OK z drivera). */
export function isMoneyString(value: unknown): value is MoneyString {
  return typeof value === 'string' && MONEY_RE.test(value.trim());
}

/**
 * Prevedie `MoneyString` na celé centy (integer). Neplatný vstup = `DomainError`
 * s kódom `invalid_money` — cena z DB/shopu, ktorá sa nedá prečítať, sa nikdy
 * potichu nezaokrúhli na niečo iné.
 */
export function moneyToCents(value: unknown): number {
  if (!isMoneyString(value)) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.invalidMoney,
      'Cena nie je platné desatinné číslo (očakáva sa tvar 1234.56).',
      { value: typeof value === 'string' ? value : typeof value },
    );
  }
  const trimmed = (value as string).trim();
  const negative = trimmed.startsWith('-');
  const body = negative ? trimmed.slice(1) : trimmed;
  const [whole, frac = ''] = body.split('.');
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return negative ? -cents : cents;
}

/** Centy → `MoneyString` (`1234.56`). */
export function centsToMoney(cents: number): MoneyString {
  if (!Number.isInteger(cents)) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.invalidMoney,
      'Interná chyba: centy musia byť celé číslo.',
      { cents },
    );
  }
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

/** Porovnanie peňazí bez floatu (§2): `'12.50'` ≡ `'12.5'`. */
export function moneyEquals(a: MoneyString, b: MoneyString): boolean {
  return moneyToCents(a) === moneyToCents(b);
}

/**
 * ORIENTAČNÁ zľavnená cena: `price × (1 − percent/100)`, zaokrúhlené
 * komerčne (half-up) na cent. Výsledok je len na zobrazenie s upozornením (D4)
 * — skutočnú zľavnenú cenu počíta shop a my ju cez API nevidíme (I11, B1).
 */
export function discountedPrice(price: MoneyString, percent: DiscountPercent): MoneyString {
  const p = assertPercent(percent);
  const cents = moneyToCents(price);
  // half-up na celé centy; pri percente 1–30 a nezápornej cene je to bezpečné.
  const discounted = Math.round((cents * (100 - p)) / 100);
  return centsToMoney(discounted);
}

/**
 * Nezhoda ceny medzi náhľadom a zápisom (D39c). `null` na jednej strane
 * (cena sa nedala prečítať) je fail-closed vyhodnotená ako nezhoda.
 */
export function isPriceMismatch(
  priceAtPreview: MoneyString | null,
  priceAtWrite: MoneyString | null,
): boolean {
  if (priceAtPreview === null || priceAtWrite === null) return true;
  return !moneyEquals(priceAtPreview, priceAtWrite);
}

/** Formát pre UI: `1 234,56 €` (slovenské zvyklosti). */
export function formatMoneySk(value: MoneyString): string {
  const cents = moneyToCents(value);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  const frac = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole},${frac}\u00A0€`;
}

/** Upozornenie, ktoré MUSÍ sprevádzať každú zľavnenú cenu v UI (D4, I11). */
export const DISCOUNTED_PRICE_DISCLAIMER_SK =
  'Orientačná cena vypočítaná appkou z poslednej známej ceny — skutočnú zľavnenú cenu určuje shop a cez API sa overiť nedá.';
