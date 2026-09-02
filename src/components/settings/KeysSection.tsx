'use client';

/**
 * Aura Zľavy — sekcia KĽÚČE (V12; predloha `design/v3/nastavenia.html`).
 *
 * Dva kľúče, jedna tabuľka: kľúč na zápis zliav a kľúč na čítanie objednávok.
 * Predloha kreslí tri riadky (tretí je štatistiky), appka však tretí kľúč
 * nemá — a vymyslený riadok by bol klamstvo o tom, čo appka vie. Kreslíme
 * preto dva a nikde nepredstierame tretí.
 *
 * Čo tabuľka o kľúči hovorí: názov, dokedy platí, živý odpočet a stav. Čo o ňom
 * NEHOVORÍ: samotný kľúč. Ten sa nezobrazí nikde a nikdy — ani po vložení,
 * ani „na kontrolu". Jediná stopa po ňom sú posledné štyri znaky.
 *
 * Vloženie a obnova sú pod tlačidlom v riadku; formulár sa otvorí pod tabuľkou,
 * aby obrazovka nemala dva rozpísané formuláre naraz.
 *
 * ČO SA STANE PO EXPIRÁCII — A PREČO TO TU MUSÍ BYŤ NAPÍSANÉ
 * ---------------------------------------------------------
 * Kľúč na zápis platí 48 hodín, ale fronta na 150 produktov beží deň a fronta
 * na tisíce aj týždne. Expirácia uprostred behu je teda normálny stav, nie
 * výnimka — a používateľ, ktorý nevie, čo sa vtedy stane, si domyslí to
 * najhoršie (že o rozrobenú zľavu prišiel). Preto je pri tabuľke veta, ktorá
 * hovorí presne tri veci: fronta počká, nič sa nestratí, zapísané zľavy
 * v eshope zostanú. Táto veta sa odtiaľto nesmie stratiť.
 *
 * ČO SA ZMENILO V V6b (a čo nie)
 * ------------------------------
 * Rám sekcie je `Panel` + `PanelHead` (D142, D143) namiesto globálnych tried
 * `.sec` / `.sec-h`, geometria je v `settings-sections.module.css`. Obsah je
 * ten istý do čiarky: tabuľka, obe vysvetľujúce vety, oba formuláre aj
 * technický detail. Kotva `id="kluce"` zostáva — vedie na ňu šesť odkazov
 * z celej appky (`sub-pages.ts`, bod 2) a odstup pod prilepenú hlavičku jej
 * po prevode dáva `.section`, nie zmiznuté `.sec[id]`.
 *
 * PREČO STAV V TABUĽKE NIE JE `ToneBadge`
 * ---------------------------------------
 * Tri kanály (§4 bod 3) nesie ďalej `TONE_SIG_CLASS` + `ToneSigMark` — ten
 * istý mechanizmus, akým o stave hovorí riadok podmienky v `WritesSection`
 * a riadok prekážky na Prehľade. `ToneBadge` robí to isté, ale v bunke tejto
 * tabuľky by bol DRUHÝ vykresľovač stavu na tej istej obrazovke a Nastavenia
 * by o jednej veci rozprávali dvoma tvarmi. Je to to isté rozhodnutie, aké
 * si zapísala `campaigns/DiscountsList.tsx` (`WatchSection`). Badge má na
 * obrazovke jedno miesto a je to iná veta — pozri nižšie.
 *
 * ČO BLOKUJE CHÝBAJÚCI KĽÚČ NA ZÁPIS (V6b)
 * ----------------------------------------
 * Tabuľka povedala, že kľúč `chýba`, a tým skončila. Dôsledok — že appka
 * nezapíše ani jednu zľavu a nedopĺňa podrobnosti o produktoch — sa dal
 * prečítať len na Prehľade v zozname prekážok, teda na obrazovke, na ktorú
 * človek pri vkladaní kľúča nechodí. Odteraz to hovorí sekcia sama
 * (`WriteKeyBlocked`), a hovorí to STAVOM, nie vetou v texte: farba + značka
 * + slovo z `ToneBadge`, pod tým dôsledok. Formulácie sú zabehnuté —
 * prvá polovica je veta prekážky `key_missing` (`lib/status/blockers.ts`),
 * druhá veta pauzy `no_key` (`lib/catalog/enrich-view.ts`). Appka je dnes bez
 * kľúča `shop_write`, takže to NIE JE výnimka, ale bežný stav obrazovky.
 *
 * Vlastník: V12 (rámec, primitíva a priznanie dôsledku: V6b).
 */
import { useState } from 'react';

import ApiKeyForm from '@/components/settings/ApiKeyForm';
import OrdersKeyForm from '@/components/settings/OrdersKeyForm';
import { TONE_SIG_CLASS } from '@/components/settings/blockers-view';
import styles from '@/components/settings/settings-sections.module.css';
import { ToneSigMark } from '@/components/ui/StatusMark';
import Button from '@/components/ui/Button';
import Countdown from '@/components/ui/Countdown';
import Note from '@/components/ui/Note';
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel';
import ToneBadge, { type StatusTone } from '@/components/ui/ToneBadge';
import { formatDateSk, formatDateTimeSk } from '@/lib/ui/format';
import type { KeyMetaView } from '@/components/settings/api';

/** Ktorý formulár je práve otvorený. `null` = žiadny. */
type OpenForm = 'write' | 'orders' | null;

/**
 * Od koľkých zostávajúcich hodín sa o platnosti hovorí nahlas. Zhoda
 * s `KEY_WARNING_HOURS` v `lib/status/blockers.ts` je zámerná: obrazovka
 * a zoznam prekážok nesmú varovať v inom okamihu, inak si protirečia.
 */
export const KEY_WARNING_HOURS = 12;

/**
 * Stav kľúča ako SLOVO a tón. Čistá funkcia — presne tu sa dá ticho pokaziť,
 * že obrazovka povie „vložený" o kľúči, ktorý už neplatí, a používateľ potom
 * hodinu hľadá, prečo sa nezapisuje.
 */
export function keyRowState(meta: KeyMetaView | null): {
  readonly label: string;
  readonly tone: StatusTone;
} {
  if (meta?.present !== true) return { label: 'chýba', tone: 'attention' };

  /*
   * OVERENIE SA ČÍTA PRED ČASOM (24. 8. 2026).
   *
   * Do 24. 8. sa tu rozhodovalo VÝHRADNE podľa `secondsLeft`. `verifyStatus`
   * pritom v `KeyMetaView` je a route ho posiela — len ho nikto nečítal. Kľúč,
   * ktorý shop nikdy nepotvrdil, tak dostal zelené „vložený a platný"; stačilo
   * mu mať pred sebou dosť času. Na živých dátach to bol objednávkový kľúč
   * s `verify_status = 'unverified'`: appka tvrdila platnosť, ktorú nikdy
   * nezmerala, a človek podľa toho slova hľadal príčinu inde.
   *
   * Poradie je preto takéto a nie opačné: „nevieme, či funguje" je dôležitejšia
   * správa než „a mimochodom mu za dva dni vyprší platnosť". Čas má zmysel až
   * pri kľúči, o ktorom vieme, že funguje.
   *
   * TRI STAVY, KTORÉ SA NESMÚ ZLIAŤ:
   *   neoverený        — NEVIEME, či funguje. Priznanie, nie verdikt → `idle`.
   *   shop ho neprijal — VIEME, že nefunguje → `critical`.
   *   čoskoro vyprší   — VIEME, že funguje, ale nie dlho → `attention`.
   *
   * Zelená patrí jedinému stavu: shop kľúč potvrdil A čas mu nedochádza.
   * Na povrch nesmie ísť vnútorný kód ani príčina (K10, P8) — appka tu vie ČO,
   * nie PREČO; prečo sa overiť nedalo, hovorí `verifyNote` z `/api/key`.
   */
  const verified = meta.verifyStatus;
  if (verified === 'invalid') return { label: 'shop ho neprijal', tone: 'critical' };
  if (verified === 'forbidden') return { label: 'shop mu prístup zakázal', tone: 'critical' };
  if (verified === 'unverified' || verified === null) {
    return { label: 'vložený, ale neoverený', tone: 'idle' };
  }
  if (verified !== 'valid') {
    // Server je za typom, ale za behu cezeň dorazí čokoľvek. Neznámy kód sa
    // PRIZNÁ — nikdy sa mlčky nepovažuje za platnosť.
    return { label: 'vložený, stav neznámy', tone: 'attention' };
  }

  const left = meta.secondsLeft;
  if (left === null) return { label: 'vložený, platnosť neznáma', tone: 'attention' };
  if (left <= 0) return { label: 'už neplatí', tone: 'critical' };
  if (left < KEY_WARNING_HOURS * 3600) return { label: 'vložený, čoskoro vyprší', tone: 'attention' };
  return { label: 'vložený a platný', tone: 'good' };
}

/** Stav kľúča na zápis, o ktorom appka VIE, že sa s ním zapisovať nedá. */
export interface WriteKeyBlock {
  readonly tone: StatusTone;
  /** Slovo do značky. Ten istý slovník ako `keyRowState`, len samostatne. */
  readonly word: string;
}

/**
 * Blokuje chýbajúci alebo nepoužiteľný kľúč na zápis? Čistá funkcia.
 *
 * `null` znamená „appka netvrdí nič" a je to väčšina prípadov — nie preto, že
 * je všetko v poriadku, ale preto, že tvrdenie „toto je zablokované" musí
 * stáť na ZMERANOM stave (I11). Vracia sa preto len pri troch veciach, ktoré
 * appka naozaj vie: kľúč nie je uložený, shop ho odmietol, alebo mu prešla
 * platnosť.
 *
 * PREČO NEOVERENÝ KĽÚČ TU NIE JE
 * ------------------------------
 * `unverified` znamená „NEVIEME, či funguje" (pozri `keyRowState`). Kľúč,
 * ktorý shop nikdy nepotvrdil, môže zapisovať aj nemusí — a veta „zápisy sú
 * zablokované" by z priznania urobila verdikt. Riadok tabuľky ten stav
 * hovorí; táto značka o ňom mlčí zámerne.
 *
 * Poradie je dôležité: odmietnutie shopom sa číta PRED časom, rovnako ako
 * v `keyRowState` — „shop ho neprijal" je dôležitejšia správa než „a navyše
 * mu vypršala platnosť". Platnosť sa naopak kontroluje bez ohľadu na overenie:
 * uplynutý čas je meraný fakt, nie domnienka.
 */
export function writeKeyBlock(meta: KeyMetaView | null): WriteKeyBlock | null {
  if (meta?.present !== true) return { tone: 'critical', word: 'Kľúč na zápis chýba' };
  if (meta.verifyStatus === 'invalid') {
    return { tone: 'critical', word: 'Shop kľúč na zápis neprijal' };
  }
  if (meta.verifyStatus === 'forbidden') {
    return { tone: 'critical', word: 'Shop kľúču na zápis zakázal prístup' };
  }
  /* Turbopack tu už raz zahodil skrátený guard — porovnáva sa výslovne. */
  if (meta.secondsLeft !== null && meta.secondsLeft <= 0) {
    return { tone: 'critical', word: 'Kľúč na zápis už neplatí' };
  }
  return null;
}

/**
 * Priznanie „bez tohto kľúča appka nezapíše a nedopĺňa" — stav, nie odstavec.
 *
 * Samostatný komponent zámerne: vzniká zo stavu, ktorý statický render celej
 * sekcie nemusí mať, a bez pomenovaného uzla by sa dal zmerať len hľadaním
 * slov v celom markupe (to isté poučenie ako pri `key-row-*-state`).
 *
 * Obe veci, ktoré sa zastavia, sú vymenované MENOM: zápis zľavy do eshopu
 * a dávka obohacovania katalógu. Tretia veta hovorí, čo appka robí ďalej —
 * bez nej vyzerá chýbajúci kľúč ako porucha celej appky, a to nie je pravda.
 */
export function WriteKeyBlocked({ block }: { block: WriteKeyBlock }) {
  return (
    <div className={styles.blocked} data-testid="keys-write-blocked">
      <ToneBadge tone={block.tone} data-testid="keys-write-blocked-state">
        {block.word}
      </ToneBadge>
      <p>
        Bez neho sa nedá zapísať ani jeden produkt a dávka obohacovania katalógu
        nemá čím čítať — podrobnosti o produktoch preto zostávajú s pomlčkami.
        Ostatné appka robí ďalej: číta katalóg, počíta predajnosť a zľavu
        pripraví na potvrdenie. Vlož kľúč v riadku <b>Zápis zliav</b> nižšie;
        fronta potom pokračuje tam, kde stojí.
      </p>
    </div>
  );
}

export interface KeysSectionProps {
  writeKey: KeyMetaView | null;
  ordersKey: KeyMetaView | null;
  onStored: () => void;
}

interface KeyRowProps {
  label: string;
  purpose: string;
  meta: KeyMetaView | null;
  open: boolean;
  onToggle: () => void;
  testId: string;
}

function KeyRow({ label, purpose, meta, open, onToggle, testId }: KeyRowProps) {
  const present = meta?.present === true;
  const state = keyRowState(meta);
  return (
    <tr data-testid={testId}>
      <td className="name">
        {label}
        <div className="lvl-3">{purpose}</div>
      </td>
      <td data-l="Platí do">
        {present && meta?.expiresAt !== null && meta?.expiresAt !== undefined ? (
          <>
            {formatDateSk(meta.expiresAt)}{' '}
            <span className="lvl-3">
              (<Countdown expiresAt={meta.expiresAt} expiredLabel="už neplatí" />)
            </span>
          </>
        ) : (
          <span className="lvl-3">—</span>
        )}
      </td>
      <td data-l="Stav">
        {/* Pomenovaný uzol: bez `data-testid` sa stav kľúča nedá zmerať inak
            než hľadaním slova v celom markupe, a taký test prežije aj to, keď
            sa slovo presunie do iného riadka tabuľky. */}
        <span className={TONE_SIG_CLASS[state.tone]} data-testid={`${testId}-state`}>
          <ToneSigMark tone={state.tone} />
          {state.label}
        </span>
        {present && meta?.last4 !== null && meta?.last4 !== undefined ? (
          <div className="lvl-3">končí na {meta.last4}</div>
        ) : null}
        {/* Slovo hovorí ČO, veta hovorí, čo s tým. Bez nej sa pri zablokovanej
            adrese nedá tušiť, že nový kľúč nepomôže — a človek by ho skúšal
            vkladať znova a znova. */}
        {present && typeof meta?.verifyNote === 'string' ? (
          <div className="lvl-3" data-testid={`${testId}-verify-note`}>
            {meta.verifyNote}
          </div>
        ) : null}
      </td>
      <td className="act">
        {/* Formulár sa otvorí AŽ POD tabuľkou, za dvoma odsekmi textu — medzi
            tlačidlom a tým, čo otvorilo, nie je na obrazovke nič, čo by ich
            spojilo. `aria-expanded` a `aria-controls` sú to spojenie; meniaci
            sa nápis („Vložiť" → „Zavrieť") hovorí len to, čo tlačidlo urobí,
            nie že niečo je otvorené a kde to je. */}
        <Button
          small
          aria-expanded={open}
          aria-controls={`${testId}-form`}
          onClick={onToggle}
          data-testid={`${testId}-toggle`}
        >
          {open ? 'Zavrieť' : present ? 'Obnoviť' : 'Vložiť'}
        </Button>
      </td>
    </tr>
  );
}

export function KeysSection({ writeKey, ordersKey, onStored }: KeysSectionProps) {
  /**
   * Keď kľúč na zápis CHÝBA, formulár je otvorený hneď. Je to najčastejší
   * dôvod, prečo sem človek prišiel, a schovať vtedy pole za ďalší klik by
   * bolo úradníctvo. Keď kľúč je, riadok zostane zbalený — obnova je výnimka.
   */
  const [open, setOpen] = useState<OpenForm>(writeKey?.present === true ? null : 'write');

  const toggle = (which: Exclude<OpenForm, null>) =>
    setOpen((current) => (current === which ? null : which));

  /* Route posiela to isté porovnanie v oboch odpovediach, takže je jedno,
   * z ktorého riadka sa prečíta — a keby jedno chýbalo (staršia odpoveď),
   * použije sa druhé. */
  const sameKeyNote = writeKey?.sameKeyNote ?? ordersKey?.sameKeyNote ?? null;

  /* Priznanie stojí NAD tabuľkou: je to dôsledok, a dôsledok sa čita skôr než
     riadok, ktorý ho spôsobil. `null` = appka netvrdí nič (viď `writeKeyBlock`). */
  const blocked = writeKeyBlock(writeKey);

  return (
    <Panel id="kluce" className={styles.section} data-testid="keys-section">
      <PanelHead title="Kľúče" subtitle="Zápis platí 48 hodín · objednávky 30 dní" />
      <PanelBody>
        {blocked === null ? null : <WriteKeyBlocked block={blocked} />}

        <div className="tbl-frame">
          <table className="tbl plain">
            <thead>
              <tr>
                <th>Kľúč</th>
                <th>Platí do</th>
                <th>Stav</th>
                <th className="act" />
              </tr>
            </thead>
            <tbody>
              <KeyRow
                label="Zápis zliav"
                purpose="ním appka zlacňuje produkty"
                meta={writeKey}
                open={open === 'write'}
                onToggle={() => toggle('write')}
                testId="key-row-write"
              />
              <KeyRow
                label="Objednávky"
                purpose="ním appka zisťuje, čo sa predáva"
                meta={ordersKey}
                open={open === 'orders'}
                onToggle={() => toggle('orders')}
                testId="key-row-orders"
              />
            </tbody>
          </table>
          <div className="tbl-foot">
            <span>Kľúče sú uložené zašifrované. Nikdy sa nezobrazia ani nezapíšu do histórie.</span>
          </div>
        </div>

        {/* Jeden kľúč v oboch slotoch. Veta stojí RAZ pod tabuľkou, nie v oboch
            riadkoch: je to tvrdenie o tej dvojici, nie o jednom kľúči, a v každom
            riadku by to bolo to isté povedané dvakrát. Zdroj je `sameKeyNote`
            z `/api/key`, aby obidva riadky nemohli hovoriť inak. */}
        {typeof sameKeyNote === 'string' ? (
          <Note testId="keys-same-key-note">{sameKeyNote}</Note>
        ) : null}

        <Note testId="keys-expiry-note">
          <b>Keď kľúč na zápis vyprší:</b> fronta sa zastaví a počká, <b>nič sa nestratí</b>
          {' '}a zľavy, ktoré už v eshope sú, tam zostanú a dobehnú. Appka si nový kľúč
          nevypýta sama a nevyrobí ho — vygeneruješ ho v eshope a vložíš sem tlačidlom
          <b> Obnoviť</b>. Fronta potom pokračuje presne tam, kde stála, a zľavy, ktoré na
          kľúč čakali a sú ešte vo svojom okne, appka dopíše sama. Kľúč na zápis platí
          48 hodín od vloženia, kľúč na objednávky 30 dní — dlhšiu platnosť nastaviť
          nevieme, je to pravidlo eshopu.
        </Note>

        {open === 'write' ? (
          <div className="set-form" id="key-row-write-form">
            <ApiKeyForm
              keyMeta={writeKey}
              onStored={() => {
                setOpen(null);
                onStored();
              }}
            />
          </div>
        ) : null}

        {open === 'orders' ? (
          <div className="set-form" id="key-row-orders-form">
            <OrdersKeyForm
              keyMeta={ordersKey}
              onStored={() => {
                setOpen(null);
                onStored();
              }}
            />
          </div>
        ) : null}

        <details className="tech">
          <summary>Technický detail</summary>
          <div className="body">
            <table>
              <tbody>
                <tr>
                  <td className="mono">shop_write</td>
                  <td className="mono">
                    {writeKey?.present === true
                      ? `vložený ${formatDateTimeSk(writeKey.savedAt)} · exp ${formatDateTimeSk(writeKey.expiresAt)} · sonda ${writeKey.verifyStatus ?? '—'}`
                      : 'nie je uložený'}
                  </td>
                </tr>
                <tr>
                  <td className="mono">orders_read</td>
                  <td className="mono">
                    {ordersKey?.present === true
                      ? `vložený ${formatDateTimeSk(ordersKey.savedAt)} · exp ${formatDateTimeSk(ordersKey.expiresAt)} · sonda ${ordersKey.verifyStatus ?? '—'}`
                      : 'nie je uložený'}
                  </td>
                </tr>
                <tr>
                  <td>Šifrovanie</td>
                  <td className="mono">AES-256-GCM, master key mimo obrazu aj zálohy</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </PanelBody>
    </Panel>
  );
}

export default KeysSection;
