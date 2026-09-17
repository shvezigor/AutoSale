import type { IntegrationStatus } from '../content/integrations';
import type { Locale } from '../routing/locales';

const labels: Record<Locale, Record<IntegrationStatus, string>> = {
  uk: { available: 'Доступно', 'in-development': 'У розробці', roadmap: 'У планах' },
  en: { available: 'Available', 'in-development': 'In development', roadmap: 'Roadmap' },
};

export function StatusBadge({ locale, status }: { locale: Locale; status: IntegrationStatus }) {
  return <span className={`status-badge status-badge--${status}`}>{labels[locale][status]}</span>;
}
