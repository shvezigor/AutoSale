'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

type LoadingButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  pending?: boolean;
  pendingLabel?: string;
  children: ReactNode;
};

export function LoadingButton({ pending = false, pendingLabel = 'Завантаження…', disabled, children, className = '', ...props }: LoadingButtonProps) {
  return <button {...props} className={`loading-button ${className}`.trim()} disabled={disabled || pending} aria-busy={pending || undefined}>
    <span className="loading-button-idle" aria-hidden={pending || undefined}>{children}</span>
    <span className="loading-button-pending" aria-hidden={!pending || undefined}>
      <span className="button-spinner" aria-hidden="true" />
      <span>{pendingLabel}</span>
    </span>
  </button>;
}
