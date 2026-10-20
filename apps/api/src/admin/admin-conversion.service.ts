import type { AdminConversionReport } from '@autosale/contracts';
import type { PrismaClient } from '@autosale/database';

export interface ConversionRollupRow {
  metric: string;
  locale: string;
  plan_id: string;
  total: bigint;
}

const MS_DAY = 86_400_000;

export function validReportRange(from: string, to: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return false;
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (new Date(start).toISOString().slice(0, 10) !== from || new Date(end).toISOString().slice(0, 10) !== to) return false;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return start <= end && end - start <= 89 * MS_DAY && end <= today;
}

export class AdminConversionService {
  constructor(private readonly prisma: PrismaClient, private readonly now: () => Date = () => new Date()) {}

  async report(from: string, to: string): Promise<AdminConversionReport> {
    if (!validReportRange(from, to, this.now())) throw new Error('CONVERSION_REPORT_RANGE_INVALID');
    const rows = await this.prisma.$queryRaw<ConversionRollupRow[]>`
      SELECT metric, locale, plan_id, total FROM public.platform_conversion_rollup(${from}::date, ${to}::date)
    `;
    const total = (metric: string) => Number(rows.find((row) => row.metric === metric)?.total ?? 0n);
    const registerCount = total('account_registered');
    const registeredFirstCount = total('registration_cohort_first_order');
    const firstOrderCount = total('first_order_confirmed');
    const firstInterestCount = total('first_order_cohort_plan_interest');
    const linkableFrom = new Date(this.now().getTime() - 89 * MS_DAY).toISOString().slice(0, 10);
    return {
      from, to,
      metrics: rows.map((row) => ({ metric: row.metric, locale: row.locale, planId: row.plan_id, count: Number(row.total) >= 3 ? Number(row.total) : null })),
      rates: {
        registrationToFirstOrder: registerCount >= 3 && registeredFirstCount >= 3 ? registeredFirstCount / registerCount : null,
        firstOrderToPlanInterest: from >= linkableFrom && firstOrderCount >= 3 && firstInterestCount >= 3
          ? firstInterestCount / firstOrderCount : null,
      },
      note: 'counts_not_unique_visitors',
    };
  }
}
