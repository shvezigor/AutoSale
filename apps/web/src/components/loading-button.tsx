'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useI18n } from '../i18n/i18n-provider';

type LoadingButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  pending?: boolean;
  pendingLabel?: string;
  children: ReactNode;
};

export function LoadingButton({ pending = false, pendingLabel, disabled, children, className = '', ...props }: LoadingButtonProps) {
  const { t } = useI18n();
  const visiblePendingLabel = pendingLabel ?? t('common.loading');
  return <button {...props} className={`loading-button ${className}`.trim()} disabled={disabled || pending} aria-busy={pending || undefined}>
    <span className="loading-button-idle" aria-hidden={pending || undefined}>{children}</span>
    <span className="loading-button-pending" aria-hidden={!pending || undefined}>
      <span className="button-spinner" aria-hidden="true" />
      <span>{visiblePendingLabel}</span>
    </span>
  </button>;
}
