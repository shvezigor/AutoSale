import { describe, expect, it } from 'vitest';
import * as contracts from './index.js';
import { dashboardQuerySchema, dashboardResponseSchema } from './dashboard.js';

describe('dashboard contracts', () => {
  it('exports a schema for the operational dashboard response', () => {
    expect((contracts as Record<string, unknown>).dashboardResponseSchema).toBeDefined();
  });

  it('accepts a complete operational snapshot and defaults the period to 30 days', () => {
    expect(dashboardQuerySchema.parse({})).toEqual({ period: '30d' });
    expect(dashboardResponseSchema.parse(validResponse()).funnel.exported).toBeNull();
  });

  it('rejects unknown periods, negative counts, and incomplete daily buckets', () => {
    expect(() => dashboardQuerySchema.parse({ period: '365d' })).toThrow();
    expect(() => dashboardQuerySchema.parse({ period: '30d', tenantId: 'other' })).toThrow();
    expect(() => dashboardResponseSchema.parse({
      ...validResponse(),
      metrics: { ...validResponse().metrics, needsAttention: { value: -1, overdue: 0, review: 0, aiFailed: 0 } },
    })).toThrow();
    expect(() => dashboardResponseSchema.parse({ ...validResponse(), dailyOrders: [{ date: '2026-09-16', confirmed: 1 }] })).toThrow();
  });
});

function validResponse() {
  return {
    generatedAt: '2026-09-16T19:00:00.000Z',
    period: { key: '30d', start: '2026-08-18T21:00:00.000Z', end: '2026-09-16T19:00:00.000Z', timezone: 'Europe/Kyiv' },
    metrics: {
      newOrders: { value: 18, previousValue: 12, changePercent: 50 },
      needsAttention: { value: 3, overdue: 1, review: 2, aiFailed: 1 },
      confirmationRate: { value: 0.75, numerator: 12, denominator: 16, previousValue: 0.6, changePercentagePoints: 15 },
      medianConfirmationMinutes: { value: 42, sampleSize: 8, previousValue: null, previousSampleSize: 0, changePercent: null },
    },
    dailyOrders: [{ date: '2026-09-16', confirmed: 2, needsReview: 1, processingOrFailed: 0, cancelled: 0 }],
    funnel: { created: 18, confirmed: 12, exported: null, shipmentStarted: 7, exportConfigured: false },
    queue: [{ id: '11111111-1111-4111-8111-111111111111', participantName: 'Олена', productLabel: 'Сукня', status: 'NEEDS_REVIEW', confidence: 0.83, createdAt: '2026-09-15T10:00:00.000Z' }],
    issues: { failedExports: 0, failedShipments: 1 },
    integrations: [{ key: 'instagram', state: 'active', label: 'Instagram', detail: '@shop', href: '/settings?section=social' }],
  };
}
