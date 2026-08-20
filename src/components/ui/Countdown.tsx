'use client';

/**
 * Aura Zľavy — živý odpočet (D5, §8).
 *
 * Odpočítava k `expiresAt` (ISO string alebo epoch ms) a každú sekundu sa
 * prekreslí. Po uplynutí zobrazí `expiredLabel` a zavolá `onExpire` (raz).
 */
import { useEffect, useRef, useState } from 'react';

import { formatCountdownSk } from '@/lib/ui/format';

export interface CountdownProps {
  expiresAt: string | number | Date | null;
  expiredLabel?: string;
  onExpire?: () => void;
}

function secondsLeft(expiresAt: string | number | Date): number {
  const target = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  return Math.floor((target - Date.now()) / 1000);
}

export function Countdown({ expiresAt, expiredLabel = 'expirovaný', onExpire }: CountdownProps) {
  const [left, setLeft] = useState<number | null>(() =>
    expiresAt == null ? null : secondsLeft(expiresAt),
  );
  const firedRef = useRef(false);

  useEffect(() => {
    if (expiresAt == null) {
      setLeft(null);
      return;
    }
    firedRef.current = false;
    setLeft(secondsLeft(expiresAt));
    const id = setInterval(() => {
      const s = secondsLeft(expiresAt);
      setLeft(s);
      if (s <= 0 && !firedRef.current) {
        firedRef.current = true;
        onExpire?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt, onExpire]);

  if (left == null) return <span>—</span>;
  if (left <= 0) return <span>{expiredLabel}</span>;
  return <span suppressHydrationWarning>{formatCountdownSk(left)}</span>;
}

export default Countdown;
