import { describe, expect, it } from 'vitest';
import type { DashboardPeriod } from '@autosale/contracts/dashboard';

import { dashboardPeriodRange } from './dashboard-period.js';

describe('dashboard period boundaries', () => {
  it('exports a period range builder', async () => {
    const period = await import('./dashboard-period.js').catch(() => ({}));
    expect(period).toHaveProperty('dashboardPeriodRange');
  });

  it('includes today and the preceding calendar days in Kyiv', () => {
    const range = dashboardPeriodRange('7d', new Date('2026-09-17T07:00:00.000Z'));

    expect(range).toEqual({
      key: '7d',
      start: new Date('2026-09-10T21:00:00.000Z'),
      previousStart: new Date('2026-09-03T21:00:00.000Z'),
      end: new Date('2026-09-17T07:00:00.000Z'),
      dates: ['2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17'],
    });
  });

  it('keeps seven local dates across the Kyiv daylight-saving transition', () => {
    const range = dashboardPeriodRange('7d', new Date('2026-04-02T10:00:00.000Z'));

    expect(range.start).toEqual(new Date('2026-03-26T22:00:00.000Z'));
    expect(range.previousStart).toEqual(new Date('2026-03-19T22:00:00.000Z'));
    expect(range.dates).toEqual(['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02']);
  });

  it.each<[DashboardPeriod, number]>([['7d', 7], ['30d', 30], ['90d', 90]])('returns %s as %i calendar buckets', (period, length) => {
    expect(dashboardPeriodRange(period, new Date('2026-09-17T07:00:00.000Z')).dates).toHaveLength(length);
  });
});
