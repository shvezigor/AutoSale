import type { PrismaClient } from '@autosale/database';
import { describe, expect, it, vi } from 'vitest';

import { DashboardService } from './dashboard.service.js';

describe('DashboardService', () => {
  it('exports the operational dashboard service', async () => {
    const module = await import('./dashboard.service.js').catch(() => ({}));
    expect(module).toHaveProperty('DashboardService');
  });

  it('returns tenant-scoped period metrics, actions, and sanitized integration states', async () => {
    const prisma = fakePrisma();
    const service = new DashboardService(prisma as unknown as PrismaClient);
    const now = new Date('2026-09-17T07:00:00.000Z');

    const result = await service.summary('tenant-a', '7d', now);

    expect(result).toMatchObject({
      generatedAt: now.toISOString(),
      period: { key: '7d', start: '2026-09-10T21:00:00.000Z', end: now.toISOString(), timezone: 'Europe/Kyiv' },
      metrics: {
        newOrders: { value: 10, previousValue: 5, changePercent: 100 },
        needsAttention: { value: 3, overdue: 1, review: 2, aiFailed: 1 },
        confirmationRate: { value: 0.8, numerator: 8, denominator: 10, previousValue: 0.6, changePercentagePoints: 20 },
        medianConfirmationMinutes: { value: 30, sampleSize: 4, previousValue: 60, previousSampleSize: 2, changePercent: -50 },
      },
      funnel: { created: 10, confirmed: 8, exported: 6, shipmentStarted: 4, exportConfigured: true },
      issues: { failedExports: 2, failedShipments: 1 },
    });
    expect(result.dailyOrders).toHaveLength(7);
    expect(result.dailyOrders.at(-1)).toEqual({ date: '2026-09-17', confirmed: 3, needsReview: 1, processingOrFailed: 0, cancelled: 0 });
    expect(result.queue[0]).toMatchObject({ id: '11111111-1111-4111-8111-111111111111', participantName: 'Олена', productLabel: 'Сукня', status: 'NEEDS_REVIEW' });
    expect(result.integrations).toEqual([
      { key: 'instagram', state: 'active', label: 'Instagram', detail: '@shop', href: '/settings?tab=social' },
      { key: 'google-sheets', state: 'active', label: 'Google Sheets', detail: 'Orders', href: '/settings?tab=data' },
      { key: 'nova-poshta', state: 'active', label: 'Нова Пошта', detail: 'Main', href: '/settings?tab=delivery' },
      { key: 'meest', state: 'attention', label: 'Meest', detail: null, href: '/settings?tab=delivery' },
      { key: 'ukrposhta', state: 'not-configured', label: 'Укрпошта', detail: null, href: '/settings?tab=delivery' },
    ]);

    for (const [query] of prisma.$queryRaw.mock.calls) expect(query.values).toContain('tenant-a');
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a' }), take: 5 }));
    expect(prisma.instagramConnection.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a' } }));
    expect(prisma.googleSheetsDestination.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a' } }));
    expect(prisma.deliveryConnection.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a' } }));
  });

  it('returns an honest empty state when a tenant has no activity and Sheets is disconnected', async () => {
    const prisma = fakePrisma();
    prisma.$queryRaw.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    prisma.order.findMany.mockResolvedValue([]);
    prisma.instagramConnection.findUnique.mockResolvedValue(null);
    prisma.googleSheetsDestination.findUnique.mockResolvedValue({ status: 'DISCONNECTED', sheetName: 'Old sheet', errorSummary: null });
    prisma.deliveryConnection.findMany.mockResolvedValue([]);

    const result = await new DashboardService(prisma as unknown as PrismaClient)
      .summary('empty-tenant', '30d', new Date('2026-09-17T07:00:00.000Z'));

    expect(result.metrics).toMatchObject({
      newOrders: { value: 0, previousValue: 0, changePercent: null },
      needsAttention: { value: 0, overdue: 0, review: 0, aiFailed: 0 },
      confirmationRate: { value: null, numerator: 0, denominator: 0, previousValue: null, changePercentagePoints: null },
      medianConfirmationMinutes: { value: null, sampleSize: 0, previousValue: null, previousSampleSize: 0, changePercent: null },
    });
    expect(result.funnel).toEqual({ created: 0, confirmed: 0, exported: null, shipmentStarted: 0, exportConfigured: false });
    expect(result.queue).toEqual([]);
    expect(result.dailyOrders).toHaveLength(30);
    expect(result.integrations.find((item) => item.key === 'google-sheets')).toMatchObject({ state: 'not-configured', detail: 'Old sheet' });
  });
});

function fakePrisma() {
  return {
    $queryRaw: vi.fn()
      .mockResolvedValueOnce([{
        newOrders: 10n,
        previousOrders: 5n,
        confirmationNumerator: 8n,
        confirmationDenominator: 10n,
        previousConfirmationNumerator: 3n,
        previousConfirmationDenominator: 5n,
        medianConfirmationMinutes: 30,
        medianConfirmationSamples: 4n,
        previousMedianConfirmationMinutes: 60,
        previousMedianConfirmationSamples: 2n,
        needsAttention: 3n,
        overdueAttention: 1n,
        needsReview: 2n,
        aiFailed: 1n,
        funnelConfirmed: 8n,
        funnelExported: 6n,
        funnelShipmentStarted: 4n,
        failedExports: 2n,
        failedShipments: 1n,
      }])
      .mockResolvedValueOnce([{ day: '2026-09-17', confirmed: 3n, needsReview: 1n, processingOrFailed: 0n, cancelled: 0n }]),
    order: { findMany: vi.fn().mockResolvedValue([{
      id: '11111111-1111-4111-8111-111111111111',
      status: 'NEEDS_REVIEW',
      overallConfidence: 0.83,
      createdAt: new Date('2026-09-15T10:00:00.000Z'),
      sortProduct: 'Сукня',
      conversation: { displayName: 'Олена', profile: null },
    }]) },
    instagramConnection: { findUnique: vi.fn().mockResolvedValue({ status: 'ACTIVE', displayName: '@shop', lastErrorCode: null }) },
    googleSheetsDestination: { findUnique: vi.fn().mockResolvedValue({ status: 'ACTIVE', sheetName: 'Orders', errorSummary: null }) },
    deliveryConnection: { findMany: vi.fn().mockResolvedValue([
      { provider: 'NOVA_POSHTA', status: 'ACTIVE', accountLabel: 'Main', lastErrorCode: null },
      { provider: 'MEEST', status: 'NEEDS_ATTENTION', accountLabel: null, lastErrorCode: 'secret-provider-code' },
    ]) },
  };
}
