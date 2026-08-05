/**
 * Aura Zľavy — slovenské hlášky pre chyby shopu (D47, BUILD-SPEC §6).
 *
 * D47: „Chybové kódy API MUSIA byť mapované na slovenskú vetu s odporúčaním
 * a raw kód MUSÍ byť dostupný v rozbaľovacom detaile; neznámy kód sa MUSÍ
 * zobraziť surovo, NESMIE sa maskovať."
 *
 * Preto:
 *   - známy kód → veta + odporúčanie (bez raw kódu v texte, raw kód nesie
 *     `ShopError.code`, ktorý UI zobrazí v detaile),
 *   - neznámy kód → veta obsahuje kód SUROVO v úvodzovkách (nikdy sa nemaskuje
 *     a nikdy sa nenahrádza generickým „nastala chyba"),
 *   - keď kód chýba, použije sa hláška podľa druhu chyby (`ShopErrorKind`).
 *
 * Tento súbor je jediné miesto so slovenskými vetami pre shop chyby — HTTP
 * pipeline (A5) ich NESMIE duplikovať (SPRINT-PLAN §A5).
 *
 * Vlastník: A3.
 */
import type { ShopErrorKind } from '@/contracts';

/* ════════════════════════════ 1. Tvar hlášky ══════════════════════════════ */

export interface ShopMessage {
  /** Čo sa stalo — jedna veta, bez technického žargónu. */
  message: string;
  /** Čo má Samuel urobiť — jedna veta. */
  recommendation: string;
}

/** Zloží hlášku a odporúčanie do jednej vety pre UI a audit. */
export function formatShopMessage(m: ShopMessage): string {
  return `${m.message} ${m.recommendation}`;
}

/* ═════════════════ 2. Hlášky podľa druhu chyby (taxonómia) ════════════════ */

/**
 * Fallback podľa `ShopErrorKind` — použije sa, keď shop neposlal kód
 * (napr. sieťová chyba, timeout) alebo keď kód nepoznáme a chceme aspoň
 * správne zaradiť dôsledok.
 */
export const KIND_MESSAGES: Readonly<Record<ShopErrorKind, ShopMessage>> = {
  rate_limited: {
    message: 'Shop odmietol požiadavku pre prekročenie limitu volaní.',
    recommendation: 'Počkaj niekoľko minút a operáciu zopakuj — appka to už skúšala 3×.',
  },
  server_error: {
    message: 'Shop odpovedal internou chybou servera.',
    recommendation: 'Skús to znova o pár minút; ak to trvá, napíš maintainerovi shopu.',
  },
  network: {
    message: 'Shop je nedostupný — spojenie sa nepodarilo vytvoriť.',
    recommendation: 'Skontroluj internet a doménu shopu v Nastaveniach, potom zopakuj operáciu.',
  },
  timeout_before: {
    message: 'Shop neodpovedal v časovom limite a požiadavka sa ešte neodoslala.',
    recommendation: 'Nič sa nezmenilo — operáciu môžeš bezpečne zopakovať.',
  },
  timeout_after: {
    message:
      'Shop neodpovedal v časovom limite už po odoslaní zápisu — stav tohto produktu je NEISTÝ.',
    recommendation:
      'Over stav zľavy v admine shopu; appka pošle rovnaký zápis ešte raz a viac sa o to nepokúsi.',
  },
  bad_request: {
    message: 'Shop odmietol požiadavku ako neplatnú.',
    recommendation: 'Oprav zadané hodnoty (percento, dátumy) a skús to znova.',
  },
  unauthorized: {
    message: 'API kľúč je neplatný alebo už neplatí.',
    recommendation: 'Appka kľúč zmazala — vlož nový kľúč a operáciu zopakuj.',
  },
  forbidden: {
    message: 'Kľúč nemá oprávnenie `product:edit`.',
    recommendation: 'Vyžiadaj si od maintainera shopu kľúč so správnym oprávnením a vlož ho znova.',
  },
  not_found: {
    message: 'Shop tento produkt nepozná.',
    recommendation:
      'Skontroluj ID produktu; appka ho označila ako „nenájdený v shope" a ostatné produkty dokončila.',
  },
  schema_drift: {
    message:
      'Shop odpovedal v nečakanom tvare — API sa zmenilo, preto je stav tohto produktu NEISTÝ.',
    recommendation: 'Over stav v admine shopu a nahlás zmenu API maintainerovi; appka nič nedopisuje.',
  },
  batch_not_allowed: {
    message: 'Shop nepovoľuje túto akciu v dávkovom volaní.',
    recommendation: 'Appka automaticky prešla na jednotlivé volania — nemusíš robiť nič.',
  },
};

/* ════════════════════ 3. Hlášky podľa raw kódu zo shopu ═══════════════════ */

/**
 * Normalizácia kódu na kľúč mapy: lowercase, medzery a pomlčky na `_`.
 * Shop používa aj `"not found"` (s medzerou) aj `"batch_not_allowed"`.
 */
export function normalizeShopCode(code: string): string {
  return code.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/** Kódy z `docs/api/sperky-api.md` + lokálne kódy appky (prefix `local_`). */
export const CODE_MESSAGES: Readonly<Record<string, ShopMessage>> = {
  /* ── validácia zápisu (400) ── */
  invalid_dates: {
    message: 'Shop odmietol dátumy zľavy ako neplatné.',
    recommendation: 'Skontroluj, že „do" nie je pred „od" a že oba dátumy sú platné kalendárne dni.',
  },
  invalid_reduction: {
    message: 'Shop odmietol percento zľavy.',
    recommendation: 'Percento musí byť celé číslo od 1 do 30.',
  },
  range_too_long: {
    message: 'Okno zľavy je dlhšie ako 3 mesiace, čo shop nepovoľuje.',
    recommendation: 'Skráť dátum „do" tak, aby okno od–do nepresahovalo 3 mesiace.',
  },
  no_id: {
    message: 'Požiadavka neobsahovala ID produktu.',
    recommendation: 'Toto je chyba appky — nahlás ju s ID operácie z auditu.',
  },
  invalid_input: {
    message: 'Shop vyhodnotil obsah požiadavky ako poškodený alebo príliš veľký.',
    recommendation: 'Skús operáciu zopakovať; ak to potrvá, nahlás ID operácie z auditu.',
  },

  /* ── identita a oprávnenia ── */
  unauthorized: {
    message: 'Shop odmietol API kľúč.',
    recommendation: 'Appka kľúč okamžite zmazala — vlož nový a operáciu zopakuj.',
  },
  forbidden: {
    message: 'Kľúč nemá oprávnenie `product:edit`.',
    recommendation: 'Vyžiadaj kľúč so správnym oprávnením; s týmto kľúčom appka zapisovať nedokáže.',
  },

  /* ── smerovanie a dávka ── */
  batch_not_allowed: {
    message: 'Shop túto akciu v dávkovom volaní nepovoľuje.',
    recommendation: 'Appka prešla na jednotlivé volania sama — nemusíš robiť nič.',
  },
  no_requests: {
    message: 'Dávkové volanie neobsahovalo žiadnu položku.',
    recommendation: 'Toto je chyba appky — nahlás ju s ID operácie z auditu.',
  },
  too_many_requests: {
    message: 'Dávkové volanie obsahovalo viac ako 25 položiek.',
    recommendation: 'Toto je chyba appky — nahlás ju s ID operácie z auditu.',
  },
  invalid_item: {
    message: 'Shop nerozumel jednej položke dávkového volania.',
    recommendation: 'Toto je chyba appky — nahlás ju s ID operácie z auditu.',
  },
  unknown_controller: {
    message: 'Shop nepozná volanú časť API.',
    recommendation: 'Skontroluj doménu shopu v Nastaveniach; možno smeruje na nesprávny web.',
  },
  invalid_action: {
    message: 'Shop nepozná volanú akciu API.',
    recommendation: 'API shopu sa pravdepodobne zmenilo — nahlás to maintainerovi shopu.',
  },
  method_not_allowed: {
    message: 'Shop očakáva túto akciu pod inou HTTP metódou.',
    recommendation: 'API shopu sa pravdepodobne zmenilo — nahlás to maintainerovi shopu.',
  },
  cross_origin_denied: {
    message: 'Shop odmietol požiadavku ako cudzí pôvod.',
    recommendation: 'Toto by sa pri volaní s API kľúčom nemalo stať — nahlás ID operácie z auditu.',
  },
  origin_required: {
    message: 'Shop vyžadoval hlavičku pôvodu, ktorú appka neposiela.',
    recommendation: 'Toto by sa pri volaní s API kľúčom nemalo stať — nahlás ID operácie z auditu.',
  },

  /* ── prevádzka ── */
  not_found: {
    message: 'Shop tento produkt nepozná.',
    recommendation:
      'Skontroluj ID produktu v allowlistě; appka ho označila ako „nenájdený v shope" a pokračovala ďalšími.',
  },
  rate_limited: {
    message: 'Shop odmietol požiadavku pre prekročenie limitu volaní.',
    recommendation: 'Počkaj niekoľko minút a operáciu zopakuj.',
  },
  request_failed: {
    message: 'Shop odpovedal internou chybou.',
    recommendation: 'Skús to znova o pár minút; ak to trvá, napíš maintainerovi shopu.',
  },

  /* ── lokálne kódy appky (fail-closed pred odoslaním, I7/I9) ── */
  local_invalid_reduction: {
    message: 'Appka odmietla zápis: percento nie je celé číslo od 1 do 30.',
    recommendation: 'Zadaj percento 1–30; toto sa ku shopu vôbec neposlalo.',
  },
  local_invalid_dates: {
    message: 'Appka odmietla zápis: dátumové okno nie je platné.',
    recommendation: 'Skontroluj, že „od" aj „do" sú platné dni a že „do" nie je pred „od".',
  },
  local_range_too_long: {
    message: 'Appka odmietla zápis: okno od–do presahuje 3 mesiace.',
    recommendation: 'Skráť dátum „do"; shop dlhšie okno aj tak nepovoľuje.',
  },
  local_to_in_past: {
    message: 'Appka odmietla zápis, ktorý má dátum „do" v minulosti.',
    recommendation:
      'Zľavu sa rušiť nedá (R6) — nechaj ju prirodzene expirovať, alebo zľavu prepíš novým oknom.',
  },
  local_invalid_product_id: {
    message: 'Appka odmietla zápis: ID produktu nie je platné celé číslo.',
    recommendation: 'Toto je chyba appky — nahlás ju s ID operácie z auditu.',
  },
  local_schema_drift: {
    message: 'Odpoveď shopu neprešla kontrolou tvaru — stav je NEISTÝ.',
    recommendation: 'Over stav v admine shopu a nahlás zmenu API maintainerovi.',
  },
  local_no_base_url: {
    message: 'Doména shopu nie je nastavená alebo nie je platná https adresa.',
    recommendation: 'Nastav doménu shopu v Nastaveniach (vyžaduje heslo) a spusti test spojenia.',
  },
};

/* ════════════════════════════ 4. Verejné API ══════════════════════════════ */

/** True, keď pre kód existuje slovenská veta. */
export function hasShopCodeMessage(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(CODE_MESSAGES, normalizeShopCode(code));
}

/**
 * Hláška pre kombináciu druhu chyby a raw kódu (D47).
 *
 * Poradie: známy kód → veta kódu; neznámy kód → veta druhu chyby + kód SUROVO;
 * žiadny kód → veta druhu chyby.
 */
export function shopMessage(kind: ShopErrorKind, code?: string | null): ShopMessage {
  const kindMessage = KIND_MESSAGES[kind];
  if (code === undefined || code === null || code.trim().length === 0) return kindMessage;

  const known = CODE_MESSAGES[normalizeShopCode(code)];
  if (known) return known;

  // D47: neznámy kód sa zobrazí surovo, nikdy sa nemaskuje.
  return {
    message: `${kindMessage.message} Shop uviedol neznámy kód „${code}".`,
    recommendation: `${kindMessage.recommendation} Kód „${code}" nahlás maintainerovi shopu.`,
  };
}

/** Jednoveršová hláška pre `ShopError.message`, audit a UI. */
export function shopMessageText(kind: ShopErrorKind, code?: string | null): string {
  return formatShopMessage(shopMessage(kind, code));
}

/**
 * Viac kódov v jednej odpovedi (`{ok:false,errors:['invalid_dates','invalid_reduction']}`)
 * — shop ich smie skombinovať, takže hlášku skladáme zo všetkých.
 */
export function shopMessageTextForCodes(kind: ShopErrorKind, codes: readonly string[]): string {
  if (codes.length === 0) return shopMessageText(kind, null);
  if (codes.length === 1) return shopMessageText(kind, codes[0]);
  const parts = codes.map((code) => shopMessage(kind, code));
  const messages = parts.map((p) => p.message);
  const recommendations = Array.from(new Set(parts.map((p) => p.recommendation)));
  return `${messages.join(' ')} ${recommendations.join(' ')}`;
}
