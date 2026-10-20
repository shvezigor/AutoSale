import { describe, expect, it, vi } from 'vitest';

import { AdminConversionService, validReportRange } from './admin-conversion.service.js';

const now = new Date('2026-10-20T14:00:00Z');

describe('AdminConversionService aggregate report', () => {
  it('rejects invalid, reversed, future and overlong date ranges', () => {
    expect(validReportRange('2026-02-30', '2026-10-20', now)).toBe(false);
    expect(validReportRange('2026-10-20', '2026-10-19', now)).toBe(false);
    expect(validReportRange('2026-01-01', '2026-10-20', now)).toBe(false);
    expect(validReportRange('2026-10-20', '2026-10-22', now)).toBe(false);
    expect(validReportRange('2026-10-01', '2026-10-20', now)).toBe(true);
  });

  it('returns aggregate-only cells, suppresses values below three and uses valid cohort denominators', async () => {
    const rows = [
      { metric: 'pricing_view', locale: 'uk', plan_id: 'none', total: 15n },
      { metric: 'plan_interest', locale: 'en', plan_id: 'scale', total: 2n },
      { metric: 'account_registered', locale: 'all', plan_id: 'none', total: 10n },
      { metric: 'registration_cohort_first_order', locale: 'all', plan_id: 'none', total: 4n },
      { metric: 'first_order_confirmed', locale: 'all', plan_id: 'none', total: 5n },
      { metric: 'first_order_cohort_plan_interest', locale: 'all', plan_id: 'none', total: 3n },
    ];
    const query = vi.fn().mockResolvedValue(rows);
    const report = await new AdminConversionService({ $queryRaw: query } as never, () => now).report('2026-10-01', '2026-10-20');
    expect(report.rates).toEqual({ registrationToFirstOrder: 0.4, firstOrderToPlanInterest: 0.6 });
    expect(report.metrics.find((item) => item.metric === 'plan_interest')?.count).toBeNull();
    expect(JSON.stringify(report)).not.toMatch(/tenantId|email|phone|visitorId/i);
  });

  it('withholds a cohort rate outside the 90-day raw interest window', async () => {
    const query = vi.fn().mockResolvedValue([
      { metric: 'first_order_confirmed', locale: 'all', plan_id: 'none', total: 5n },
      { metric: 'first_order_cohort_plan_interest', locale: 'all', plan_id: 'none', total: 4n },
    ]);
    const report = await new AdminConversionService({ $queryRaw: query } as never, () => now).report('2026-07-01', '2026-07-31');
    expect(report.rates.firstOrderToPlanInterest).toBeNull();
  });
});
