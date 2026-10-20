import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlanInterestCard, attemptPlanInterest, planContactHref } from './plan-interest-card';

vi.mock('../../i18n/i18n-provider', () => ({ useI18n: () => ({ locale: 'uk', t: (key: string) => key }) }));
vi.mock('../../auth/csrf-fetch', () => ({ mutatingFetch: vi.fn() }));
import { mutatingFetch } from '../../auth/csrf-fetch';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('plan interest contact path', () => {
  it('keeps a direct email link and explicitly states there is no charge or subscription', () => {
    render(<PlanInterestCard />);
    expect(screen.getByRole('link', { name: 'Або напишіть напряму' })).toHaveAttribute('href', planContactHref('growth'));
    expect(screen.getByText(/не оформлює підписку, не списує кошти/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Обговорити тариф' })).toHaveClass('primary-button');
  });

  it('returns the mail path even if measurement is unavailable', async () => {
    vi.mocked(mutatingFetch).mockRejectedValueOnce(new Error('fictional outage'));
    expect(await attemptPlanInterest('scale')).toBe(planContactHref('scale'));
    expect(mutatingFetch).toHaveBeenCalledWith('/api/conversion/plan-interest', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ planId: 'scale' }),
    }));
  });
});
