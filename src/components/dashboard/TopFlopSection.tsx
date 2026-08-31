'use client';

/**
 * Aura Zľavy — TOP 10 A FLOP 10 NA PREHĽADE (V4, D113).
 *
 * OTÁZKA: „čo sa predáva a čo leží?" Poradie stojí VÝHRADNE na predaných
 * KUSOCH — tržba per produkt neexistuje, API ceny položiek nevracia (D117),
 * takže tu nie je a nikdy nebude ani jedno euro na produkt.
 *
 * ═══ ČO ZNAMENÁ „FLOP" (a čo NEznamená) ═══
 * Flop je **najslabší Z PREDÁVANÝCH**, nie „nepredáva sa". Produkt bez jediného
 * nameraného predaja do rebríčka NEVSTUPUJE — ani na dno flopu:
 *
 *  · Kým okno nie je celé dočítané, „0 predaných" o ňom nie je meranie (I11).
 *    Postaviť ho na dno by z výpadku sťahovania spravilo najhoršie predávaný
 *    produkt eshopu.
 *  · Aj pri dočítanom okne je „za 30 dní ani jeden kus" INÁ otázka než „ktorý
 *    z predávaných je najslabší". Prvá je zoznam ležiakov a odpovedá na ňu tab
 *    Produkty, kde sa dá filtrovať a stránkovať.
 *
 * Sekcia to musí POVEDAŤ, nie len ticho vynechať — inak vyzerá desať riadkov
 * flopu ako desať najhorších produktov eshopu. Preto tá veta pod zoznamom.
 *
 * ═══ ŽIADNA TABUĽKA ═══
 * Architektúra §1: „Tabuľka produktov — Prehľad NIKDY, Produkty vždy." Toto je
 * ZOZNAM desiatich zistení, nie nástroj na prácu s katalógom: bez zaškrtávania,
 * bez triedenia, bez stránkovania. Stráži to `prehlad.spec.ts`, ktorý v celom
 * `components/dashboard` nedovolí ani jednu tabuľkovú značku. POZOR: ten skener
 * NEODSTRIHUJE komentáre, takže sa tá značka nesmie napísať ani sem — vypísať
 * ju v tejto vete znamená zhodiť test, ktorý vetu popisuje.
 *
 * ═══ POMENOVANIE (D116) ═══
 * Každý riadok ide cez `productLabel()` — „referencia · názov", `#id` až
 * v technickom detaile. Neobohatený produkt referenciu NEMÁ a sekcia to
 * priznáva: nie preto, že by ju nemal shop, ale preto, že sa k nej appka ešte
 * nedostala (D118).
 *
 * ČÍTA LEN LOKÁLNU DB (K8) — dáta prídu hotové z `/api/insights/top-products`.
 *
 * Vlastník: V4.
 */
import Link from 'next/link';

import styles from '@/components/dashboard/overview.module.css';
import type { OverviewWindow, RankRow } from '@/components/dashboard/overview-model';
import type { TopFlopView } from '@/components/dashboard/window-api';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';
import { NEVIEME, productLabel } from '@/lib/ui/product-label';

export interface TopFlopSectionProps {
  /**
   * `null` = odpoveď sa nepodarilo prečítať. `undefined` = ešte sa nenačítala,
   * a to je INÝ stav: „nepodarilo sa" je tvrdenie o appke, kým „ešte nemáme" je
   * tvrdenie o čase. Zliať ich znamená hlásiť poruchu počas načítavania.
   */
  data: TopFlopView | null | undefined;
  windowDays: OverviewWindow;
}

function pieces(value: number): string {
  return `${formatCountSk(value)} ${pluralSk(value, 'kus', 'kusy', 'kusov')}`;
}

function dayCount(value: number): string {
  return `${formatCountSk(value)} ${pluralSk(value, 'deň', 'dni', 'dní')}`;
}

/**
 * Jeden riadok rebríčka.
 *
 * Marža a sklad sú z obohatenia (`getFull`), takže pri neobohatenom produkte
 * NIE SÚ nula — sú pomlčka. `qty: 0` je naopak platná nula: „na sklade nič"
 * je meraný fakt a nesmie sa tváriť ako nevedomosť.
 */
function Row({ row }: { row: RankRow }) {
  const label = productLabel({
    productId: row.productId,
    reference: row.reference,
    name: row.name,
  });

  const facts: string[] = [];
  facts.push(row.qty === null ? `sklad ${NEVIEME}` : `sklad ${formatCountSk(row.qty)}`);
  facts.push(
    row.marginPercent === null ? `marža ${NEVIEME}` : `marža ${row.marginPercent} %`,
  );
  if (row.discountedNow) facts.push('teraz zlacnený');

  return (
    <li className={styles.rankRow} data-testid="rank-row" data-product={row.productId}>
      <Link className={styles.rankName} href={`/produkty?produkt=${row.productId}`}>
        {label.text}
      </Link>
      <span className="num">{pieces(row.units)}</span>
      <span className={styles.rankNote}>
        {label.referenceUnknown
          ? `${label.technical} · kód produktu ešte nemáme · ${facts.join(' · ')}`
          : `${label.technical} · ${facts.join(' · ')}`}
      </span>
    </li>
  );
}

function Column({
  title, rows, empty, testId,
}: {
  title: string;
  rows: readonly RankRow[];
  empty: string;
  testId: string;
}) {
  return (
    <div className={styles.rankCol}>
      <span className="lvl-2">{title}</span>
      {rows.length === 0 ? (
        <div className="lvl-3" data-testid={`${testId}-empty`}>
          {empty}
        </div>
      ) : (
        <ul className={styles.rankList} data-testid={testId}>
          {rows.map((row) => (
            <Row key={row.productId} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Prázdny stav je JEDNA VETA s DÔVODOM, nikdy „žiadne dáta". Prázdny rebríček
 * môže znamenať nedočítané okno alebo príliš veľkú kohortu — a to sú dve rôzne
 * veci s dvomi rôznymi ďalšími krokmi.
 */
function Thin({ reason }: { reason: string }) {
  return (
    <div className={styles.thin} data-testid="overview-rank" data-mode="empty">
      <span className="lvl-2">{`Čo sa predáva — ${reason}`}</span>
      <Link className="btn sm" href="/produkty">
        Otvoriť Produkty
      </Link>
    </div>
  );
}

export function TopFlopSection({ data, windowDays }: TopFlopSectionProps) {
  if (data === undefined) {
    return (
      <div className="sec ovl-skeleton" style={{ minHeight: '160px' }} aria-busy="true" />
    );
  }
  if (data === null) {
    return <Thin reason="rebríček sa nepodarilo načítať." />;
  }
  if (!data.available) {
    return (
      <Thin
        reason={
          data.reason === 'cohort_too_large'
            ? 'predávaných produktov je na poctivé poradie priveľa.'
            : `za ${dayCount(windowDays)} nie je dočítaný ani jeden deň predajov.`
        }
      />
    );
  }

  /*
   * `null` = odpoveď to pole nepovedala. Nula by tvrdila „ani jeden produkt sa
   * nepredáva" a to je tvrdenie, ktoré appka nemá čím kryť (I11).
   */
  const cohort = data.cohortSize;
  const cohortNote =
    cohort === null
      ? `koľko produktov má predaj za ${dayCount(windowDays)}, sa nepodarilo zistiť`
      : `${formatCountSk(cohort)} ${pluralSk(cohort, 'produkt s predajom', 'produkty s predajom', 'produktov s predajom')} za ${dayCount(windowDays)}`;
  /*
   * Priznanie medzery nesmie samo klamať číslom: pri nečitateľnom `gaps`
   * (`unknownDays === null`) sa nepíše „0 dní", ale to, že sa počet dní
   * nezistil (31. 8. 2026).
   */
  const gapNote =
    data.unknownDays === null
      ? 'Koľko dní okna appka nemá celé, sa nepodarilo zistiť — súčty aj poradie sú dolná hranica'
      : `${dayCount(data.unknownDays)} okna appka nemá celé, takže súčty aj poradie sú dolná hranica`;

  return (
    <section className="sec" data-testid="overview-rank" data-mode="data">
      <div className="sec-h">
        <h2>Čo sa predáva</h2>
        <div className="act">
          <span className="lvl-3">{cohortNote}</span>
        </div>
      </div>

      <div className={styles.rankGrid}>
        <Column
          title="Najviac predané"
          rows={data.top}
          empty="Za toto okno nemáme ani jeden nameraný predaj."
          testId="rank-top"
        />
        <Column
          title="Najmenej predané z predávaných"
          rows={data.flop}
          empty="Za toto okno nemáme ani jeden nameraný predaj."
          testId="rank-flop"
        />
      </div>

      {/*
        Dve priznania, obe povinné a obe o inej veci:
         · KOHO sa rebríček netýka (produkt bez predaja) — bez tejto vety je
           flop čitateľný ako „desať najhorších produktov eshopu",
         · AKO ÚPLNÉ je okno — pri nedočítaných dňoch je dolnou hranicou aj
           samotné PORADIE, nie len súčty.
      */}
      <div className="fresh" data-testid="rank-excludes">
        Produkt bez nameraného predaja tu nie je ani v jednom stĺpci — „nula
        predaných" o ňom appka netvrdí. Ležiaky sú v Produktoch.
      </div>

      {data.rankingState === 'measured' ? null : (
        <div className="fresh" data-testid="rank-gap">
          {gapNote}
        </div>
      )}
    </section>
  );
}

export default TopFlopSection;
