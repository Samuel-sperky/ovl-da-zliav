'use client';

/**
 * Aura Zľavy — `/login` (A16, §8, D68–D71).
 *
 * Jediný používateľ, heslo ≥ 12 znakov. Stavy: idle / submitting / locked.
 * Pri lockoute (429) UI zobrazí, koľko času zostáva — hodnotu berie z hlavičky
 * `Retry-After` alebo z hlášky servera; nikdy nehádame, či heslo bolo správne.
 * Prihlásenie ide výhradne na `/api/auth/login` (žiadny Server Action).
 *
 * PRVÝ BEH APPKY: po čerstvej inštalácii je `users=0` a prihlásiť sa NEDÁ
 * žiadnym menom ani heslom. Stránka to zistí z `GET /api/auth/bootstrap`
 * (výhradne POČET účtov, nikdy ich údaje — I1) a namiesto slepého formulára
 * zobrazí presný príkaz na vytvorenie admina. Príkaz MUSÍ spustiť človek
 * v normálnom termináli: `seed-admin` si pýta heslo interaktívne a na jeho
 * maskovanie potrebuje skutočné TTY, takže appka ho nikdy nespustí sama.
 *
 * Fail-closed: keď bootstrap neodpovie (alebo trvá dlho), stránka sa vráti
 * k bežnému formuláru a NIKDY netvrdí, že účet neexistuje. Hlášky NEúspešného
 * prihlásenia zostávajú generické — nikdy neprezradia, či meno existuje (D68).
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';
import {
  SEED_ADMIN_COMMAND,
  firstRunStateFromCount,
  showsAdminSetup,
  type FirstRunState,
} from '@/lib/ui/first-run';

/** Minimum podľa §5 (`password: string(12..200)`). */
const PASSWORD_MIN = 12;

/** Po tomto čase sa bootstrap vzdá a stránka ukáže bežný formulár. */
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
 * príznak `needsAdmin` sa berie len vtedy, keď je to skutočný boolean.
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
  /** `null` = ešte nevieme; potom `needs-admin` / `ready` / `unknown`. */
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

  /* Odpočet lockoutu — po uplynutí sa formulár znova povolí. */
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
    // Lokálna validácia pred odoslaním — server má rovnaké hranice (§5).
    if (username.trim() === '') {
      setError('Zadaj používateľské meno.');
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
      // Heslo držíme len po dobu requestu.
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
            'Účet je dočasne uzamknutý pre priveľa neúspešných pokusov. Skús to neskôr.',
        );
        setRawCode(body?.error?.code ?? 'too_many_attempts');
        return;
      }
      setState('idle');
      setError(body?.error?.message ?? 'Prihlásenie zlyhalo. Skontroluj meno a heslo.');
      setRawCode(body?.error?.code ?? `http_${res.status}`);
    } catch {
      setPassword('');
      setState('idle');
      setError('Server neodpovedá. Skús znova.');
    }
  }

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(SEED_ADMIN_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Bez clipboard práv sa príkaz označí ručne — text je aj tak na obrazovke.
      setCopied(false);
    }
  }

  /* ── Kým bootstrap neodpovie, formulár nezobrazujeme (nebliká) ─────────── */
  if (firstRun === null) {
    return (
      <section
        className="ovl-card ovl-skeleton"
        style={{ maxWidth: '26rem', minHeight: '10rem' }}
        aria-busy="true"
        data-testid="login-loading"
      />
    );
  }

  /* ── Prvý beh: v DB nie je ani jeden účet ─────────────────────────────── */
  if (showsAdminSetup(firstRun)) {
    return (
      <section className="ovl-card" style={{ maxWidth: '34rem' }} data-testid="login-needs-admin">
        <h1 style={{ fontSize: '1.2rem', margin: '0 0 0.5rem' }}>Appka ešte nemá účet</h1>
        <div className="ovl-note ovl-note--attention" role="status">
          <span className="ovl-note-glyph" aria-hidden="true">
            ▲
          </span>
          <span>
            V databáze nie je ani jeden používateľ, takže sa teraz nedá prihlásiť
            žiadnym menom ani heslom. Nie je to porucha — appka je len čerstvo
            nainštalovaná a chýba jej prvý účet.
          </span>
        </div>
        <div className="ovl-stack" style={{ marginTop: '0.9rem' }}>
          <p style={{ margin: 0 }}>
            <strong>Čo urobiť:</strong> spusti tento príkaz v termináli na počítači,
            kde beží Docker, a zadaj meno a heslo (aspoň {PASSWORD_MIN} znakov).
          </p>
          <pre
            className="ovl-mono"
            data-testid="login-seed-command"
            style={{
              margin: 0,
              padding: '0.6rem 0.7rem',
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              border: '1px solid var(--line)',
              borderRadius: '0.35rem',
            }}
          >
            {SEED_ADMIN_COMMAND}
          </pre>
          <div className="ovl-row">
            <Button onClick={() => void copyCommand()} data-testid="login-copy-command">
              {copied ? 'Skopírované ✓' : 'Skopírovať príkaz'}
            </Button>
            <Button variant="primary" onClick={() => window.location.reload()} data-testid="login-recheck">
              Účet som vytvoril — skús znova
            </Button>
          </div>
          <p className="ovl-small ovl-muted" style={{ margin: 0 }}>
            Príkaz musí spustiť človek v normálnom termináli: skript si heslo pýta
            interaktívne a na jeho zamaskovanie potrebuje skutočný terminál. Appka
            ho preto nespúšťa sama a heslo nikdy nevidí ani neukladá inak než ako
            argon2id hash. Po vytvorení účtu sa vráť sem a prihlás sa.
          </p>
        </div>
      </section>
    );
  }

  const locked = state === 'locked';

  return (
    <section className="ovl-card" style={{ maxWidth: '26rem' }} data-testid="login-page">
      <h1 style={{ fontSize: '1.2rem', margin: '0 0 0.5rem' }}>Prihlásenie</h1>
      <form className="ovl-stack" onSubmit={submit}>
        <label>
          <span className="ovl-small">Používateľské meno</span>
          <br />
          <input
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={locked || state === 'submitting'}
            data-testid="login-username"
          />
        </label>
        <label>
          <span className="ovl-small">Heslo</span>
          <br />
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={locked || state === 'submitting'}
            data-testid="login-password"
          />
        </label>
        <div className="ovl-row">
          <Button
            type="submit"
            variant="primary"
            disabled={locked || state === 'submitting'}
            disabledReason={locked ? 'Účet je dočasne uzamknutý.' : undefined}
            data-testid="login-submit"
          >
            {state === 'submitting' ? 'Prihlasujem…' : 'Prihlásiť sa'}
          </Button>
        </div>
        {locked ? (
          <p className="ovl-badge ovl-badge--danger" data-testid="login-locked">
            Uzamknuté
            {lockSeconds !== null ? ` — skús znova za ${lockSeconds} s.` : ' — skús to neskôr.'}
          </p>
        ) : null}
        {error ? <ErrorMessage message={error} rawCode={rawCode} /> : null}
      </form>
      <p className="ovl-small ovl-muted" style={{ marginTop: '0.75rem' }}>
        Appka beží výhradne lokálne. Po prihlásení platí 15-minútové sudo okno —
        citlivé operácie si heslo vyžiadajú znova.
      </p>
    </section>
  );
}
