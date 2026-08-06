/**
 * Aura Zľavy — V2: zamknutá karta „Obrátkovosť" (plán 33 §4, sekcia C3).
 *
 * Samuel chce návrhy kampaní podľa obrátkovosti `(Ø zásoba × počet dní) / COGS`.
 * Dnes sa vzorec vypočítať NEDÁ a táto karta to hovorí presne — čo chýba,
 * odkiaľ by to muselo prísť a kto o tom rozhoduje. NIČ tu nepredstiera dáta,
 * ktoré appka nemá (I11).
 *
 * Aktualizované 6.8.2026 (KONTRAKT-PREDAJNOST): **predaje už nechýbajú** —
 * appka pozná počet predaných kusov a zobrazuje ho na karte „Predajnosť".
 * Chýbajú stále dva vstupy zo strany shopu: COGS a zásoba nevariantných
 * produktov. Karta preto zostáva ZAMKNUTÁ a dopočítavať COGS z predajnej
 * ceny je zakázané — bol by to vymyslený vstup, nie odhad.
 */

export function TurnoverCard() {
  return (
    <section className="ovl-card ovl-view-in" data-testid="ai-turnover-card" aria-disabled="true">
      <div className="ovl-spread" style={{ alignItems: 'baseline' }}>
        <h2 style={{ margin: 0 }}>Obrátkovosť</h2>
        <span className="ovl-badge ovl-badge--idle">
          <span className="ovl-badge-glyph" aria-hidden="true">
            ○
          </span>
          zamknuté — chýbajú dáta
        </span>
      </div>

      <p className="ovl-small" style={{ margin: '0.75rem 0 0.5rem' }}>
        Cieľ: navrhovať kampane podľa obrátkovosti zásob v tvare, ako ho zadal Samuel:
      </p>
      <p
        className="ovl-num"
        style={{ margin: '0 0 0.75rem', fontSize: '1.05rem' }}
        data-testid="turnover-formula"
      >
        obrátkovosť = (Ø zásoba × počet dní) / COGS
      </p>

      <p className="ovl-small ovl-muted" style={{ margin: '0 0 0.35rem' }}>
        Výpočet sa dnes NEDÁ urobiť — chýbajú dva vstupy a oba musia prísť od maintainera shopu:
      </p>
      <ol className="ovl-small" style={{ margin: 0, paddingLeft: '1.25rem' }}>
        <li data-testid="turnover-missing-cogs">
          <strong>COGS</strong> — nákupná cena. Shop API ju neposkytuje vôbec, žiadnym endpointom.
          Dopočítať ju z predajnej ceny by bol vymyslený vstup, preto to appka nerobí. Požiadavka je
          v backlogu na maintainera shopu.
        </li>
        <li data-testid="turnover-missing-stock">
          <strong>Zásoba nevariantných produktov</strong> — API vracia množstvá len pri variantoch,
          takže pri produkte bez variantov appka zásobu nepozná. Tiež backlog na maintainera shopu.
        </li>
      </ol>
      <p className="ovl-small" style={{ margin: '0.75rem 0 0' }} data-testid="turnover-sales-ok">
        <strong>Predaje už nechýbajú.</strong> Appka pozná počet predaných kusov na produkt a
        zobrazuje ho na karte <strong>Predajnosť</strong>. Predajnosť ale obrátkovosť NIE JE: je to
        počet kusov, nie pomer zásoby k nákladom — a peniaze na produkt sa priradiť nedajú, lebo
        zaplatená suma patrí celej objednávke, nie položke.
      </p>
      <p className="ovl-small ovl-muted" style={{ margin: '0.75rem 0 0' }}>
        Karta sa odomkne, keď shop začne poskytovať COGS a zásobu nevariantných produktov — dovtedy
        appka obrátkovosť nepočíta ani neodhaduje.
      </p>
    </section>
  );
}

export default TurnoverCard;
