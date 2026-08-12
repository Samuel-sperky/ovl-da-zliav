'use client';

/**
 * Aura Zľavy — ŽIVÝ STAV NA JEDNOM MIESTE (V9; kontrakt dokončenia C1).
 *
 * Sekcia odpovedá na jedinú otázku: **čo appka práve robí a čím je obmedzená.**
 * Používateľ to doteraz zisťoval z logov — pritom všetky fakty už existujú,
 * len boli rozsypané po štyroch endpointoch a troch obrazovkách.
 *
 * Presne štyri merateľné veci hore (pilulka, pilulka, prúžok, prúžok) a tri
 * riadky o tom, čo sa deje, dole. Piaty prvok sem nepribúda — Prehľad má
 * odpovedať do troch sekúnd, nie byť druhými Nastaveniami.
 *
 *   spojenie so shopom · kľúč na zápis   →  `StatusPill`
 *   zápisy dnes · načítanie katalógu     →  `BudgetMeter`
 *   ostré zápisy · rozsah · katalóg      →  riadky so značkou `.sig`
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Nič sa tu nerozhoduje.** Tóny, slová aj vety prichádzajú hotové
 *    z `live-status-model.ts`, ktorý má testy bez prehliadača. Podmienka
 *    dopísaná do JSX by sa nedala overiť inak než klikaním.
 * 2. **Prázdno sa nekreslí ako nula.** Keď rozpočet alebo katalóg nepoznáme,
 *    prúžok sa VYNECHÁ a na jeho mieste stojí veta, prečo. Prúžok na nule je
 *    tvrdenie o produkčnom eshope, ktoré appka nemá čím podložiť (P7).
 * 3. **Primitíva sa neduplikujú.** `BudgetMeter`, `StatusPill` a `Note` sú
 *    hotové (`components/ui/`); vlastná variácia tej istej veci by sa s nimi
 *    o mesiac rozišla.
 * 4. **Merací prúžok katalógu zmizne, keď je katalóg celý.** Dôvod je
 *    v `catalogMeter()` — `BudgetMeter` by pri 100 % napísal „strop vyčerpaný",
 *    čo je pri katalógu presný opak pravdy.
 *
 * Vlastník: V9.
 */
import Link from 'next/link';

import styles from '@/components/dashboard/overview.module.css';
import {
  pathLabel,
  sigClass,
  type ActivityLine,
  type LiveStatusView,
} from '@/components/dashboard/live-status-model';
import BudgetMeter from '@/components/ui/BudgetMeter';
import Note from '@/components/ui/Note';
import StatusPill from '@/components/ui/StatusPill';

export interface LiveStatusSectionProps {
  view: LiveStatusView;
}

/** Jeden riadok „čo sa deje": značka, popis, veta a prípadná cesta ďalej. */
function Line({ line }: { line: ActivityLine }) {
  return (
    <div className={styles.stateRow} data-testid="live-line" data-line={line.id}>
      <span className={sigClass(line.tone)}>{line.word}</span>
      <span className="lvl-2">
        <b>{line.label}</b> — {line.text}
      </span>
      {line.path === null ? (
        <span />
      ) : (
        <Link className="btn sm" href={line.path}>
          {pathLabel(line.path)}
        </Link>
      )}
    </div>
  );
}

export function LiveStatusSection({ view }: LiveStatusSectionProps) {
  return (
    <section className="sec" data-testid="overview-live-status">
      <div className="sec-h">
        <h2>Živý stav</h2>
        <div className="act">
          <span className={sigClass(view.heartbeat.tone)} data-testid="live-heartbeat">
            {view.heartbeat.word}
          </span>
          <span className="lvl-3">{view.heartbeat.detail}</span>
        </div>
      </div>

      <div className={styles.liveTop}>
        {/*
          Bez `live`: pilulky sa obnovujú každú minútu a čítačka by pri každom
          otočení času posledného čítania skočila do reči. Hlásiť zmenu stavu
          patrí hlavičke, ktorá je na obrazovke vždy — tento panel číta človek,
          ktorý sa naň práve pozerá.
        */}
        <StatusPill
          tone={view.shop.tone}
          label={view.shop.label}
          detail={view.shop.detail}
          testId="live-shop"
        />
        <StatusPill
          tone={view.key.tone}
          label={view.key.label}
          detail={view.key.detail}
          testId="live-key"
        />

        {view.writeBudget === null ? (
          <div className="lvl-3" data-testid="live-budget-unknown">
            Koľko zápisov dnes odišlo, sa nepodarilo zistiť — číslo nedopĺňame.
          </div>
        ) : (
          <BudgetMeter
            label="Zápisy dnes"
            spent={view.writeBudget.spent}
            limit={view.writeBudget.limit}
            resetsAt={view.budgetResetsAt}
            large
            testId="live-budget"
          />
        )}

        {view.catalogFill === null ? (
          <div className="lvl-3" data-testid="live-catalog-fill-none">
            Naplnenie katalógu ukazujeme, kým sa dočítava.
          </div>
        ) : (
          <BudgetMeter
            label="Katalóg"
            spent={view.catalogFill.spent}
            limit={view.catalogFill.limit}
            large
            testId="live-catalog-fill"
          />
        )}
      </div>

      <div className={styles.stateList}>
        {view.lines.map((line) => (
          <Line key={line.id} line={line} />
        ))}
      </div>

      {view.gap === null ? null : (
        <div className={styles.gapNote}>
          <Note variant="warn" testId="live-gap">
            {view.gap}
          </Note>
        </div>
      )}
    </section>
  );
}

export default LiveStatusSection;
