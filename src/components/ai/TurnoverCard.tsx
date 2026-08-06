/**
 * Aura Zľavy — V2: zamknutá karta „Obrátkovosť" (plán 33 §4, sekcia C3).
 *
 * Samuel chce návrhy kampaní podľa obrátkovosti `(Ø zásoba × počet dní) / COGS`.
 * Dnes sa vzorec vypočítať NEDÁ a táto karta to hovorí presne — čo chýba,
 * odkiaľ by to muselo prísť a kto o tom rozhoduje. NIČ tu nepredstiera dáta,
 * ktoré appka nemá (I11); predaje by navyše vyžadovali scope na čítanie
 * objednávok, ktorý je vylúčený rozhodnutím 8 a vynucovaný I8.
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
        Výpočet sa dnes NEDÁ urobiť — chýbajú tri vstupy:
      </p>
      <ol className="ovl-small" style={{ margin: 0, paddingLeft: '1.25rem' }}>
        <li>
          <strong>COGS</strong> — shop API ho neposkytuje vôbec (požiadavka je v backlogu na
          maintainera shopu).
        </li>
        <li>
          <strong>Zásoba nevariantných produktov</strong> — API vracia množstvá len pri variantoch
          (backlog na maintainera).
        </li>
        <li>
          <strong>Predaje</strong> — vyžadujú scope na čítanie objednávok, ktorý appka rozhodnutím
          nemá; zmena je na Samuelovi a znamenala by nový kľúč s týmto oprávnením.
        </li>
      </ol>
      <p className="ovl-small ovl-muted" style={{ margin: '0.75rem 0 0' }}>
        Karta sa odomkne, keď budú vstupy k dispozícii — dovtedy appka obrátkovosť nepočíta ani
        neodhaduje.
      </p>
    </section>
  );
}

export default TurnoverCard;
