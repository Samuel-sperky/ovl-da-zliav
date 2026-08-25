/**
 * Aura Zľavy — NÁHĽAD SA V PRODUKCII NIKDY NEVRACIA K DOTAZU NA PRODUKT.
 *
 * ČO TENTO SÚBOR EXISTUJE ZATVORIŤ
 * --------------------------------
 * `PreviewDeps.campaignsRepo` má dávkové tvary (`findFutureOverlapsByProduct`,
 * `lastOwnWrites`) VOLITEĽNÉ, aby staré fakes v testoch nemuseli dopisovať
 * metódy, ktoré nepoužívajú. Keď chýbajú, `buildPreview()` sa vráti k dotazu na
 * blok a pri náleze na produkt — správny výsledok, drahší počet dotazov.
 *
 * Komentár v `src/lib/engine/preview.ts` od 24. 8. 2026 tvrdil, že „produkčný
 * repozitár ich má vždy a `test/unit/preview-davkove-dotazy.spec.ts` to nad
 * reálnym `campaignsRepoV3` stráži". Ten súbor 25. 8. 2026 NEEXISTOVAL. Bolo to
 * tvrdenie o niečom, čo nikto nemeral — v repe, ktorého prvé pravidlo je, že
 * appka nesmie tvrdiť, čo nezmerala. Buď to teda niekto odmeria, alebo sa tá
 * veta musí zmazať; toto je prvá možnosť.
 *
 * ČO SA TÝM CHRÁNI. Keby dávkové tvary z produkčného repozitára zmizli
 * (premenovanie, refaktor, rozdelenie rozhrania), nič by nespadlo: náhľad by
 * ticho prešiel na záložnú cestu a dry-run nad ôsmimi tisícmi produktov by
 * z desiatok dotazov narástol na tisíce. Je to presne tá trieda chyby, ktorá je
 * na desiatich produktoch neviditeľná — a `preview-sample.spec.ts` ju zachytí
 * len pre fake, nie pre skutočný repozitár.
 *
 * ŽIADNA DATABÁZA. Testuje sa TVAR singletonu, nie jeho odpovede: repozitár sa
 * pri importe nepripája, pripojí sa až prvým dotazom. Preto tu nie je `skipIf`
 * ani `dbAvailable()`.
 */
import { describe, expect, it } from 'vitest';

import { campaignsRepo, campaignsRepoV3 } from '@/lib/repo/campaigns.repo';

/** Tvary, bez ktorých náhľad spadne na dotaz za produkt. */
const DAVKOVE_TVARY = ['findFutureOverlapsByProduct', 'lastOwnWrites'] as const;

describe('produkčný repozitár kampaní nesie dávkové tvary náhľadu', () => {
  it.each(DAVKOVE_TVARY)('`campaignsRepoV3.%s` je funkcia', (name) => {
    expect(typeof campaignsRepoV3[name]).toBe('function');
  });

  /**
   * Route-y náhľadu podávajú `campaignsRepo` (starý tvar), nie `campaignsRepoV3`
   * — `src/app/api/campaigns/_shared.ts` má v defaultoch ten prvý. Ak by to
   * boli dva RÔZNE objekty, kontrola nad `campaignsRepoV3` by o produkčnej
   * ceste nehovorila nič a tento súbor by bol na ozdobu.
   */
  it('je to ten istý objekt, aký dostanú route-y', () => {
    expect(campaignsRepo).toBe(campaignsRepoV3 as unknown as typeof campaignsRepo);
  });

  it.each(DAVKOVE_TVARY)('a preto ho `campaignsRepo.%s` má tiež', (name) => {
    expect(typeof (campaignsRepo as unknown as Record<string, unknown>)[name]).toBe('function');
  });

  /**
   * Toto tvrdenie je tu zámerne, hoci vyzerá zbytočne: keby niekto dávkový tvar
   * „opravil" tak, že ho pridá do rozhrania a nie do objektu, `typeof` vyššie by
   * to zachytilo, ale hláška by nepovedala, čo s tým. Tu je vidieť, ktoré tvary
   * sa vlastne čakajú.
   */
  it('zoznam strážených tvarov sa nezúžil na prázdno', () => {
    expect(DAVKOVE_TVARY.length).toBe(2);
  });
});
