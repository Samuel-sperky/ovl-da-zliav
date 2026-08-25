'use client';

/**
 * Aura Zľavy — DIAGNOSTIKA (návrh V3, `nastavenia.html` #diagnostika, odpoveď 83).
 *
 * Jedno tlačidlo. Odpoveď 83 znie „tlačidlo «Stiahnuť diagnostiku»", nie
 * „obrazovka diagnostiky" — takže tu nie sú žiadne živé čísla ani grafy. Kto
 * chce čísla, má Prehľad; toto je vec, ktorú používateľ pošle ďalej.
 *
 * Zoznam „Čo je v súbore" je povinný, nie ozdoba: súbor ide cudziemu človeku,
 * takže používateľ musí PRED odoslaním vedieť, čo v ňom je — a hlavne že v ňom
 * nie sú kľúče ani heslá. Riadky sa berú z `DIAGNOSTICS_CONTENT_ROWS`, teda
 * z toho istého modulu, ktorý súbor skladá. Keby boli vypísané tu, obrazovka
 * a súbor by sa časom rozišli a obrazovka by začala klamať.
 *
 * Od 24. 8. 2026 stojí ten rozpis pod rozklikom (P6) — päť sekcií na jednej
 * podstránke sa inak pod strop P4 nezmestí. To podstatné z neho ostalo na
 * povrchu vetou „Bez kľúčov a hesiel", takže sľub o kľúčoch a heslách sa
 * neschoval; schoval sa len výpočet položiek. Kto tú vetu z povrchu zmaže,
 * spraví z rozkliku podmienku poctivosti a to je zlá výmena.
 *
 * Stiahnutie je `<a download>`, nie `Button` s `fetch`: `Button` je `<button>`
 * a prehliadač si so `Content-Disposition` poradí sám, takže appka nemusí držať
 * obsah súboru v pamäti stránky. Trieda `ovl-btn` je tá istá, akú dáva `Button`,
 * aby odkaz vyzeral ako tlačidlo a nevznikal druhý vzhľad.
 *
 * Vlastník: V3 (dobeh návrhu podľa `docs/53-AUDIT-1-1-V3.md` §C bod 2).
 */
import { DIAGNOSTICS_CONTENT_ROWS } from '@/lib/diagnostics/collect';

export function DiagnosticsSection() {
  return (
    <section className="sec" id="diagnostika" data-testid="diagnostics">
      <div className="sec-h">
        <h2>Diagnostika</h2>
        <div className="act">
          <a
            className="ovl-btn ovl-btn--small"
            href="/api/diagnostics"
            download
            data-testid="diagnostics-download"
          >
            Stiahnuť diagnostiku
          </a>
        </div>
      </div>

      <p>Súbor so stavom appky pre riešenie problému. Bez kľúčov a hesiel.</p>

      {/* Rozpis riadok po riadku je pod rozklikom (P6). Na POVRCHU zostáva to
          jediné, čo musí človek vedieť PRED odoslaním súboru cudziemu človeku
          — že v ňom nie sú kľúče ani heslá; to hovorí veta nad rozklikom. Kto
          chce vedieť presne, čo v súbore je, rozklik otvorí a nájde ten istý
          zoznam, skladaný z toho istého modulu ako samotný súbor. */}
      <details className="tech">
        <summary>Čo je v súbore</summary>
        <div className="body">
          <table data-testid="diagnostics-contents">
            <tbody>
              {DIAGNOSTICS_CONTENT_ROWS.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

export default DiagnosticsSection;
