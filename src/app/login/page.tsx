'use client';

/**
 * Aura Zľavy — `/login` (A16, §8, D68–D71).
 *
 * Jediný používateľ, heslo ≥ 12 znakov. Stavy: idle / submitting / locked.
 * Pri lockoute (429) UI zobrazí, koľko času zostáva — hodnotu berie z hlavičky
 * `Retry-After` alebo z hlášky servera; nikdy nehádame, či heslo bolo správne.
 * Prihlásenie ide výhradne na `/api/auth/login` (žiadny Server Action).
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';

/** Minimum podľa §5 (`password: string(12..200)`). */
const PASSWORD_MIN = 12;

interface LoginEnvelope {
  ok: boolean;
  error?: { code?: string; message?: string };
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'submitting' | 'locked'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [rawCode, setRawCode] = useState<string | null>(null);
  const [lockSeconds, setLockSeconds] = useState<number | null>(null);

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
