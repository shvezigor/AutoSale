import { dashboardResponseSchema, type DashboardPeriod, type DashboardResponse } from '@autosale/contracts/dashboard';
import { Prisma, type PrismaClient } from '@autosale/database';

import { dashboardPeriodRange } from './dashboard-period.js';

type AggregateRow = {
  newOrders: bigint | number;
  previousOrders: bigint | number;
  confirmationNumerator: bigint | number;
  confirmationDenominator: bigint | number;
  previousConfirmationNumerator: bigint | number;
  previousConfirmationDenominator: bigint | number;
  medianConfirmationMinutes: number | null;
  medianConfirmationSamples: bigint | number;
  previousMedianConfirmationMinutes: number | null;
  previousMedianConfirmationSamples: bigint | number;
  needsAttention: bigint | number;
  overdueAttention: bigint | number;
  needsReview: bigint | number;
  aiFailed: bigint | number;
  funnelConfirmed: bigint | number;
  funnelExported: bigint | number;
  funnelShipmentStarted: bigint | number;
  failedExports: bigint | number;
  failedShipments: bigint | number;
};

type DailyRow = {
  day: string;
  confirmed: bigint | number;
  needsReview: bigint | number;
  processingOrFailed: bigint | number;
  cancelled: bigint | number;
};

const providerPresentation = {
  NOVA_POSHTA: { key: 'nova-poshta', label: 'Нова Пошта' },
  MEEST: { key: 'meest', label: 'Meest' },
  UKRPOSHTA: { key: 'ukrposhta', label: 'Укрпошта' },
} as const;

export class DashboardService {
  constructor(private readonly prisma: PrismaClient) {}

  async summary(tenantId: string, period: DashboardPeriod, now = new Date()): Promise<DashboardResponse> {
    const range = dashboardPeriodRange(period, now);
    const [aggregateRows, dailyRows, queue, instagram, sheets, deliveryConnections] = await Promise.all([
      this.aggregate(tenantId, range.previousStart, range.start, range.end, now),
      this.daily(tenantId, range.start, range.end),
      this.prisma.order.findMany({
        where: { tenantId, status: { in: ['NEEDS_REVIEW', 'AI_FAILED'] } },
        orderBy: { createdAt: 'asc' },
        take: 5,
        select: {
          id: true,
          status: true,
          overallConfidence: true,
          createdAt: true,
          sortProduct: true,
          conversation: { select: { displayName: true, profile: { select: { displayName: true, username: true } } } },
        },
      }),
      this.prisma.instagramConnection.findUnique({
        where: { tenantId },
        select: { status: true, displayName: true, lastErrorCode: true },
      }),
      this.prisma.googleSheetsDestination.findUnique({
        where: { tenantId },
        select: { status: true, sheetName: true, errorSummary: true },
      }),
      this.prisma.deliveryConnection.findMany({
        where: { tenantId },
        orderBy: { provider: 'asc' },
        select: { provider: true, status: true, accountLabel: true, lastErrorCode: true },
      }),
    ]);
    const aggregate = aggregateRows[0] ?? emptyAggregate();
    const newOrders = count(aggregate.newOrders);
    const previousOrders = count(aggregate.previousOrders);
    const confirmationNumerator = count(aggregate.confirmationNumerator);
    const confirmationDenominator = count(aggregate.confirmationDenominator);
    const previousConfirmationNumerator = count(aggregate.previousConfirmationNumerator);
    const previousConfirmationDenominator = count(aggregate.previousConfirmationDenominator);
    const confirmationRate = ratio(confirmationNumerator, confirmationDenominator);
    const previousConfirmationRate = ratio(previousConfirmationNumerator, previousConfirmationDenominator);
    const median = finiteOrNull(aggregate.medianConfirmationMinutes);
    const previousMedian = finiteOrNull(aggregate.previousMedianConfirmationMinutes);
    const dailyByDate = new Map(dailyRows.map((row) => [row.day, row]));
    const deliveryByProvider = new Map(deliveryConnections.map((connection) => [connection.provider, connection]));
    const exportConfigured = sheets?.status === 'ACTIVE';

    return dashboardResponseSchema.parse({
      generatedAt: now.toISOString(),
      period: { key: period, start: range.start.toISOString(), end: range.end.toISOString(), timezone: 'Europe/Kyiv' },
      metrics: {
        newOrders: { value: newOrders, previousValue: previousOrders, changePercent: percentChange(newOrders, previousOrders) },
        needsAttention: {
          value: count(aggregate.needsAttention),
          overdue: count(aggregate.overdueAttention),
          review: count(aggregate.needsReview),
          aiFailed: count(aggregate.aiFailed),
        },
        confirmationRate: {
          value: confirmationRate,
          numerator: confirmationNumerator,
          denominator: confirmationDenominator,
          previousValue: previousConfirmationRate,
          changePercentagePoints: confirmationRate === null || previousConfirmationRate === null
            ? null
            : rounded((confirmationRate - previousConfirmationRate) * 100),
        },
        medianConfirmationMinutes: {
          value: median,
          sampleSize: count(aggregate.medianConfirmationSamples),
          previousValue: previousMedian,
          previousSampleSize: count(aggregate.previousMedianConfirmationSamples),
          changePercent: median === null || previousMedian === null ? null : percentChange(median, previousMedian),
        },
      },
      dailyOrders: range.dates.map((date) => {
        const row = dailyByDate.get(date);
        return {
          date,
          confirmed: count(row?.confirmed),
          needsReview: count(row?.needsReview),
          processingOrFailed: count(row?.processingOrFailed),
          cancelled: count(row?.cancelled),
        };
      }),
      funnel: {
        created: newOrders,
        confirmed: count(aggregate.funnelConfirmed),
        exported: exportConfigured ? count(aggregate.funnelExported) : null,
        shipmentStarted: count(aggregate.funnelShipmentStarted),
        exportConfigured,
      },
      queue: queue.map((order) => ({
        id: order.id,
        participantName: order.conversation.profile?.displayName
          ?? order.conversation.displayName
          ?? (order.conversation.profile?.username ? `@${order.conversation.profile.username}` : null),
        productLabel: order.sortProduct.trim() || null,
        status: order.status,
        confidence: order.overallConfidence,
        createdAt: order.createdAt.toISOString(),
      })),
      issues: { failedExports: count(aggregate.failedExports), failedShipments: count(aggregate.failedShipments) },
      integrations: [
        {
          key: 'instagram',
          state: connectionState(instagram?.status),
          label: 'Instagram',
          detail: instagram?.displayName ?? null,
          href: '/settings?tab=social',
        },
        {
          key: 'google-sheets',
          state: connectionState(sheets?.status),
          label: 'Google Sheets',
          detail: sheets?.sheetName ?? null,
          href: '/settings?tab=data',
        },
        ...(['NOVA_POSHTA', 'MEEST', 'UKRPOSHTA'] as const).map((provider) => {
          const connection = deliveryByProvider.get(provider);
          return {
            key: providerPresentation[provider].key,
            state: connectionState(connection?.status),
            label: providerPresentation[provider].label,
            detail: connection?.accountLabel ?? null,
            href: '/settings?tab=delivery',
          };
        }),
      ],
    });
  }

  private aggregate(tenantId: string, previousStart: Date, start: Date, end: Date, now: Date) {
    return this.prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
      WITH current_orders AS (
        SELECT id, status, created_at, approved_at
        FROM orders
        WHERE tenant_id = ${tenantId}::uuid AND created_at >= ${start} AND created_at < ${end}
      ), previous_orders AS (
        SELECT id, status, created_at, approved_at
        FROM orders
        WHERE tenant_id = ${tenantId}::uuid AND created_at >= ${previousStart} AND created_at < ${start}
      )
      SELECT
        (SELECT COUNT(*) FROM current_orders) AS "newOrders",
        (SELECT COUNT(*) FROM previous_orders) AS "previousOrders",
        (SELECT COUNT(*) FROM current_orders WHERE status IN ('APPROVED', 'AUTO_APPROVED')) AS "confirmationNumerator",
        (SELECT COUNT(*) FROM current_orders WHERE status <> 'AI_PROCESSING') AS "confirmationDenominator",
        (SELECT COUNT(*) FROM previous_orders WHERE status IN ('APPROVED', 'AUTO_APPROVED')) AS "previousConfirmationNumerator",
        (SELECT COUNT(*) FROM previous_orders WHERE status <> 'AI_PROCESSING') AS "previousConfirmationDenominator",
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (approved_at - created_at)) / 60.0)
          FROM current_orders WHERE status = 'APPROVED' AND approved_at >= created_at) AS "medianConfirmationMinutes",
        (SELECT COUNT(*) FROM current_orders WHERE status = 'APPROVED' AND approved_at >= created_at) AS "medianConfirmationSamples",
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (approved_at - created_at)) / 60.0)
          FROM previous_orders WHERE status = 'APPROVED' AND approved_at >= created_at) AS "previousMedianConfirmationMinutes",
        (SELECT COUNT(*) FROM previous_orders WHERE status = 'APPROVED' AND approved_at >= created_at) AS "previousMedianConfirmationSamples",
        (SELECT COUNT(*) FROM orders WHERE tenant_id = ${tenantId}::uuid AND status IN ('NEEDS_REVIEW', 'AI_FAILED')) AS "needsAttention",
        (SELECT COUNT(*) FROM orders WHERE tenant_id = ${tenantId}::uuid AND status IN ('NEEDS_REVIEW', 'AI_FAILED') AND created_at < ${new Date(now.getTime() - 86_400_000)}) AS "overdueAttention",
        (SELECT COUNT(*) FROM orders WHERE tenant_id = ${tenantId}::uuid AND status = 'NEEDS_REVIEW') AS "needsReview",
        (SELECT COUNT(*) FROM orders WHERE tenant_id = ${tenantId}::uuid AND status = 'AI_FAILED') AS "aiFailed",
        (SELECT COUNT(*) FROM current_orders WHERE status IN ('APPROVED', 'AUTO_APPROVED')) AS "funnelConfirmed",
        (SELECT COUNT(*) FROM current_orders o WHERE EXISTS (
          SELECT 1 FROM order_exports e WHERE e.tenant_id = ${tenantId}::uuid AND e.order_id = o.id AND e.status = 'SUCCEEDED'
        )) AS "funnelExported",
        (SELECT COUNT(*) FROM current_orders o WHERE EXISTS (
          SELECT 1 FROM shipments s WHERE s.tenant_id = ${tenantId}::uuid AND s.order_id = o.id AND s.status <> 'DRAFT'
        )) AS "funnelShipmentStarted",
        (SELECT COUNT(*) FROM order_exports WHERE tenant_id = ${tenantId}::uuid AND status = 'FAILED') AS "failedExports",
        (SELECT COUNT(*) FROM shipments WHERE tenant_id = ${tenantId}::uuid AND (status = 'FAILED' OR last_error_code IS NOT NULL)) AS "failedShipments"
    `);
  }

  private daily(tenantId: string, start: Date, end: Date) {
    return this.prisma.$queryRaw<DailyRow[]>(Prisma.sql`
      SELECT
        to_char(created_at AT TIME ZONE 'Europe/Kyiv', 'YYYY-MM-DD') AS day,
        COUNT(*) FILTER (WHERE status IN ('APPROVED', 'AUTO_APPROVED')) AS confirmed,
        COUNT(*) FILTER (WHERE status = 'NEEDS_REVIEW') AS "needsReview",
        COUNT(*) FILTER (WHERE status IN ('AI_PROCESSING', 'AI_FAILED')) AS "processingOrFailed",
        COUNT(*) FILTER (WHERE status = 'CANCELLED') AS cancelled
      FROM orders
      WHERE tenant_id = ${tenantId}::uuid AND created_at >= ${start} AND created_at < ${end}
      GROUP BY day
      ORDER BY day ASC
    `);
  }
}

function count(value: bigint | number | undefined): number {
  return Number(value ?? 0);
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : rounded(numerator / denominator, 4);
}

function percentChange(current: number, previous: number): number | null {
  return previous === 0 ? null : rounded(((current - previous) / previous) * 100);
}

function rounded(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(Number(value)) ? rounded(Number(value), 2) : null;
}

function connectionState(status: string | undefined): 'active' | 'attention' | 'not-configured' {
  if (!status || status === 'DISCONNECTED') return 'not-configured';
  return status === 'ACTIVE' ? 'active' : 'attention';
}

function emptyAggregate(): AggregateRow {
  return {
    newOrders: 0,
    previousOrders: 0,
    confirmationNumerator: 0,
    confirmationDenominator: 0,
    previousConfirmationNumerator: 0,
    previousConfirmationDenominator: 0,
    medianConfirmationMinutes: null,
    medianConfirmationSamples: 0,
    previousMedianConfirmationMinutes: null,
    previousMedianConfirmationSamples: 0,
    needsAttention: 0,
    overdueAttention: 0,
    needsReview: 0,
    aiFailed: 0,
    funnelConfirmed: 0,
    funnelExported: 0,
    funnelShipmentStarted: 0,
    failedExports: 0,
    failedShipments: 0,
  };
}
