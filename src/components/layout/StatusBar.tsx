'use client';

/**
 * Aura Zľavy — STAVOVÝ PRUH (kontrakt UI 13. 8. 2026, body 1–5).
 *
 * Pruh je CHRÓM, nie sekcia: do P4 (výška obrazovky) ani do P5 (počet sekcií)
 * sa nepočíta a za to platí tvrdú cenu — musí ostať JEDEN RIADOK. Nesie presne
 * štyri veci a v tomto poradí:
 *
 *     ✓ Ostrý zápis zapnutý · ✓ Kľúč do 09.09.2026 · ○ Zápisy 21/200 dnes ·
 *     ○ Katalóg 2 900 z 41 082                        Stav k 12:53 · [Obnoviť]
 *
 * Sú to štyri otázky, na ktoré sa inak odpovedalo z logov alebo z databázy:
 * či appka smie zapisovať, dokedy platí kľúč, koľko zápisov dnes ostáva a kde
 * je katalóg. Piata vec sem nepatrí — ani stav fronty (ten je v hlavičke), ani
 * dôvod zámku tabu (ten visí pri tabe), ani rozpad rozpočtu (ten je
 * v Nastaveniach).
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Jeden riadok, pevná výška.** `--ovl-statusbar-h` nie je kozmetika:
 *    `--ovl-chrome-h` z nej počíta odsadenie lepkavých prvkov obrazoviek
 *    (bočný panel, kotvy v Nastaveniach). Obsah sa preto nezalamuje — keď sa
 *    nezmestí, vodorovne sa posúva. Aj rozklik „Prečo —" sa otvára NAD obsah
 *    stránky, nie do výšky pruhu.
 *
 * 2. **Ticho je stav.** Menovka v poriadku (`good`, `idle`) je len značka
 *    a text v tlmenej farbe; plnú pilulku dostane výhradne to, čo si žiada
 *    pozornosť (`attention`, `critical`). Keby boli všetky štyri farebné
 *    pilulky, pruh by kričal aj vtedy, keď je všetko v poriadku — a prestalo
 *    by sa naň pozerať práve vtedy, keď na tom záleží. Zelená značka pri
 *    zápisoch je celá „zelená značka" z bodu 3 kontraktu: keď nič neprekáža,
 *    obrazovka NEKRESLÍ sekciu prekážok a stačí ona.
 *
 * 3. **Nič sa tu neobnovuje samo.** Čísla prídu pri otvorení obrazovky a potom
 *    až po stlačení tlačidla Obnoviť (bod 4 kontraktu). Tlačidlo je tu jediné
 *    pre celú appku a obnoví VŠETKO naraz — obrazovky si vlastné nekreslia.
 *    Vedľa neho stojí čas, ku ktorému čísla platia, aby sa dalo poznať staré
 *    číslo od nového.
 *
 * 4. **Kým stav nepoznáme, nekreslia sa štyri menovky „nevieme".** Pri načítaní
 *    a pri nedostupnej appke je v pruhu JEDNA pilulka a JEDNA veta, ktorá
 *    povie prečo. (Do 27. 8. 2026 sem patrila aj prihlasovacia obrazovka —
 *    zmizla s D99.) Štyri neznáme hodnoty vyzerajú
 *    ako štyri poruchy. Tlačidlo Obnoviť zostáva aj vtedy — práve vtedy je
 *    najpotrebnejšie.
 *
 * 5. **Čo appka nevie, je POMLČKA, nikdy nula** (bod 5 kontraktu). Dôvod nie je
 *    na povrchu: menovky s pomlčkou sa pozbierajú do jedného rozkliku
 *    „Prečo —" (P6). Rozklik sa objaví len vtedy, keď je čo vysvetľovať.
 *
 * 6. **Nič sa tu nepočíta ani nepomenúva.** Tóny, menovky aj vety prichádzajú
 *    z `layout/status.ts`, ktorý ich odvodzuje z prekážok servera. Tu je len
 *    značkovanie. Kto sem pridá `if` nad číslami, rozdvojí pravdu.
 *
 * Vlastník: L1.
 */
import { useRefreshBus } from '@/components/layout/refresh';
import {
  budgetChip,
  catalogChip,
  connectionChip,
  keyChip,
  statusFreshness,
  writesChip,
  type StatusChip,
  type StatusState,
} from '@/components/layout/status';
import Icon from '@/components/ui/Icon';
import StatusPill from '@/components/ui/StatusPill';
import ToneBadge, { TONE_ICON } from '@/components/ui/ToneBadge';

/**
 * Jedna zo štyroch vecí v pruhu. Pozornosť si pýta tvarom, nie veľkosťou:
 * pokojný stav je značka a text, nepokojný celá pilulka (pozri bod 2).
 */
function Fact({ chip, testId }: { chip: StatusChip; testId: string }) {
  const loud = chip.tone === 'attention' || chip.tone === 'critical';
  return (
    <span
      className="ovl-sbar-cell"
      data-tone={chip.tone}
      data-testid={testId}
      title={chip.title}
    >
      {loud ? (
        <ToneBadge tone={chip.tone} icon={chip.icon}>
          {chip.label}
        </ToneBadge>
      ) : (
        <>
          <Icon className="ovl-sbar-mark" name={chip.icon ?? TONE_ICON[chip.tone]} size={0.9} />
          {chip.label}
        </>
      )}
    </span>
  );
}

/**
 * Čas, ku ktorému čísla platia, a jediné tlačidlo Obnoviť v celej appke.
 * Vykresľuje sa VŽDY — aj keď appka neodpovedá, lebo práve vtedy je jediným
 * spôsobom, ako to skúsiť znova.
 */
function Tail({ state }: { state: StatusState }) {
  const fresh = statusFreshness(state);
  const { busy, refresh } = useRefreshBus();

  return (
    <div className="ovl-sbar-tail">
      <span className="ovl-sbar-fresh" title={fresh.title} data-testid="status-freshness">
        Stav k {fresh.label}
      </span>
      <button
        type="button"
        className="ovl-sbar-refresh"
        onClick={refresh}
        disabled={busy}
        data-testid="status-refresh"
        title="Načíta čísla na tejto obrazovke znova. Appka ich sama neprepisuje."
      >
        {busy ? 'Obnovuje sa' : 'Obnoviť'}
      </button>
    </div>
  );
}

/** Dôvody pomlčiek — jedno miesto, pod rozklikom, nikdy na povrchu (P6). */
function WhyDash({ chips }: { chips: readonly StatusChip[] }) {
  return (
    <details className="ovl-sbar-why" data-testid="status-why">
      <summary aria-label="Prečo appka niektoré čísla nevie">Prečo —</summary>
      <div className="ovl-sbar-why-panel">
        <ul>
          {chips.map((chip) => (
            <li key={chip.label}>
              <b>{chip.label}</b>
              <span>{chip.title}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

/**
 * Kde sa pruh kreslí — a teda ktoré fakty nesie.
 *
 * Kostra z 19. 8. 2026 rozdelila chróm: prevádzkové fakty, ktoré sa menia
 * počas práce (zápisy, katalóg), zostali v topbare nad obsahom. Trvalé
 * fakty (dokedy platí kľúč, koľko zápisov dnes ostáva) odišli do päty
 * ľavého panela, lebo to nie sú správy, ale stav nástroja — a v topbare
 * spôsobovali, že sa štyri menovky na 1280 px navzájom odsekli.
 *
 * Je to JEDEN komponent a JEDNO čítanie stavu. Dve kópie pruhu by sa raz
 * rozišli a appka by o tom istom fakte hovorila na dvoch miestach inak.
 */
export type StatusPlace = 'topbar' | 'side' | 'all';

export interface StatusBarProps {
  state: StatusState;
  place?: StatusPlace;
}

export function StatusBar({ state, place = 'all' }: StatusBarProps) {
  // Bod 4: bez známeho stavu jedna pilulka a jedna veta prečo — a tlačidlo.
  if (state.kind !== 'ok' || state.payload === null) {
    const connection = connectionChip(state);
    return (
      <section className="ovl-statusbar" aria-label="Stav appky" data-testid="status-bar">
        <div className="ovl-statusbar-in">
          <div className="ovl-sbar-facts">
            <StatusPill
              tone={connection.tone}
              label={connection.label}
              live
              testId="status-connection"
            />
            <span className="ovl-statusbar-note">{connection.title}</span>
          </div>
          <Tail state={state} />
        </div>
      </section>
    );
  }

  const payload = state.payload;
  /* `side` nesie trvalé fakty, `topbar` prevádzkové. Poradie sa nemení —
     je súčasťou zvyku a mení sa len to, čo sa vynechá. */
  const all: readonly { chip: StatusChip; testId: string; where: StatusPlace }[] = [
    { chip: writesChip(payload), testId: 'status-writes', where: 'topbar' },
    { chip: keyChip(payload), testId: 'status-key', where: 'side' },
    { chip: budgetChip(payload), testId: 'status-budget', where: 'side' },
    { chip: catalogChip(payload), testId: 'status-catalog', where: 'topbar' },
  ];
  const facts = place === 'all' ? all : all.filter((f) => f.where === place);
  const dashes = facts.map((fact) => fact.chip).filter((chip) => chip.unknown === true);

  return (
    <section className="ovl-statusbar" aria-label="Stav appky" data-testid="status-bar">
      <div className="ovl-statusbar-in">
        <div className="ovl-sbar-facts">
          {facts.map((fact) => (
            <Fact key={fact.testId} chip={fact.chip} testId={fact.testId} />
          ))}
        </div>
        {dashes.length === 0 ? null : <WhyDash chips={dashes} />}
        {place === 'side' ? null : <Tail state={state} />}
      </div>
    </section>
  );
}

export default StatusBar;
