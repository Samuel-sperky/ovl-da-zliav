'use client';

/**
 * Aura Zľavy — sekcia PRIPOJENIE (V12; predloha `design/v3/nastavenia.html`).
 *
 * Adresa eshopu je JEDNA a výhradne `https://`. Do 27. 8. 2026 si jej zmena
 * vyžiadala heslo (D80); heslá zmazalo D99 a sudo D100, a 28. 8. 2026 heslo
 * vystriedalo zaškrtávacie potvrdenie (D106) — bez neho server vracia 400.
 * Prečo vôbec nejaká brána: na túto adresu ide zápisová cesta s dešifrovaným
 * produkčným API kľúčom v hlavičke, takže kto prepíše adresu, prepíše aj to,
 * komu appka kľúč pošle. Canary to nezastaví, tá číta bez kľúča.
 *
 * Ďalej platí origin check (D72) proti cudzej stránke a canary proti zlej
 * adrese: server pred uložením overí, že tam naozaj odpovedá eshop — bez
 * úspešného overenia sa adresa neuloží. Appka nezapisuje do niečoho, o čom
 * nevie, či to vôbec existuje.
 *
 * Výsledok skúšobného spojenia je na povrchu VETA („Spojenie funguje"), nie
 * číslo odpovede. Číslo odpovede aj čas majú svoje miesto v rozkliku
 * „Technický detail" — tam patria technické údaje a nikde inde.
 *
 * Vlastník: V12 (pôvodne A16).
 */
import { useState } from 'react';

import ActionFailurePanel from '@/components/ui/ActionFailure';
import Button from '@/components/ui/Button';
import { SigMark } from '@/components/ui/StatusMark';
import { SHOP_KEYED_LIMIT } from '@/lib/shop/rate-limits';
import { formatDateTimeSk } from '@/lib/ui/format';
import { describeActionFailure, type ActionFailure } from '@/lib/ui/action-failure';
import {
  putDomain,
  testConnection,
  validateDomain,
  type CanaryView,
} from '@/components/settings/api';

/**
 * Výsledok skúšky spojenia ako JEDEN uzol — farba, značka a slovo spolu.
 *
 * Vlastný komponent preto, že tento stav vzniká až po odpovedi servera
 * (`testConnection()`), takže v statickom renderi celého formulára vôbec nie
 * je — a stav, ktorý sa nedá vykresliť, nemá ako spadnúť test, keby mu značka
 * zmizla. Slovo je veta („Spojenie funguje"), nie číslo odpovede; to patrí do
 * rozkliku Technický detail.
 */
export function ConnectionState({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="sig ok" data-testid="domain-connection">
      <SigMark variant="ok" />
      Spojenie funguje
    </span>
  ) : (
    <span className="sig bad" data-testid="domain-connection">
      <SigMark variant="bad" />
      Eshop neodpovedal
    </span>
  );
}

export interface DomainFormProps {
  shopDomain: string | null;
  domainConfirmedAt: string | null;
  onSaved: () => void;
}

export function DomainForm({ shopDomain, domainConfirmedAt, onSaved }: DomainFormProps) {
  /**
   * Keď adresa eshopu ešte nie je nastavená, formulár je otvorený hneď — bez
   * nej appka nevie nič, takže schovávať pole za ďalší klik nemá zmysel.
   */
  const [open, setOpen] = useState(shopDomain === null);
  const [domain, setDomain] = useState(shopDomain ?? 'https://');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [canary, setCanary] = useState<{ ok: boolean; total: number } | null>(null);
  /* D106 (28. 8. 2026) — potvrdenie zmeny adresy. Do 27. 8. 2026 si ju vypýtalo
     heslo (D80); po jeho zmazaní by adresa, na ktorú appka posiela produkčný
     API kľúč, išla zmeniť jedným tichým klikom. */
  const [confirmed, setConfirmed] = useState(false);
  const [connection, setConnection] = useState<CanaryView | null>(null);

  /** Neúspech je vždy hlasný a vždy hovorí, čo sa nestalo. */
  function fail(error: { code?: string | null; message?: string | null } | null) {
    setCanary(null);
    setFailure(describeActionFailure(error, { action: 'Uloženie adresy eshopu' }));
  }

  async function save() {
    setCanary(null);
    // Lokálna kontrola PRED odoslaním — výhradne https.
    const localError = validateDomain(domain);
    if (localError) {
      fail({ code: 'validation_failed', message: localError });
      return;
    }
    if (!confirmed) {
      fail({
        code: 'validation_failed',
        message: 'Najprv zaškrtni potvrdenie — adresa sa neuložila.',
      });
      return;
    }
    setFailure(null);
    setBusy(true);
    const res = await putDomain(domain.trim(), true);
    setBusy(false);
    if (res.ok) {
      setFailure(null);
      setCanary(res.data.canary);
      setConfirmed(false);
      setOpen(false);
      onSaved();
      return;
    }
    setConfirmed(false);
    fail(res.error);
  }

  async function test() {
    setBusy(true);
    setFailure(null);
    const res = await testConnection();
    setBusy(false);
    if (res.ok) {
      setConnection(res.data);
      return;
    }
    setConnection(null);
    setFailure(describeActionFailure(res.error, { action: 'Skúška spojenia s eshopom' }));
  }

  return (
    <section className="sec" id="pripojenie" data-testid="domain-form">
      <div className="sec-h">
        <h2>Pripojenie</h2>
        <div className="act">
          {connection === null ? null : <ConnectionState ok={connection.ok} />}
        </div>
      </div>

      <div className="kv">
        <span className="k">Eshop</span>
        <span className="v" data-testid="domain-current">
          {shopDomain ?? 'zatiaľ nenastavený'}
        </span>
        <span>
          <Button small onClick={() => setOpen((v) => !v)} data-testid="domain-change">
            {open ? 'Zavrieť' : 'Zmeniť'}
          </Button>
        </span>

        <span className="k">Naposledy potvrdené</span>
        <span className="v">
          {domainConfirmedAt === null ? 'zatiaľ nikdy' : formatDateTimeSk(domainConfirmedAt)}
        </span>
        <span>
          <Button small onClick={() => void test()} disabled={busy} data-testid="domain-test">
            Vyskúšať spojenie
          </Button>
        </span>
      </div>

      {canary ? (
        <p className="set-note gap-t" data-testid="domain-canary">
          Adresa uložená — eshop odpovedal a vidí {canary.total} produktov.
        </p>
      ) : null}

      {open ? (
        <div className="set-form" data-testid="domain-editor">
          <label className="field set-w">
            <span className="lb">Adresa eshopu (len https)</span>
            <input
              className="inp"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="https://eshop.example.sk"
              disabled={busy}
              data-testid="domain-input"
            />
          </label>
          <p className="set-note">
            Na túto adresu appka posiela zápisy aj svoj API kľúč. Kým je adresa
            zlá, kľúč odchádza tam, kam ukazuje.
          </p>
          <label className="field set-w">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={busy}
              data-testid="domain-confirm"
            />
            <span className="lb">Adresu som skontroloval a chcem ju uložiť</span>
          </label>
          <div className="row">
            <Button
              variant="primary"
              onClick={() => void save()}
              disabled={busy || !confirmed}
              data-testid="domain-save"
            >
              {busy ? 'Ukladám…' : 'Uložiť adresu'}
            </Button>
            <span className="lvl-3">adresa je jedna pre celú appku</span>
          </div>
        </div>
      ) : null}

      <ActionFailurePanel failure={failure} testId="domain-failure" />

      <details className="tech">
        <summary>Technický detail</summary>
        <div className="body">
          <table>
            <tbody>
              <tr>
                <td>Základ adresy</td>
                <td className="mono">{shopDomain === null ? '—' : `${shopDomain}/api`}</td>
              </tr>
              <tr>
                <td>Posledná skúška</td>
                <td className="mono">
                  {connection === null
                    ? '—'
                    : `${connection.httpStatus ?? '—'} · ${connection.total} položiek · ${connection.latencyMs} ms`}
                </td>
              </tr>
              {/* ČÍSLO SA TU NEPÍŠE RUČNE (V6b).
                  Do 2. 9. 2026 tu stál literál „20/min · 200/UTC deň". Kvótu
                  kľúča zdvihol správca shopu 1. 9. 2026 na 150/min a 1000/deň,
                  `SHOP_KEYED_LIMIT` sa opravil — a tento riadok nie, lebo bol
                  DRUHÁ kópia toho istého čísla a nič ju k prvej neviazalo.
                  Obrazovka tak mesiac tvrdila limit, ktorý shop už nemal. Je to
                  tá istá trieda chyby, akú s tou istou kvótou spravil literál
                  `200` v `settings.repo.ts`; odvodenie je jediná obrana. */}
              <tr>
                <td>Limit eshopu</td>
                <td className="mono">
                  {SHOP_KEYED_LIMIT.perMinute}/min · {SHOP_KEYED_LIMIT.perUtcDay}/UTC deň
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>

    </section>
  );
}

export default DomainForm;
