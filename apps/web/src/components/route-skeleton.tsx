'use client';

import { useI18n } from '../i18n/i18n-provider';

type RouteSkeletonProps = { variant: 'table' | 'settings' | 'conversation' | 'detail' };

export function RouteSkeleton({ variant }: RouteSkeletonProps) {
  const { t } = useI18n();
  const blocks = variant === 'settings' ? 4 : variant === 'detail' ? 6 : 7;
  return <main className={`route-skeleton route-skeleton-${variant}`} data-variant={variant} role="status" aria-busy="true" aria-live="polite">
    <span className="sr-only">{t('common.loading')}</span>
    <div className="skeleton-heading" aria-hidden="true" />
    <div className="skeleton-subheading" aria-hidden="true" />
    <section className="skeleton-surface" aria-hidden="true">
      {Array.from({ length: blocks }, (_, index) => <div className="skeleton-line" key={index} />)}
    </section>
  </main>;
}
