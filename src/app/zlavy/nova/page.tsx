/**
 * Aura Zľavy — `/zlavy/nova` (V11; architektúra §2, kontrakt V3 K1, K7).
 *
 * Sem vedie tlačidlo `Zlacniť` z tabu Produkty a `Nová zľava` z Prehľadu.
 * Adresa má dva tvary a oba tu musia fungovať, lebo sa dajú uložiť do
 * poznámok aj do záložiek prehliadača:
 *
 *   `?produkty=18342,21170`   — používateľ označil konkrétne riadky,
 *   `?filter=…&pocet=11640`   — vybral všetko, čo vyhovuje filtru.
 *
 * Zoznam desiatich tisícov čísel sa do adresy nezmestí, preto hromadný výber
 * nesie FILTER a sprievodca sa spýta API na tie isté riadky.
 *
 * Od 31. 8. 2026 (D112) prijíma aj predplnenie z presetu a zo zopakovania
 * minulej zľavy:
 *
 *   `?pasma=none:30,low:20`   — percentá pásiem,
 *   `?dni=14`                 — dĺžka okna,
 *   `?preset=…` / `?zopakovat=…` — odkiaľ sú polia (len na zobrazenie).
 *
 * Sú to HODNOTY FORMULÁRA, nie príkaz na zápis: skúška naprázdno a potvrdenie
 * sa odohrajú tu nanovo (I3). Route, ktorá by z presetu vyrobila kampaň,
 * neexistuje a vzniknúť nesmie — viď `src/app/api/presets/_shared.ts`.
 *
 * Bez parametrov sa predvyplní filter ležiakov (0 predaných za 180 dní) —
 * je to prvý klik používateľa a appka existuje na zlacňovanie toho, čo sa
 * nepredáva (architektúra §2).
 *
 * Vlastník: V11.
 */
import type { Metadata } from 'next';

import NewDiscount, { type NewDiscountInitial } from '@/components/campaigns/NewDiscount';
import {
  parseDurationParam,
  parsePercentsParam,
} from '@/components/campaigns/presets-model';
import {
  DEFAULT_CATALOG_FILTER,
  parseCatalogFilterQuery,
  type CatalogFilterState,
} from '@/components/products/catalog-filter';
import { APP_DISPLAY_NAME } from '@/version';

export const metadata: Metadata = {
  title: `Nová zľava — ${APP_DISPLAY_NAME}`,
};

/** Predvolený výber: ležiaky za 180 dní. Nie celý katalóg. */
const LEZIAKY: CatalogFilterState = {
  ...DEFAULT_CATALOG_FILTER,
  soldWindowDays: 180,
  soldBuckets: ['none'],
};

function first(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/** `18342,21170` → `[18342, 21170]`. Nezmysly sa zahadzujú, nie dopočítavajú. */
function parseProductIds(raw: string | undefined): number[] | null {
  if (raw === undefined || raw.trim() === '') return null;
  const ids = raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  return ids.length === 0 ? null : ids;
}

/**
 * Okno platnosti z adresy (`?od=2026-09-04&do=2026-09-18`). Používajú ho návrhy
 * z Prehľadu pri nadväzovaní na končiacu zľavu.
 *
 * `od` stačí samo: návrh vie, kedy predošlá zľava končí, ale nie ako dlho má
 * trvať nová — dĺžku doplní sprievodca svojou predvolenou. Prijme sa len tvar
 * `YYYY-MM-DD` a koniec nesmie byť pred začiatkom; čokoľvek iné je `null` a
 * appka si okno navrhne sama. Adresa je vstup od používateľa a naslepo sa jej
 * neverí.
 */
function parseWindow(
  from: string | undefined,
  to: string | undefined,
): { from: string; to: string | null } | null {
  const shape = /^\d{4}-\d{2}-\d{2}$/;
  const valid = (value: string | undefined): value is string =>
    value !== undefined && shape.test(value) && !Number.isNaN(Date.parse(value));

  if (!valid(from)) return null;
  if (!valid(to)) return { from, to: null };
  return to < from ? { from, to: null } : { from, to };
}

export default async function NewDiscountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const productIds = parseProductIds(first(params['produkty']));
  const filterQuery = first(params['filter']);
  const expected = Number(first(params['pocet']));

  /*
   * PREDPLNENIE Z PRESETU / ZO ZOPAKOVANIA ZĽAVY (D112, K7).
   *
   * `?pasma=none:30,low:20&dni=14` sú hodnoty formulára, nie príkaz na zápis:
   * skúška naprázdno aj potvrdenie sa odohrajú na tejto obrazovke nanovo (I3).
   * `?preset=` a `?zopakovat=` nesú LEN meno, aby formulár mohol povedať,
   * odkiaľ sú polia predplnené — na zápis nemajú vplyv.
   *
   * Adresa je vstup od človeka (dá sa uložiť do záložiek), preto sa jej neverí:
   * neznáme pásmo aj percento či dĺžka mimo rozsahu sa ZAHADZUJÚ, nie orezávajú
   * (`presets-model.ts`).
   */
  const presetName = first(params['preset']);
  const repeatName = first(params['zopakovat']);
  const prefillFrom =
    presetName !== undefined && presetName.trim() !== ''
      ? { kind: 'preset' as const, label: presetName.trim().slice(0, 120) }
      : repeatName !== undefined && repeatName.trim() !== ''
        ? { kind: 'campaign' as const, label: repeatName.trim().slice(0, 120) }
        : null;

  const initial: NewDiscountInitial = {
    productIds,
    filter:
      filterQuery === undefined || filterQuery.trim() === ''
        ? productIds === null
          ? LEZIAKY
          : DEFAULT_CATALOG_FILTER
        : parseCatalogFilterQuery(filterQuery),
    expectedTotal: Number.isInteger(expected) && expected > 0 ? expected : null,
    window: parseWindow(first(params['od']), first(params['do'])),
    percents: parsePercentsParam(first(params['pasma'])),
    windowDays: parseDurationParam(first(params['dni'])),
    prefillFrom,
  };

  return <NewDiscount initial={initial} />;
}
