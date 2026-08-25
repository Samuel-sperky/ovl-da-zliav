/**
 * Aura Zľavy — SNÍMKOVAČ: `next/navigation` bez Next.js.
 *
 * Jediné, čo z tohto modulu obrazovky naozaj potrebujú, je ADRESA: podľa nej
 * si `Nav` podčiarkne tab a `DiscountsWorkspace` vyberie otvorenú zľavu. Bez
 * nej by na každej snímke nesvietil žiadny tab a chróm by vyzeral pokazene,
 * hoci pokazený nie je.
 *
 * Adresu nastavuje snímkovač cez `nastavCestu()` pred vykreslením obrazovky.
 * Zvyšok je prázdna náhrada — na snímke sa nikam nenaviguje.
 *
 * Vlastník: snímkovač (`scripts/snimky.ts`).
 */
let cesta = '/';

/** Ktorú adresu má appka pri vykresľovaní vidieť. */
export function nastavCestu(nova: string): void {
  cesta = nova;
}

export function usePathname(): string {
  return cesta;
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams();
}

export function useParams(): Record<string, string> {
  return {};
}

export function useRouter() {
  return {
    push(): void {},
    replace(): void {},
    refresh(): void {},
    back(): void {},
    forward(): void {},
    prefetch(): void {},
  };
}

export function redirect(_to: string): never {
  throw new Error('snímkovač: redirect sa nepoužíva');
}

export function notFound(): never {
  throw new Error('snímkovač: notFound sa nepoužíva');
}
