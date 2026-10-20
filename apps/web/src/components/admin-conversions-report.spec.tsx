import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminConversionsReport } from './admin-conversions-report';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('../i18n/i18n-provider', () => ({ useI18n: () => ({ locale: 'uk' }) }));
afterEach(() => { cleanup(); push.mockClear(); });

const report = {
  from: '2026-10-01', to: '2026-10-20', note: 'counts_not_unique_visitors' as const,
  metrics: [
    { metric: 'pricing_view', locale: 'uk', planId: 'none', count: 12 },
    { metric: 'plan_interest', locale: 'uk', planId: 'scale', count: null },
  ],
  rates: { registrationToFirstOrder: null, firstOrderToPlanInterest: null },
};

describe('AdminConversionsReport', () => {
  it('shows only suppressed aggregate metrics and honest labels', () => {
    render(<AdminConversionsReport initial={report} />);
    expect(screen.getByText(/не унікальних відвідувачів/)).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getAllByText('Недостатньо даних')).toHaveLength(2);
    expect(screen.queryByText(/tenantId|email|phone/i)).not.toBeInTheDocument();
  });

  it('focuses a bad date and preserves the entered values', () => {
    render(<AdminConversionsReport initial={report} />);
    fireEvent.change(screen.getByLabelText('До дати'), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Показати' }));
    expect(screen.getByLabelText('До дати')).toHaveFocus();
    expect(screen.getByLabelText('До дати')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Від дати')).toHaveValue('2026-10-01');
    expect(push).not.toHaveBeenCalled();
  });
});
