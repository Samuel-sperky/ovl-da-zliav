'use client';

/**
 * Aura Zľavy — `/onboarding` (V12; architektúra §1 „Vedľajšie obrazovky").
 *
 * PREČO TU UŽ NIE JE SPRIEVODCA
 * -----------------------------
 * Pôvodne tu bol štvorkrokový sprievodca, ktorý končil skúšobným prepočtom.
 * Architektúra V3 ho ruší: onboarding sú **len prázdne stavy s odkazmi**.
 * Dôvod je praktický — sprievodca sa prejde raz, potom je z neho mŕtva
 * obrazovka, a pritom presne tie isté kroky musia byť dohľadateľné aj neskôr,
 * keď kľúč vyprší alebo sa katalóg vyprázdni. Preto tu nie sú kroky, ale tri
 * karty, ktoré vedú tam, kde sa vec naozaj vybavuje.
 *
 * Stránka NIČ nezapisuje ani neprepočítava. Číta dve veci — nastavenia a stav
 * kľúča — a keď ich prečítať nevie, povie to a odkazy nechá funkčné. Prvý ostrý
 * zápis sa robí výhradne v Zľavách a vždy po samostatnom potvrdení.
 *
 * Vlastník: V12.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { SigMark } from '@/components/ui/StatusMark';

import {
  getKeyMeta,
  getSettings,
  type KeyMetaView,
  type SettingsView,
} from '@/components/settings/api';

/** Stav jednej karty. `null` = ešte nevieme, a to sa nesmie tváriť ako „chýba". */
type Ready = boolean | null;

function Sig({ ready, doneLabel, todoLabel }: { ready: Ready; doneLabel: string; todoLabel: string }) {
  if (ready === null)
    return (
      <span className="sig idle">
        <SigMark variant="idle" />
        zisťujem
      </span>
    );
  return ready ? (
    <span className="sig ok">
      <SigMark variant="ok" />
      {doneLabel}
    </span>
  ) : (
    <span className="sig warn">
      <SigMark variant="warn" />
      {todoLabel}
    </span>
  );
}

export default function OnboardingPage() {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [keyMeta, setKeyMeta] = useState<KeyMetaView | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [s, k] = await Promise.all([getSettings(), getKeyMeta()]);
      if (!alive) return;
      setSettings(s.ok ? s.data : null);
      setKeyMeta(k.ok ? k.data : null);
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const hasDomain: Ready = loaded ? settings !== null && settings.shopDomain !== null : null;
  const hasKey: Ready = loaded ? keyMeta !== null && keyMeta.present : null;

  return (
    <div data-testid="onboarding">
      <div className="grid3">
        <section className="sec">
          <div className="sec-h">
            <h2>Adresa eshopu</h2>
            <div className="act">
              <Sig ready={hasDomain} doneLabel="nastavená" todoLabel="chýba" />
            </div>
          </div>
          <div className="empty">
            <div className="t">Kam má appka písať</div>
            {/*
              28. 8. 2026 (D106): PUT /api/settings/domain si vypýta výslovné
              `confirmed: true` zo zaškrtávacieho poľa — heslo (D80) zmazalo
              D99 a bez akejkoľvek brány by adresu, na ktorú appka posiela
              produkčný API kľúč, prepísal jeden tichý POST. Druhou brzdou
              zostáva canary čítanie proti novej adrese (D55): keď zlyhá,
              adresa sa NEULOŽÍ.
            */}
            <div>
              Jedna adresa pre celú appku. Zmena si vyžiada potvrdenie a uloží sa až
              po úspešnom testovacom čítaní.
            </div>
            <div className="a">
              <Link className="btn primary" href="/nastavenia#pripojenie">
                Nastaviť adresu
              </Link>
            </div>
          </div>
        </section>

        <section className="sec">
          <div className="sec-h">
            <h2>Kľúč na zápis zliav</h2>
            <div className="act">
              <Sig ready={hasKey} doneLabel="vložený" todoLabel="chýba" />
            </div>
          </div>
          <div className="empty">
            <div className="t">Bez kľúča appka nezapíše nič</div>
            <div>Fronta počká, nič sa nestratí.</div>
            <div className="a">
              <Link className="btn primary" href="/nastavenia#kluce">
                Vložiť kľúč
              </Link>
              <Link className="btn" href="/nastavenia#rozpocet">
                Rozpočet zápisov
              </Link>
            </div>
          </div>
        </section>

        <section className="sec">
          <div className="sec-h">
            <h2>Prvá zľava</h2>
            <div className="act lvl-3">posledný krok</div>
          </div>
          <div className="empty">
            <div className="t">Začnite tým, čo sa nepredáva</div>
            <div>Výber produktov, pásma a potvrdenie počtu ručne.</div>
            <div className="a">
              <Link className="btn primary" href="/zlavy">
                Prejsť na Zľavy
              </Link>
              <Link className="btn" href="/produkty">
                Nájsť ležiaky
              </Link>
            </div>
          </div>
        </section>
      </div>

      <p className="fresh">
        Táto stránka nič nezapisuje. Prvý zápis do eshopu urobíte vedome
        v Zľavách a vždy po samostatnom potvrdení.
      </p>
    </div>
  );
}
