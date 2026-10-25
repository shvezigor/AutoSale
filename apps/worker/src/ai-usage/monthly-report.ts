import { Prisma } from '@autosale/database';

// Local precision avoids changing Prisma's process-wide Decimal configuration.
const Money = Prisma.Decimal.clone({ precision: 80, toExpNeg: -100, toExpPos: 100 });
export type ReportPeriod = { from: Date; until: Date };
export type UsageAttempt = Pick<Prisma.AiProviderUsageAttemptGetPayload<{}>,
  'id' | 'tenantId' | 'purpose' | 'provider' | 'requestedModel' | 'returnedModel' | 'startedAt' | 'finalizedAt' | 'outcome' | 'inputTokens' | 'outputTokens' | 'cachedInputTokens'>;
export type UsageRate = { version: string; source: string; model: string; currency: string; effectiveFrom: Date; effectiveUntil: Date;
  inputPerMillion: string | null; outputPerMillion: string | null; cachedInputPerMillion: string | null };
export type ProviderScope = { accountId: string; projectId: string; verified: boolean };
export type ProviderInvoice = { month: string; accountId: string; projectId: string; currency: string; subtotal: string; credits: string; taxes: string; evidenceReviewed: boolean; tenantIds: string[] };
export type InfrastructureInvoice = { month: string; currency: string; attributableAmount: string; evidenceReviewed: boolean; allocationApproved: boolean };
export type CollectionEvidence = ReportPeriod & { tenantIds: string[]; complete: boolean };
export type CollectionGap = ReportPeriod & { tenantId: string | null; reason: 'COLLECTION_DISABLED' | 'METERING_FAILURE' | 'RETENTION_EXPIRED' | 'HISTORICAL_INCOMPLETE' | 'OTHER' };
export type MonthlyReportInput = { period: ReportPeriod; tenantIds: string[]; testTenantIds: string[]; providerScope: ProviderScope;
  rates: UsageRate[]; providerInvoice: ProviderInvoice | null; infrastructureInvoice: InfrastructureInvoice | null;
  collectionEvidence: CollectionEvidence | null; collectionGaps: CollectionGap[]; attempts: UsageAttempt[];
  orderIds: { id: string; tenantId: string; createdAt: Date }[] };
export type CostStatus = 'COMPLETE' | 'PROVISIONAL';
type Coverage = { tenantId: string | null; reason: string; count: number };
// Token aggregates can exceed MAX_SAFE_INTEGER within the authorized reader bounds.
type Totals = { attempts: number; orders: number; inputTokens: string; outputTokens: string; cachedInputTokens: string;
  knownAiCost: string; setupKnownAiCost: string; unpricedAttempts: number; aiCostPerOrder: string | null };

export function utcMonth(month: string): ReportPeriod {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 2000 || Number(month.slice(0, 4)) > 9998) throw new Error('Invalid UTC month');
  const from = new Date(`${month}-01T00:00:00.000Z`);
  const until = new Date(from);
  until.setUTCMonth(until.getUTCMonth() + 1);
  return { from, until };
}
const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));
const inPeriod = (date: Date, period: ReportPeriod) => date >= period.from && date < period.until;
const ratio = (amount: string, orders: number) => orders === 0 ? null : new Money(amount).div(orders).toDecimalPlaces(12).toString();
const emptyTotals = (): Totals => ({ attempts: 0, orders: 0, inputTokens: '0', outputTokens: '0', cachedInputTokens: '0', knownAiCost: '0', setupKnownAiCost: '0', unpricedAttempts: 0, aiCostPerOrder: null });
const addCost = (a: string, b: string) => new Money(a).plus(b).toString();

/** Exact integer addition with JSON-safe serialization at every aggregate layer. */
export function sumTokenCounts(left: string, right: string | number): string {
  if (!/^(0|[1-9]\d*)$/.test(left) || (typeof right === 'number'
    ? !Number.isSafeInteger(right) || right < 0
    : !/^(0|[1-9]\d*)$/.test(right))) throw new Error('Invalid integer token total');
  return (BigInt(left) + BigInt(right)).toString();
}

/** Pure private aggregate. Unknown cost is never substituted with a measured zero. */
export function buildMonthlyAiUsageReport(input: MonthlyReportInput) {
  const { period, tenantIds, testTenantIds } = input;
  const month = period.from.toISOString().slice(0, 7);
  const expectedPeriod = utcMonth(month);
  if (+period.from !== +expectedPeriod.from || +period.until !== +expectedPeriod.until || tenantIds.length === 0 ||
    new Set(tenantIds).size !== tenantIds.length || new Set(testTenantIds).size !== testTenantIds.length || testTenantIds.some((id) => !tenantIds.includes(id))) throw new Error('Invalid report scope');
  const seen = new Set<string>();
  for (const row of [...input.attempts, ...input.orderIds]) if (!tenantIds.includes(row.tenantId)) throw new Error('Unauthorized report evidence');
  const coverage: Coverage[] = [];
  function gap(reason: string, tenantId: string | null = null) {
    const existing = coverage.find((row) => row.reason === reason && row.tenantId === tenantId);
    if (existing) existing.count++;
    else coverage.push({ tenantId, reason, count: 1 });
  }
  const currency = input.providerInvoice?.currency ?? input.rates[0]?.currency ?? null;
  if (!input.providerScope.verified) gap('PROJECT_SCOPE_UNVERIFIED');
  const evidence = input.collectionEvidence;
  if (!evidence?.complete || evidence.from > period.from || evidence.until < period.until || !sameIds(evidence.tenantIds, tenantIds)) gap('COLLECTION_EVIDENCE_MISSING');
  for (const row of input.collectionGaps) {
    if (row.tenantId !== null && !tenantIds.includes(row.tenantId)) throw new Error('Unauthorized collection gap');
    if (row.from < period.until && row.until > period.from) gap(row.reason, row.tenantId);
  }
  const tenants = tenantIds.map((tenantId) => ({ tenantId, cohort: testTenantIds.includes(tenantId) ? 'TEST' as const : 'INCLUDED' as const, ...emptyTotals() }));
  const buckets: (Totals & { tenantId: string; purpose: UsageAttempt['purpose']; model: string })[] = [];
  for (const attempt of input.attempts) {
    if (seen.has(attempt.id)) throw new Error('Duplicate attempt evidence');
    seen.add(attempt.id);
    for (const tokens of [attempt.inputTokens, attempt.outputTokens, attempt.cachedInputTokens]) {
      if (tokens !== null && (!Number.isInteger(tokens) || tokens < 0 || tokens > 2_147_483_647)) throw new Error('Invalid token evidence');
    }
    if (attempt.cachedInputTokens !== null && (attempt.inputTokens === null || attempt.cachedInputTokens > attempt.inputTokens)) throw new Error('Invalid cached token evidence');
    if (!inPeriod(attempt.startedAt, period)) continue;
    const tenant = tenants.find((row) => row.tenantId === attempt.tenantId)!;
    const model = attempt.returnedModel ?? attempt.requestedModel;
    let bucket = buckets.find((row) => row.tenantId === attempt.tenantId && row.purpose === attempt.purpose && row.model === model);
    if (!bucket) { bucket = { tenantId: attempt.tenantId, purpose: attempt.purpose, model, ...emptyTotals() }; buckets.push(bucket); }
    let cost = new Money(0);
    let unpriced = false;
    const missing = (reason: string) => { gap(reason, attempt.tenantId); unpriced = true; };
    if (attempt.finalizedAt && attempt.finalizedAt >= period.until) gap('MONTH_BOUNDARY_FINALIZATION', attempt.tenantId);
    if (attempt.outcome === 'STARTED' || attempt.outcome === 'CHARGE_UNKNOWN') missing(attempt.outcome);
    else if (attempt.outcome !== 'NOT_SENT') {
      if (attempt.outcome === 'USAGE_MISSING' || attempt.inputTokens === null || attempt.outputTokens === null) missing('USAGE_MISSING');
      const rates = input.rates.filter((rate) => rate.model === model && rate.effectiveFrom <= attempt.startedAt && rate.effectiveUntil > attempt.startedAt);
      const rate = rates.length === 1 ? rates[0] : undefined;
      if (!rate) missing(rates.length > 1 ? 'RATE_AMBIGUOUS' : 'RATE_MISSING');
      else if (rate.currency !== currency) missing('RATE_CURRENCY_MISMATCH');
      else {
        function price(tokens: number | null, perMillion: string | null) {
          if (tokens === null) return;
          if (tokens === 0) return;
          if (perMillion === null) { missing('RATE_DIMENSION_MISSING'); return; }
          cost = cost.plus(new Money(tokens).mul(perMillion).div(1_000_000));
        }
        price(attempt.outputTokens, rate.outputPerMillion);
        if (attempt.inputTokens === 0) { /* Explicit zero needs no cached split. */ }
        else if (attempt.inputTokens !== null && attempt.cachedInputTokens === null) missing('CACHED_BREAKDOWN_MISSING');
        else if (attempt.inputTokens !== null && attempt.cachedInputTokens !== null) {
          price(attempt.inputTokens - attempt.cachedInputTokens, rate.inputPerMillion);
          price(attempt.cachedInputTokens, rate.cachedInputPerMillion);
        }
      }
    }
    for (const target of [tenant, bucket]) {
      target.attempts++;
      target.inputTokens = sumTokenCounts(target.inputTokens, attempt.inputTokens ?? 0);
      target.outputTokens = sumTokenCounts(target.outputTokens, attempt.outputTokens ?? 0);
      target.cachedInputTokens = sumTokenCounts(target.cachedInputTokens, attempt.cachedInputTokens ?? 0);
      target.knownAiCost = addCost(target.knownAiCost, cost.toString());
      if (attempt.purpose.startsWith('CATALOGUE_')) target.setupKnownAiCost = addCost(target.setupKnownAiCost, cost.toString());
      if (unpriced) target.unpricedAttempts++;
    }
  }
  for (const tenant of tenants) {
    tenant.orders = new Set(input.orderIds.filter((row) => row.tenantId === tenant.tenantId && inPeriod(row.createdAt, period)).map((row) => row.id)).size;
    tenant.aiCostPerOrder = ratio(tenant.knownAiCost, tenant.orders);
  }
  function cohort(kind: 'TEST' | 'INCLUDED') {
    const totals = emptyTotals();
    for (const row of tenants.filter((tenant) => tenant.cohort === kind)) {
      for (const key of ['attempts', 'orders', 'unpricedAttempts'] as const) totals[key] += row[key];
      for (const key of ['inputTokens', 'outputTokens', 'cachedInputTokens'] as const) totals[key] = sumTokenCounts(totals[key], row[key]);
      totals.knownAiCost = addCost(totals.knownAiCost, row.knownAiCost);
      totals.setupKnownAiCost = addCost(totals.setupKnownAiCost, row.setupKnownAiCost);
    }
    totals.aiCostPerOrder = ratio(totals.knownAiCost, totals.orders);
    return totals;
  }
  const included = cohort('INCLUDED');
  const testCohort = cohort('TEST');
  const computedPreCredit = addCost(included.knownAiCost, testCohort.knownAiCost);
  const invoice = input.providerInvoice;
  let variance: string | null = null;
  let invoiceAfterCreditsAndTaxes: string | null = null;
  if (!invoice) gap('PROVIDER_INVOICE_MISSING');
  else {
    const matching = invoice.month === month && invoice.accountId === input.providerScope.accountId && invoice.projectId === input.providerScope.projectId && sameIds(invoice.tenantIds, tenantIds);
    if (!matching) gap('PROVIDER_INVOICE_SCOPE_MISMATCH');
    if (!invoice.evidenceReviewed) gap('PROVIDER_INVOICE_UNREVIEWED');
    invoiceAfterCreditsAndTaxes = new Money(invoice.subtotal).minus(invoice.credits).plus(invoice.taxes).toString();
    if (matching) {
      variance = new Money(computedPreCredit).minus(invoice.subtotal).toString();
      if (!new Money(variance).isZero()) gap('INVOICE_VARIANCE');
    }
  }
  const infrastructure = input.infrastructureInvoice;
  let blended: string | null = null;
  if (!infrastructure) gap('INFRASTRUCTURE_INVOICE_MISSING');
  else {
    if (infrastructure.month !== month || !infrastructure.evidenceReviewed) gap('INFRASTRUCTURE_INVOICE_UNVERIFIED');
    if (!infrastructure.allocationApproved) gap('INFRASTRUCTURE_ALLOCATION_UNAPPROVED');
    if (infrastructure.currency !== currency) gap('INFRASTRUCTURE_CURRENCY_MISMATCH');
    else blended = ratio(addCost(included.knownAiCost, infrastructure.attributableAmount), included.orders);
  }
  return { version: 1, status: coverage.length ? 'PROVISIONAL' as CostStatus : 'COMPLETE' as CostStatus,
    period: { from: period.from.toISOString(), until: period.until.toISOString() }, currency,
    included, testCohort, tenants, buckets, coverage,
    providerReconciliation: { computedPreCredit, invoiceSubtotal: invoice?.subtotal ?? null, credits: invoice?.credits ?? null, taxes: invoice?.taxes ?? null, invoiceAfterCreditsAndTaxes, variance },
    infrastructure: { amount: infrastructure?.attributableAmount ?? null, currency: infrastructure?.currency ?? null, globalBlendedCostPerOrder: blended },
    rateVersions: [...new Set(input.rates.map((row) => row.version))],
    interpretation: 'Known AI costs are lower bounds when PROVISIONAL; ratios use those known costs and are rounded to 12 decimal places. Token totals are exact decimal integer strings. Test AI is excluded from included ratios. Infrastructure is global only.',
    excludedCosts: ['LABOUR', 'TAXES', 'PAYMENT_PROVIDER_FEES', 'CUSTOMER_CARRIER_AND_MESSAGE_FEES'],
  };
}
