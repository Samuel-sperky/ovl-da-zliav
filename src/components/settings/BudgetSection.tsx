'use client';

/**
 * Aura Zľavy — sekcia ROZPOČET (V12; kontrakt V3, bod K-dva).
 *
 * Eshop dovolí 200 zápisov na deň a 20 za minútu, takže zľava na tisíce
 * produktov nie je akcia, ale fronta bežiaca týždne. Táto sekcia je jediné
 * miesto, kde je rozpočet rozpísaný; v hlavičke je z neho len jedno číslo.
 *
 * TRI VECI, KTORÉ SA TU NESMÚ POKAZIŤ
 * -----------------------------------
 * 1. **Vyčerpaný rozpočet nie je chyba.** Je to informácia, takže má neutrálnu
 *    farbu a vetu „pokračujem zajtra" — nikdy nie červenú a nikdy nie slovo
 *    o zlyhaní.
 * 2. **Neznáme číslo sa nedopĺňa.** Keď server rozpočet nevie povedať, je tu
 *    pomlčka a dôvod. Appka zapisuje do produkčného eshopu — „0 z 200" by tu
 *    bolo tvrdenie, nie medzera.
 * 3. **Odhad je označený.** Dátum dobehnutia fronty je plán pri dnešnej
 *    rýchlosti, nie sľub, preto nesie znak `≈` a tlmenejší odtieň.
 *
 * Spotreba sa NEPOČÍTA tu — appka ju číta z histórie, ktorá sa nedá prepísať.
 * Táto obrazovka je čisto čítacia.
 *
 * Vlastník: V12.
 */
import { dayMonthSk, formatCountSk, writeBudgetSentence } from '@/lib/ui/vocabulary';
import type { QueueView, SettingsView } from '@/components/settings/api';

export interface BudgetSectionProps {
  settings: SettingsView;
  queue: QueueView | null;
}

export function BudgetSection({ settings, queue }: BudgetSectionProps) {
  const budget = queue?.budget ?? null;
  const known = budget !== null;
  const spent = budget?.spent ?? 0;
  const limit = budget?.budget ?? settings.dailyWriteBudget;
  const remaining = budget?.remaining ?? 0;
  const exhausted = budget?.exhausted === true;
  const percent = limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0;

  const pending = queue?.queue.pending ?? 0;
  const total = queue?.queue.total ?? 0;
  const done = queue?.queue.done ?? 0;

  return (
    <section className="sec" id="rozpocet" data-testid="budget-section">
      <div className="sec-h">
        <h2>Rozpočet zápisov</h2>
        <div className="act lvl-3">Deň sa počíta podľa eshopu</div>
      </div>

      <div className="split">
        <div>
          <div className="kpis">
            <div className="kpi">
              <div className="k">Dnes zapísané</div>
              <div className="v" data-testid="budget-spent">
                {known ? formatCountSk(spent) : '—'}{' '}
                <span className="lvl-3">/ {formatCountSk(limit)}</span>
              </div>
              <div className="s">
                {known
                  ? exhausted
                    ? 'pokračujem zajtra'
                    : `zostáva ${formatCountSk(remaining)}`
                  : 'zatiaľ neviem'}
              </div>
            </div>
            <div className="kpi">
              <div className="k">Vo fronte</div>
              <div className="v" data-testid="budget-queue">
                {formatCountSk(done)} <span className="lvl-3">/ {formatCountSk(total)}</span>
              </div>
              <div className="s">
                {pending > 0 ? `čaká ${formatCountSk(pending)}` : 'fronta je prázdna'}
              </div>
            </div>
            <div className="kpi">
              <div className="k">Hotové</div>
              <div className="v">
                {queue?.estimate != null ? (
                  // Krátky tvar `2. 9.` — dlhý dátum sa v úzkej dlaždici zlomí
                  // a znak odhadu by zostal visieť na samostatnom riadku.
                  <span className="est" data-testid="budget-estimate">
                    {dayMonthSk(queue.estimate.date)}
                  </span>
                ) : (
                  '—'
                )}
              </div>
              <div className="s">
                {queue?.estimate != null ? 'pri dnešnej rýchlosti' : 'niet čo dopočítať'}
              </div>
            </div>
          </div>

          <div className="bar">
            <i style={{ width: `${known ? percent : 0}%` }} />
          </div>
          <div className="prog-meta" data-testid="budget-line">
            <span>{known ? writeBudgetSentence(spent, limit).text : 'Rozpočet zatiaľ neviem'}</span>
            {queue?.heartbeat.stale === true ? (
              <>
                <span className="sep-dot">·</span>
                <span>fronta teraz nezapisuje</span>
              </>
            ) : null}
          </div>
        </div>

        <div className="stack">
          <div className="lvl-3">
            <b>Denný strop</b> — koľko produktov smie appka zlacniť za jeden deň
          </div>
          <div className="kv">
            <span className="k">Nastavený strop</span>
            <span className="v" data-testid="budget-limit">
              {formatCountSk(settings.dailyWriteBudget)} zápisov
            </span>
            <span />
          </div>
          <div className="locked-note" data-testid="budget-locked">
            Znížiť strop zatiaľ vie len správca appky
          </div>
          <div className="set-note">
            Vyšší strop nezáleží na nás — eshop viac zápisov za deň neprijme.
          </div>
        </div>
      </div>

      <details className="tech">
        <summary>Technický detail</summary>
        <div className="body">
          <table>
            <tbody>
              <tr>
                <td>Deň rozpočtu</td>
                <td className="mono">{budget?.day ?? '—'} (UTC)</td>
              </tr>
              <tr>
                <td>Zdroj spotreby</td>
                <td className="mono">count(write_attempt) nad audit_log</td>
              </tr>
              <tr>
                <td>Pauza medzi zápismi</td>
                <td className="mono">min. 3 s (limit 20/min)</td>
              </tr>
              <tr>
                <td>Posledný krok fronty</td>
                <td className="mono">{queue?.heartbeat.lastTickAt ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

export default BudgetSection;
