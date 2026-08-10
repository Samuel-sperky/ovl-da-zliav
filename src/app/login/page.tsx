'use client';

/**
 * Aura Zľavy — `/login` (V12; predloha `design/v3/prihlasenie.html`).
 *
 * Meno a heslo. Nič viac — žiadne „zapamätať si ma", žiadne obnovenie hesla,
 * žiadny druhý faktor. Appka beží v jednej domácnosti na jednom počítači.
 *
 * PRVÝ BEH APPKY: po čerstvej inštalácii nie je v appke ani jeden účet a
 * prihlásiť sa NEDÁ žiadnym menom ani heslom. Stránka to zistí z počtu účtov
 * (výhradne počet, nikdy ich údaje) a namiesto slepého formulára ukáže presný
 * príkaz na vytvorenie prvého účtu. Príkaz MUSÍ spustiť človek v termináli:
 * skript si heslo pýta interaktívne a na jeho zamaskovanie potrebuje skutočný
 * terminál, takže appka ho nikdy nespúšťa sama.
 *
 * FAIL-CLOSED: keď sa počet účtov nedá zistiť (alebo to trvá dlho), stránka sa
 * vráti k bežnému formuláru a NIKDY netvrdí, že účet neexistuje. Hlášky
 * neúspešného prihlásenia zostávajú všeobecné — nikdy neprezradia, či meno
 * v appke je.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';
import { LOGIN_CSS } from '@/app/login/styles';
import {
  SEED_ADMIN_COMMAND,
  firstRunStateFromCount,
  showsAdminSetup,
  type FirstRunState,
} from '@/lib/ui/first-run';

/** Minimálna dĺžka hesla; server má rovnakú hranicu. */
const PASSWORD_MIN = 12;

/** Po tomto čase sa zisťovanie prvého behu vzdá a ukáže sa bežný formulár. */
const BOOTSTRAP_TIMEOUT_MS = 4000;

interface LoginEnvelope {
  ok: boolean;
  error?: { code?: string; message?: string };
}

interface BootstrapEnvelope {
  ok: boolean;
  data?: { needsAdmin?: boolean };
}

/**
 * Zistí stav prvého behu. Vracia `'unknown'` pri akejkoľvek neistote —
 * príznak sa berie len vtedy, keď je to skutočný boolean.
 */
async function loadFirstRunState(signal: AbortSignal): Promise<FirstRunState> {
  try {
    const res = await fetch('/api/auth/bootstrap', {
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!res.ok) return 'unknown';
    const body = (await res.json()) as BootstrapEnvelope;
    if (!body?.ok || typeof body.data?.needsAdmin !== 'boolean') return 'unknown';
    // Príznak servera prekladáme cez rovnakú čistú funkciu ako počet účtov,
    // aby existoval jediný zdroj pravdy o tom, čo znamená „prvý beh".
    return firstRunStateFromCount(body.data.needsAdmin ? 0 : 1);
  } catch {
    return 'unknown';
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'submitting' | 'locked'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [rawCode, setRawCode] = useState<string | null>(null);
  const [lockSeconds, setLockSeconds] = useState<number | null>(null);
  /** `null` = ešte nevieme; potom prvý beh / pripravené / neisté. */
  const [firstRun, setFirstRun] = useState<FirstRunState | null>(null);
  const [copied, setCopied] = useState(false);

  /* Prvý beh: existuje vôbec nejaký účet? */
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BOOTSTRAP_TIMEOUT_MS);
    let alive = true;
    void loadFirstRunState(controller.signal).then((next) => {
      if (alive) setFirstRun(next);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  /* Odpočet uzamknutia — po uplynutí sa formulár znova povolí. */
  useEffect(() => {
    if (state !== 'locked' || lockSeconds === null) return;
    if (lockSeconds <= 0) {
      setState('idle');
      setLockSeconds(null);
      return;
    }
    const id = setTimeout(() => setLockSeconds((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(id);
  }, [state, lockSeconds]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === 'submitting' || state === 'locked') return;
    setRawCode(null);
    // Lokálna kontrola pred odoslaním — server má rovnaké hranice.
    if (username.trim() === '') {
      setError('Zadaj meno.');
      return;
    }
    if (password.length < PASSWORD_MIN) {
      setError(`Heslo má aspoň ${PASSWORD_MIN} znakov.`);
      return;
    }
    setError(null);
    setState('submitting');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      // Heslo držíme len po dobu odoslania.
      setPassword('');
      let body: LoginEnvelope | null = null;
      try {
        body = (await res.json()) as LoginEnvelope;
      } catch {
        body = null;
      }
      if (res.ok && body?.ok) {
        setState('idle');
        router.replace('/');
        router.refresh();
        return;
      }
      if (res.status === 429) {
        const header = Number(res.headers.get('Retry-After'));
        setLockSeconds(Number.isFinite(header) && header > 0 ? Math.ceil(header) : null);
        setState('locked');
        setError(
          body?.error?.message ??
            'Prihlásenie je dočasne uzamknuté pre priveľa neúspešných pokusov. Skús to neskôr.',
        );
        setRawCode(body?.error?.code ?? 'too_many_attempts');
        return;
      }
      setState('idle');
      setError(body?.error?.message ?? 'Prihlásenie sa nepodarilo. Skontroluj meno a heslo.');
      setRawCode(body?.error?.code ?? `http_${res.status}`);
    } catch {
      setPassword('');
      setState('idle');
      setError('Appka neodpovedá. Skús znova.');
    }
  }

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(SEED_ADMIN_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Bez práv na schránku si príkaz označí človek — je aj tak na obrazovke.
      setCopied(false);
    }
  }

  /* ── Kým sa prvý beh nezistí, formulár nekreslíme (nebliká) ───────────── */
  if (firstRun === null) {
    return (
      <div className="login">
        <style>{LOGIN_CSS}</style>
        <section
          className="sec ovl-skeleton"
          style={{ minHeight: '10rem' }}
          aria-busy="true"
          data-testid="login-loading"
        />
      </div>
    );
  }

  /* ── Prvý beh: v appke nie je ani jeden účet ──────────────────────────── */
  if (showsAdminSetup(firstRun)) {
    return (
      <div className="login">
        <style>{LOGIN_CSS}</style>
        <section className="sec wide" data-testid="login-needs-admin">
          <div className="spread" style={{ marginBottom: '14px' }}>
            <span className="mark">
              Aura <b>Zľavy</b>
            </span>
            <span className="sig warn">bez účtu</span>
          </div>
          <div className="lvl-2">
            Appka je čerstvo nainštalovaná a nemá ešte ani jeden účet, takže sa
            teraz nedá prihlásiť. Nie je to porucha.
          </div>
          <div className="hint" style={{ marginTop: '10px' }}>
            Spusti tento príkaz v termináli na počítači, kde appka beží, a zadaj
            meno a heslo (aspoň {PASSWORD_MIN} znakov).
          </div>
          <pre className="cmd" data-testid="login-seed-command">
            {SEED_ADMIN_COMMAND}
          </pre>
          <div className="row-2" style={{ marginTop: '10px' }}>
            <Button onClick={() => void copyCommand()} data-testid="login-copy-command">
              {copied ? 'Skopírované' : 'Skopírovať príkaz'}
            </Button>
            <Button
              variant="primary"
              onClick={() => window.location.reload()}
              data-testid="login-recheck"
            >
              Účet som vytvoril
            </Button>
          </div>
          <details className="tech">
            <summary>Technický detail</summary>
            <div className="body">
              <table>
                <tbody>
                  <tr>
                    <td>Prečo to nespustí appka</td>
                    <td>
                      skript pýta heslo interaktívne a na jeho zamaskovanie
                      potrebuje skutočný terminál
                    </td>
                  </tr>
                  <tr>
                    <td>Ako je heslo uložené</td>
                    <td className="mono">argon2id, nikdy nie v čitateľnej podobe</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
        </section>
      </div>
    );
  }

  const locked = state === 'locked';
  const busy = state === 'submitting';

  return (
    <div className="login">
      <style>{LOGIN_CSS}</style>
      <section className="sec" data-testid="login-page">
        <div className="spread" style={{ marginBottom: '18px' }}>
          <span className="mark">
            Aura <b>Zľavy</b>
          </span>
        </div>

        <form onSubmit={submit}>
          <label className="field">
            <span className="lb">Meno</span>
            <input
              className="inp"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={locked || busy}
              data-testid="login-username"
            />
          </label>
          <label className="field">
            <span className="lb">Heslo</span>
            <input
              className="inp"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={locked || busy}
              data-testid="login-password"
            />
          </label>

          <Button
            type="submit"
            variant="primary"
            className="btn lg"
            disabled={locked || busy}
            disabledReason={locked ? 'Prihlásenie je dočasne uzamknuté.' : undefined}
            data-testid="login-submit"
          >
            {busy ? 'Prihlasujem…' : 'Prihlásiť sa'}
          </Button>

          {locked ? (
            <p className="sig bad" style={{ marginTop: '10px' }} data-testid="login-locked">
              Uzamknuté
              {lockSeconds !== null ? ` — skús znova o ${lockSeconds} s` : ' — skús to neskôr'}
            </p>
          ) : null}
          {error ? (
            <div style={{ marginTop: '10px' }}>
              <ErrorMessage message={error} rawCode={rawCode} />
            </div>
          ) : null}
        </form>

        <div className="foot">
          <span className="lvl-3">Appka beží len v tejto sieti</span>
        </div>

        <details className="tech">
          <summary>Technický detail</summary>
          <div className="body">
            <table>
              <tbody>
                <tr>
                  <td>Adresa</td>
                  <td className="mono">127.0.0.1:3070</td>
                </tr>
                <tr>
                  <td>Platnosť prihlásenia</td>
                  <td className="mono">8 h celkovo · 30 min bez činnosti</td>
                </tr>
                <tr>
                  <td>Citlivé kroky</td>
                  <td className="mono">heslo znova po 15 min</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </div>
  );
}
