'use client';

/**
 * Aura Zľavy — DIAGNOSTIKA (návrh V3, `nastavenia.html` #diagnostika, odpoveď 83).
 *
 * Jedno tlačidlo. Odpoveď 83 znie „tlačidlo «Stiahnuť diagnostiku»", nie
 * „obrazovka diagnostiky" — takže tu nie sú žiadne živé čísla ani grafy. Kto
 * chce čísla, má Prehľad; toto je vec, ktorú používateľ pošle ďalej.
 *
 * Zoznam „Čo súbor obsahuje" je povinný, nie ozdoba: súbor ide cudziemu
 * človeku, takže používateľ musí PRED odoslaním vedieť, čo v ňom je — a hlavne
 * že v ňom nie sú kľúče ani heslá. Riadky sa berú z `DIAGNOSTICS_CONTENT_ROWS`,
 * teda z toho istého modulu, ktorý súbor skladá. Keby boli vypísané tu,
 * obrazovka a súbor by sa časom rozišli a obrazovka by začala klamať.
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

      <div className="tbl-frame">
        <table className="tbl plain">
          <thead>
            <tr>
              <th>Čo súbor obsahuje</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody data-testid="diagnostics-contents">
            {DIAGNOSTICS_CONTENT_ROWS.map((row) => (
              <tr key={row.label}>
                <td className="name">{row.label}</td>
                <td>{row.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default DiagnosticsSection;
