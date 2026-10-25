import { describe, expect, it } from 'vitest';
import { buildMonthlyAiUsageReport, utcMonth, type MonthlyReportInput, type UsageAttempt } from './monthly-report.js';

const tenant = '11111111-1111-4111-8111-111111111111';
const testTenant = '22222222-2222-4222-8222-222222222222';
const zeroTenant = '33333333-3333-4333-8333-333333333333';
const period = { from: new Date('2026-09-01T00:00:00Z'), until: new Date('2026-10-01T00:00:00Z') };
function attempt(id: string, changes: Partial<UsageAttempt> = {}): UsageAttempt {
  return { id, tenantId: tenant, purpose: 'ORDER_INTENT', provider: 'OPENAI', requestedModel: 'fictional-model', returnedModel: 'fictional-model',
    startedAt: new Date('2026-09-15T00:00:00Z'), finalizedAt: new Date('2026-09-15T00:01:00Z'), outcome: 'REPORTED',
    inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 0, ...changes };
}
export function fixture(): MonthlyReportInput {
  return { period, tenantIds: [tenant, testTenant, zeroTenant], testTenantIds: [testTenant],
    providerScope: { accountId: 'fictional-account', projectId: 'fictional-project', verified: true },
    collectionEvidence: { ...period, tenantIds: [tenant, testTenant, zeroTenant], complete: true }, collectionGaps: [],
    rates: [{ version: 'fictional-v1', source: 'fictional tariff evidence', model: 'fictional-model', currency: 'USD',
      effectiveFrom: period.from, effectiveUntil: period.until, inputPerMillion: '0.1', outputPerMillion: '0.2', cachedInputPerMillion: '0.01' }],
    providerInvoice: { month: '2026-09', accountId: 'fictional-account', projectId: 'fictional-project', currency: 'USD',
      subtotal: '1.5', credits: '0.1', taxes: '0.2', evidenceReviewed: true, tenantIds: [tenant, testTenant, zeroTenant] },
    infrastructureInvoice: { month: '2026-09', currency: 'USD', attributableAmount: '0.9', evidenceReviewed: true, allocationApproved: true },
    attempts: [attempt('intent-and-order-response'), attempt('unused-draft', { purpose: 'REPLY_DRAFT' }),
      attempt('batch-1', { purpose: 'CATALOGUE_COLUMN_MAPPING' }), attempt('batch-2', { purpose: 'CATALOGUE_COLUMN_MAPPING' }),
      attempt('test', { tenantId: testTenant })],
    orderIds: [{ id: 'fictional-order', tenantId: tenant, createdAt: period.from },
      { id: 'fictional-order', tenantId: tenant, createdAt: period.from },
      { id: 'test-order', tenantId: testTenant, createdAt: period.from },
      { id: 'next-month', tenantId: tenant, createdAt: period.until }] };
}

describe('private monthly AI report', () => {
  it('counts ledger attempts once, includes unused drafts/setup, separates explicit test cohort and distinct canonical orders', () => {
    const report = buildMonthlyAiUsageReport(fixture());
    expect(report.status).toBe('COMPLETE');
    expect(report.included).toMatchObject({ attempts: 4, orders: 1, knownAiCost: '1.2', aiCostPerOrder: '1.2', setupKnownAiCost: '0.6' });
    expect(report.testCohort).toMatchObject({ attempts: 1, orders: 1, knownAiCost: '0.3' });
    expect(report.tenants.find((row) => row.tenantId === zeroTenant)).toMatchObject({ orders: 0, aiCostPerOrder: null });
    expect(report.infrastructure).toMatchObject({ amount: '0.9', globalBlendedCostPerOrder: '2.1' });
    expect(report.tenants.every((row) => !('infrastructure' in row))).toBe(true);
    expect(report.providerReconciliation).toMatchObject({ computedPreCredit: '1.5', variance: '0', invoiceAfterCreditsAndTaxes: '1.6' });
  });

  it('prices only known dimensions and exposes unknown-charge, missing cached breakdown and missing rates', () => {
    const input = fixture();
    input.attempts.push(attempt('unknown', { outcome: 'CHARGE_UNKNOWN', inputTokens: null, outputTokens: null, cachedInputTokens: null }),
      attempt('cached-unknown', { cachedInputTokens: null }), attempt('unpriced', { returnedModel: 'fictional-unpriced' }));
    const report = buildMonthlyAiUsageReport(input);
    expect(report.status).toBe('PROVISIONAL');
    expect(report.included.knownAiCost).toBe('1.4'); // only output (0.2) is priceable for unknown cached split
    expect(report.coverage.map((gap) => gap.reason)).toEqual(expect.arrayContaining(['CHARGE_UNKNOWN', 'CACHED_BREAKDOWN_MISSING', 'RATE_MISSING', 'INVOICE_VARIANCE']));
    expect(report.included.unpricedAttempts).toBe(3);
  });

  it.each(['invoice', 'infrastructure', 'collection', 'scope', 'gap', 'allocation', 'currency', 'invoiceScope'] as const)('keeps missing or mismatched %s evidence provisional', (kind) => {
    const input = fixture();
    if (kind === 'invoice') input.providerInvoice = null;
    if (kind === 'infrastructure') input.infrastructureInvoice = null;
    if (kind === 'collection') input.collectionEvidence = null;
    if (kind === 'scope') input.providerScope.verified = false;
    if (kind === 'gap') input.collectionGaps = [{ tenantId: tenant, from: period.from, until: period.until, reason: 'COLLECTION_DISABLED' }];
    if (kind === 'allocation') input.infrastructureInvoice!.allocationApproved = false;
    if (kind === 'currency') input.infrastructureInvoice!.currency = 'UAH';
    if (kind === 'invoiceScope') input.providerInvoice!.tenantIds = [tenant];
    expect(buildMonthlyAiUsageReport(input).status).toBe('PROVISIONAL');
  });

  it('uses effective rates, decimal money and half-open UTC months without inferring free missing usage', () => {
    const input = fixture();
    input.attempts = [attempt('first', { inputTokens: 1, outputTokens: 1 }), attempt('outside', { startedAt: period.until })];
    input.providerInvoice!.subtotal = '0.0000003';
    const report = buildMonthlyAiUsageReport(input);
    expect(report.providerReconciliation.computedPreCredit).toBe('0.0000003');
    expect(report.status).toBe('COMPLETE');
    expect(utcMonth('2026-12')).toEqual({ from: new Date('2026-12-01T00:00:00Z'), until: new Date('2027-01-01T00:00:00Z') });
    expect(() => utcMonth('2026-13')).toThrow();
    input.attempts = [attempt('partial', { outcome: 'USAGE_MISSING', inputTokens: null, cachedInputTokens: null })];
    expect(buildMonthlyAiUsageReport(input).included.knownAiCost).toBe('0.2');
    input.rates[0]!.effectiveUntil = period.from;
    expect(buildMonthlyAiUsageReport(input).included.knownAiCost).toBe('0');
  });

  it('does not leak arbitrary input properties, order IDs, operation IDs or payloads into its output', () => {
    const input = fixture();
    input.attempts = [Object.assign(attempt('secret-attempt'), { operationId: 'secret-operation', response: 'secret-generated-text', request: 'secret-customer-text' })];
    const serialized = JSON.stringify(buildMonthlyAiUsageReport(input));
    expect(serialized).not.toMatch(/secret-|fictional-order|fictional-account|fictional tariff/);
  });

  it('applies each effective rate at its UTC boundary and prices cached and uncached input separately', () => {
    const input = fixture();
    const boundary = new Date('2026-09-16T00:00:00Z');
    input.rates[0]!.effectiveUntil = boundary;
    input.rates.push({ ...input.rates[0]!, version: 'fictional-v2', effectiveFrom: boundary, effectiveUntil: period.until, outputPerMillion: '0.3' });
    input.attempts = [attempt('before', { cachedInputTokens: 500_000 }), attempt('at-boundary', { startedAt: boundary, cachedInputTokens: 500_000 })];
    input.providerInvoice!.subtotal = '0.61'; // 0.05 + 0.005 + 0.2, then 0.05 + 0.005 + 0.3
    const report = buildMonthlyAiUsageReport(input);
    expect(report.providerReconciliation.computedPreCredit).toBe('0.61');
    expect(report.status).toBe('COMPLETE');
    input.rates[1]!.cachedInputPerMillion = null;
    const partial = buildMonthlyAiUsageReport(input);
    expect(partial.providerReconciliation.computedPreCredit).toBe('0.605');
    expect(partial.status).toBe('PROVISIONAL');
    expect(partial.coverage).toContainEqual({ tenantId: tenant, reason: 'RATE_DIMENSION_MISSING', count: 1 });
  });

  it('reports explicit zero and NOT_SENT without inventing unknown charges, but exposes unfinished and month-spanning attempts', () => {
    const input = fixture();
    input.attempts = [attempt('zero', { inputTokens: 0, outputTokens: 0, cachedInputTokens: null }),
      attempt('not-sent', { outcome: 'NOT_SENT', inputTokens: null, outputTokens: null, cachedInputTokens: null })];
    input.providerInvoice!.subtotal = '0';
    expect(buildMonthlyAiUsageReport(input)).toMatchObject({ status: 'COMPLETE', included: { attempts: 2, knownAiCost: '0', unpricedAttempts: 0 } });
    input.attempts.push(attempt('unfinished', { outcome: 'STARTED', inputTokens: null, outputTokens: null, cachedInputTokens: null, finalizedAt: null }),
      attempt('spanning', { finalizedAt: period.until }));
    const report = buildMonthlyAiUsageReport(input);
    expect(report.status).toBe('PROVISIONAL');
    expect(report.coverage.map((gap) => gap.reason)).toEqual(expect.arrayContaining(['STARTED', 'MONTH_BOUNDARY_FINALIZATION']));
    input.infrastructureInvoice!.currency = 'UAH';
    expect(buildMonthlyAiUsageReport(input).infrastructure.globalBlendedCostPerOrder).toBeNull();
  });

  it('retains AI spend for a zero-order tenant with an undefined tenant ratio', () => {
    const input = fixture();
    input.attempts.push(attempt('zero-order-draft', { tenantId: zeroTenant, purpose: 'REPLY_DRAFT' }));
    input.providerInvoice!.subtotal = '1.8';
    const report = buildMonthlyAiUsageReport(input);
    expect(report.status).toBe('COMPLETE');
    expect(report.tenants.find((row) => row.tenantId === zeroTenant)).toMatchObject({ orders: 0, attempts: 1, knownAiCost: '0.3', aiCostPerOrder: null });
    expect(report.included).toMatchObject({ knownAiCost: '1.5', orders: 1, aiCostPerOrder: '1.5' });
  });

  it('rejects unauthorized scope, implicit test exclusions, duplicate attempts and contradictory token evidence', () => {
    const input = fixture();
    input.testTenantIds = ['44444444-4444-4444-8444-444444444444'];
    expect(() => buildMonthlyAiUsageReport(input)).toThrow();
    input.testTenantIds = [testTenant];
    input.attempts.push(input.attempts[0]!);
    expect(() => buildMonthlyAiUsageReport(input)).toThrow();
    input.attempts.pop();
    input.attempts[0]!.cachedInputTokens = 1_000_001;
    expect(() => buildMonthlyAiUsageReport(input)).toThrow();
  });
});
