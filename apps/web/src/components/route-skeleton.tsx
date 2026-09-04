type RouteSkeletonProps = { variant: 'table' | 'settings' | 'conversation' | 'detail' };

export function RouteSkeleton({ variant }: RouteSkeletonProps) {
  const blocks = variant === 'settings' ? 4 : variant === 'detail' ? 6 : 7;
  return <main className={`route-skeleton route-skeleton-${variant}`} data-variant={variant} role="status" aria-busy="true" aria-live="polite">
    <span className="sr-only">Завантажуємо дані…</span>
    <div className="skeleton-heading" aria-hidden="true" />
    <div className="skeleton-subheading" aria-hidden="true" />
    <section className="skeleton-surface" aria-hidden="true">
      {Array.from({ length: blocks }, (_, index) => <div className="skeleton-line" key={index} />)}
    </section>
  </main>;
}
