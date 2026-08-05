/**
 * Aura Zľavy — alias na kontrakty.
 *
 * KANONICKÁ cesta je `@/contracts` (`src/contracts.ts`) — tak ju uvádza
 * `docs/12-SPRINT-PLAN.md` v zadaní A0 aj v tabuľke vlastníctva (§2).
 * Sekcia §0 bod 2 toho istého dokumentu ale spomína `src/lib/contracts.ts`,
 * preto tu je re-export, aby oba importy fungovali a žiadny agent sa
 * nezasekol na ceste k typom.
 *
 * Nič sem nepridávaj — nové typy patria do `src/contracts.ts` (vlastník A0).
 */
export * from '@/contracts';
