import { z } from 'zod';

const nonNegativeInteger = z.number().int().nonnegative();
const nonNegativeNumber = z.number().nonnegative();
const nullableFiniteNumber = z.number().finite().nullable();

export const dashboardPeriodSchema = z.enum(['7d', '30d', '90d']);
export const dashboardQuerySchema = z.object({
  period: dashboardPeriodSchema.default('30d'),
}).strict();

export const dashboardResponseSchema = z.object({
  generatedAt: z.iso.datetime(),
  period: z.object({
    key: dashboardPeriodSchema,
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    timezone: z.literal('Europe/Kyiv'),
  }).strict(),
  metrics: z.object({
    newOrders: z.object({
      value: nonNegativeInteger,
      previousValue: nonNegativeInteger,
      changePercent: nullableFiniteNumber,
    }).strict(),
    needsAttention: z.object({
      value: nonNegativeInteger,
      overdue: nonNegativeInteger,
      review: nonNegativeInteger,
      aiFailed: nonNegativeInteger,
    }).strict(),
    confirmationRate: z.object({
      value: z.number().min(0).max(1).nullable(),
      numerator: nonNegativeInteger,
      denominator: nonNegativeInteger,
      previousValue: z.number().min(0).max(1).nullable(),
      changePercentagePoints: nullableFiniteNumber,
    }).strict(),
    medianConfirmationMinutes: z.object({
      value: nonNegativeNumber.nullable(),
      sampleSize: nonNegativeInteger,
      previousValue: nonNegativeNumber.nullable(),
      previousSampleSize: nonNegativeInteger,
      changePercent: nullableFiniteNumber,
    }).strict(),
  }).strict(),
  dailyOrders: z.array(z.object({
    date: z.iso.date(),
    confirmed: nonNegativeInteger,
    needsReview: nonNegativeInteger,
    processingOrFailed: nonNegativeInteger,
    cancelled: nonNegativeInteger,
  }).strict()),
  funnel: z.object({
    created: nonNegativeInteger,
    confirmed: nonNegativeInteger,
    exported: nonNegativeInteger.nullable(),
    shipmentStarted: nonNegativeInteger,
    exportConfigured: z.boolean(),
  }).strict(),
  queue: z.array(z.object({
    id: z.uuid(),
    participantName: z.string().min(1).nullable(),
    productLabel: z.string().min(1).nullable(),
    status: z.enum(['NEEDS_REVIEW', 'AI_FAILED']),
    confidence: z.number().min(0).max(1).nullable(),
    createdAt: z.iso.datetime(),
  }).strict()).max(5),
  issues: z.object({
    failedExports: nonNegativeInteger,
    failedShipments: nonNegativeInteger,
  }).strict(),
  integrations: z.array(z.object({
    key: z.enum(['instagram', 'google-sheets', 'nova-poshta', 'meest', 'ukrposhta']),
    state: z.enum(['active', 'attention', 'not-configured']),
    label: z.string().min(1),
    detail: z.string().min(1).nullable(),
    href: z.string().startsWith('/'),
  }).strict()),
}).strict();

export type DashboardPeriod = z.infer<typeof dashboardPeriodSchema>;
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
export type DashboardDeltaMetric = DashboardResponse['metrics']['newOrders'];
export type DashboardRatioMetric = DashboardResponse['metrics']['confirmationRate'];
export type DashboardSampleMetric = DashboardResponse['metrics']['medianConfirmationMinutes'];
