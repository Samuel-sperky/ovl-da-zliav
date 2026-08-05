/**
 * Aura Zľavy — tlačidlo (A13, §8).
 *
 * `writeAction` označuje zapisovaciu akciu: v read-only režime (D10) ju
 * volajúci vypne cez `disabled` + `disabledReason` (tooltip), nikdy neskrýva.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'default' | 'primary' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  small?: boolean;
  /** Tooltip vysvetľujúci, prečo je akcia zakázaná (D10). */
  disabledReason?: string;
  children: ReactNode;
}

export function Button({
  variant = 'default',
  small = false,
  disabledReason,
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
    small ? 'ovl-btn--small' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type={type}
      className={classes}
      disabled={disabled}
      title={disabled && disabledReason ? disabledReason : title}
      {...rest}
    >
      {children}
    </button>
  );
}

export default Button;
