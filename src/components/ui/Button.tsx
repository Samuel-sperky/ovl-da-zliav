/**
 * Aura Zľavy — tlačidlo (A13, §8).
 *
 * `disabledReason` označuje, prečo je akcia zakázaná — typicky read-only režim
 * pri chýbajúcom/expirovanom kľúči (D10). Zapisovacia akcia sa NIKDY neskrýva,
 * len vypne.
 *
 * Redizajn (U17): dôvod už nie je len v `title`. Keď je tlačidlo vypnuté,
 * vykreslí sa dôvod aj ako VIDITEĽNÝ text s `role="status"` — na dotykových
 * zariadeniach sa tooltip nezobrazí vôbec a čítačke sa `title` na `disabled`
 * prvku neoznámi spoľahlivo.
 *
 * `busy` kreslí inline spinner v tlačidle (§3.4). Na potvrdzovacom tlačidle
 * zápisu sa animácie nepoužívajú — tam sa `busy` nesmie zapnúť.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'danger-quiet' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  small?: boolean;
  /** Vysvetlenie, prečo je akcia zakázaná (D10) — tooltip aj viditeľný text. */
  disabledReason?: string;
  /** Prebieha operácia — inline spinner. Nie na potvrdení zápisu. */
  busy?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'default',
  small = false,
  disabledReason,
  busy = false,
  className,
  disabled,
  title,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'ovl-btn',
    variant === 'primary' ? 'ovl-btn--primary' : '',
    variant === 'danger' ? 'ovl-btn--danger' : '',
    variant === 'danger-quiet' ? 'ovl-btn--danger-quiet' : '',
    variant === 'ghost' ? 'ovl-btn--ghost' : '',
    small ? 'ovl-btn--small' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const showReason = Boolean(disabled && disabledReason);

  const button = (
    <button
      type={type}
      className={classes}
      disabled={disabled}
      title={disabled && disabledReason ? disabledReason : title}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <span className="ovl-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );

  if (!showReason) return button;

  return (
    <span className="ovl-btn-wrap">
      {button}
      <span className="ovl-btn-reason" role="status">
        {disabledReason}
      </span>
    </span>
  );
}

export default Button;
