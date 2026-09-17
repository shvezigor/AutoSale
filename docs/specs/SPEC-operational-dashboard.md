# Spec: Operational Dashboard

Status: proposed
Module id: `operational-dashboard`

## Objective

Replace the fixture-backed dashboard with a tenant-scoped operational control center for an AutoSale owner or manager. The page must answer two questions without requiring the user to inspect several sections:

1. What happened during the selected period?
2. What needs attention now?

The first version uses only facts already stored in PostgreSQL. It does not present revenue, average order value, product rankings, or Instagram source attribution because orders do not yet contain immutable price snapshots or a lead-source dimension.

### Primary user story

As a store owner or manager, I can open the dashboard, select 7, 30, or 90 days, understand order-processing performance, and navigate directly to the orders that require action.

### Product outcome

- Reduce the time required to discover stalled orders and failed downstream operations.
- Make the dashboard a daily starting point rather than a decorative report.
- Establish trustworthy metric definitions that can later support financial analytics.

### Dashboard information architecture

1. **Header and period control** — title, last-refresh time, and 7/30/90-day selector; 30 days is the default.
2. **Attention banner** — one prioritized action based on the oldest review/AI-failed order, with a direct link to the queue. It is omitted when no action is required.
3. **Four KPI cards**:
   - New orders in the selected period.
   - Needs attention now.
   - Confirmation rate for the selected-period cohort.
   - Median time to confirmation for confirmed orders in the selected-period cohort.
4. **Order dynamics** — accessible stacked daily bars for order cohorts by current state: confirmed, awaiting review, processing/failed, and cancelled.
5. **Operational funnel** — unique orders from the selected-period cohort that were created, confirmed, successfully exported, and passed into shipment creation.
6. **Action area**:
   - the oldest orders needing review or with failed AI processing;
   - current export and shipment failures;
   - current integration state for Instagram, Google Sheets, and delivery providers.

### Metric definitions

All order cohort metrics select orders where `tenantId` equals the authenticated membership tenant and `createdAt` falls in `[periodStart, periodEnd)`. `periodEnd` is the request time. The period begins at the start of the first included calendar day in `Europe/Kyiv`; 7 days therefore includes today and the preceding 6 calendar days. Daily buckets also use `Europe/Kyiv`.

| Metric | Definition |
|---|---|
| New orders | Count of all orders created in the selected period. |
| Needs attention | Current all-time count of orders in `NEEDS_REVIEW` or `AI_FAILED`; it intentionally does not change with the period selector. |
| Overdue attention | Needs-attention orders older than 24 hours, shown as supporting text rather than a fabricated trend. |
| Confirmation rate | `(APPROVED + AUTO_APPROVED) / all non-AI_PROCESSING orders` in the selected-period cohort. If the denominator is zero, show `—`, not `0%`. |
| Median confirmation time | Median of `approvedAt - createdAt` for `APPROVED` orders in the cohort with a valid `approvedAt`. `AUTO_APPROVED` is excluded until its decision timestamp is persistently available. If no samples exist, show `—`. |
| Period comparison | New orders, confirmation rate, and median confirmation time are compared with the immediately preceding period of equal calendar-day length. If the previous denominator/sample is zero, show `—`. Lower confirmation time is displayed as improvement; higher order count/rate is displayed as improvement. |
| Daily order state | Each order created that day is counted once using its current status group. |
| Funnel: created | All orders in the cohort. |
| Funnel: confirmed | Unique cohort orders currently in `APPROVED` or `AUTO_APPROVED`. |
| Funnel: exported | Unique cohort orders whose latest export is successful. If Google Sheets export is not configured, the stage is marked unavailable rather than interpreted as 0% performance. |
| Funnel: shipment | Unique cohort orders with at least one shipment beyond `DRAFT`. |
| Export failures | Current exports whose latest status is `FAILED`. |
| Shipment failures | Current shipments in `FAILED`, plus shipments with a non-null `lastErrorCode`. Duplicate shipments count once. |

The API returns values and raw numerator/denominator or sample counts where relevant, so the UI never has to infer metric validity.

### Interaction contract

- Changing the period updates the URL (`?period=7d`, `30d`, or `90d`) and refreshes all period-scoped metrics while preserving a shareable state.
- KPI cards and chart segments are links when a truthful destination filter exists.
- Needs-attention links open `/orders?status=NEEDS_REVIEW`; a separate AI-failed link is presented when failed orders exist, because the current orders endpoint accepts one status at a time.
- Selecting a daily chart segment opens the orders list with the represented status and date range once those list filters are supported. Until then, the segment exposes a tooltip and the chart-level action links to `/orders`; the UI must not generate ineffective query parameters.
- Funnel stages link to the nearest supported operational destination. Unsupported deep filters remain non-linking visual stages.
- Queue entries link to the corresponding order detail/review surface.
- Interactive SVG elements are keyboard reachable, provide visible focus, and expose the same data in a screen-reader table or accessible list.
- Loading, empty, partial-data, and error states retain the dashboard layout and never substitute fixture values.

## Tech Stack

- TypeScript 5.9
- Next.js 16 App Router with React 19 server and client components
- NestJS 11 API
- PostgreSQL through Prisma
- Zod contracts in `packages/contracts`
- Vitest and Testing Library; Playwright for browser acceptance
- Existing AutoSale CSS design system and inline SVG/CSS charts; no new chart dependency

## API Contract

`GET /api/dashboard?period=7d|30d|90d`

- Requires an authenticated tenant membership with role `MANAGER` or higher.
- Rejects unknown query fields or period values with `400`.
- Never accepts `tenantId` from the client.
- Returns a Zod-validated `DashboardResponse` from `@autosale/contracts/dashboard`.
- Performs grouped/aggregate database queries; it must not load unbounded order, message, export, or shipment rows into application memory.
- Response shape:

```ts
type DashboardResponse = {
  generatedAt: string;
  period: {
    key: '7d' | '30d' | '90d';
    start: string;
    end: string;
    timezone: 'Europe/Kyiv';
  };
  metrics: {
    newOrders: DeltaMetric;
    needsAttention: { value: number; overdue: number; review: number; aiFailed: number };
    confirmationRate: RatioMetric;
    medianConfirmationMinutes: SampleMetric;
  };
  dailyOrders: Array<{
    date: string;
    confirmed: number;
    needsReview: number;
    processingOrFailed: number;
    cancelled: number;
  }>;
  funnel: {
    created: number;
    confirmed: number;
    exported: number | null;
    shipmentStarted: number;
    exportConfigured: boolean;
  };
  queue: Array<{
    id: string;
    participantName: string | null;
    productLabel: string | null;
    status: 'NEEDS_REVIEW' | 'AI_FAILED';
    confidence: number | null;
    createdAt: string;
  }>;
  issues: {
    failedExports: number;
    failedShipments: number;
  };
  integrations: Array<{
    key: 'instagram' | 'google-sheets' | 'nova-poshta' | 'meest' | 'ukrposhta';
    state: 'active' | 'attention' | 'not-configured';
    label: string;
    detail: string | null;
    href: string;
  }>;
};
```

`DeltaMetric`, `RatioMetric`, and `SampleMetric` include a nullable comparison plus the denominator/sample count needed to distinguish zero from unavailable data.

## Commands

Run from the repository root:

```powershell
pnpm --filter @autosale/contracts test
pnpm --filter @autosale/api test
pnpm --filter @autosale/web test
pnpm --filter @autosale/api typecheck
pnpm --filter @autosale/web typecheck
pnpm --filter @autosale/web build
pnpm test:e2e
```

The final change must also pass the repository-wide checks:

```powershell
pnpm test
pnpm typecheck
pnpm build
```

## Project Structure

```text
packages/contracts/src/dashboard.ts          Shared response schema and types
apps/api/src/dashboard/                      Tenant-scoped controller, service, module, tests
apps/api/src/app.module.ts                   Dashboard module registration
apps/web/src/api/dashboard.ts                Server-side dashboard API client
apps/web/src/components/dashboard/           KPI, chart, funnel, queue, health components
apps/web/app/(workspace)/dashboard/          Page, loading/error states, page tests
apps/web/src/i18n/                            Ukrainian and English dashboard copy
apps/web/app/globals.css                     Existing design-system styles and responsive rules
docs/specs/                                  This specification
```

## Code Style

Use explicit domain names, tenant scope at the service boundary, Zod parsing at the HTTP boundary, and typed presentational props. Avoid generic `data`, `item`, or `value` names where the domain meaning is known.

```ts
@Get()
summary(
  @CurrentPrincipal() principal: AuthPrincipal,
  @Query() query: unknown,
): Promise<DashboardResponse> {
  const parsed = dashboardQuerySchema.safeParse(query);
  if (!parsed.success) throw new BadRequestException('Invalid dashboard query');
  return this.dashboard.summary(principal.tenantId!, parsed.data.period);
}
```

- Use existing formatting and import conventions.
- Keep aggregation semantics in the API service, not React components.
- Keep visual components deterministic and independently testable.
- Add all user-facing text to both `uk` and `en` locale dictionaries.
- Use semantic HTML first; SVG supplements rather than replaces accessible text.

## Testing Strategy

### Contracts

- Accept valid responses for all periods, zero-data states, unavailable export stages, and nullable comparisons.
- Reject malformed dates, negative counts, invalid states, and incomplete bucket records.

### API unit tests

- Every query is tenant-scoped.
- 7/30/90-day boundaries and previous-period comparisons use `Europe/Kyiv`, including a daylight-saving transition fixture.
- Status grouping, confirmation-rate denominator, median calculation, overdue threshold, unique funnel counts, and latest-export semantics match the definitions above.
- Empty tenants return valid zero/unavailable values.
- Queue is oldest-first and capped at five entries.
- Integration failures expose sanitized state only, never provider secrets or raw error payloads.

### API controller tests

- Authentication/membership is required.
- Valid periods are forwarded; invalid or extra query fields return `400`.
- The authenticated tenant id, never request input, reaches the service.

### Web component/page tests

- Fixture/demo labels and fake revenue/source charts are absent.
- Default and selected period states render correctly.
- Values, unavailable states, comparisons, tooltips, links, and queue actions reflect the API response.
- Empty and partial-data states remain useful.
- Charts have accessible names, keyboard focus, and a non-visual data representation.
- Ukrainian and English locale completeness remains green.

### Browser acceptance

- Desktop and narrow mobile layouts have no horizontal page overflow.
- Period selection changes the URL and visible data.
- Needs-review and AI-failed actions open the correct filtered order list.
- Focus order, visible focus, hover/focus tooltips, and reduced-motion behavior are usable.

## Boundaries

### Always

- Scope every database query by the authenticated `tenantId`.
- Use PostgreSQL as the source of truth and return explicit unavailable states.
- Validate query and response contracts.
- Preserve the approved AutoSale visual language, responsive sidebar/header behavior, and bilingual UI.
- Use aggregate/grouped queries and cap actionable lists.
- Run targeted tests before repository-wide verification.

### Ask first

- Any Prisma schema migration or persistent aggregate table.
- Adding a charting, date/time, or analytics dependency.
- Changing existing order-list API filters or authorization roles.
- Expanding v1 into revenue, average check, product rankings, or lead attribution.

### Never

- Display fabricated, randomly generated, or stale fallback metrics as real data.
- Treat shipment declared value or COD amount as revenue.
- Reconstruct historical order value from the current mutable product price.
- Accept a tenant id from the client or aggregate across tenants.
- Expose customer phone numbers, message contents, provider tokens, or raw integration errors on the dashboard.
- Block the whole dashboard because one integration or secondary aggregate is unavailable.

## Success Criteria

- The dashboard contains no fixture metrics and every visible value traces to the authenticated tenant's PostgreSQL records.
- The 7/30/90-day selector produces correctly bounded, shareable views; 30 days is the default.
- The four KPI definitions, daily chart, funnel, queue, failures, and integration states match this spec in automated tests.
- At least one actionable route exists for each displayed current problem category.
- A tenant with no activity receives a clear first-use state, not a broken or misleading dashboard.
- The dashboard works at 375 px and common desktop widths, is keyboard operable, and exposes chart data to assistive technology.
- No new runtime dependency or database migration is required for v1.
- Targeted tests, repository-wide tests, type checks, production build, and browser acceptance pass.

## Deferred Work

- Revenue, gross/net sales, refunds, and average order value after immutable line-price and currency snapshots are added to orders.
- Product and category rankings after financial semantics are established.
- Direct message/comment/story/manual attribution after a persistent lead-source dimension is captured.
- Tenant-configurable timezone; v1 uses `Europe/Kyiv` explicitly.
- Arbitrary custom date ranges and saved dashboard views.
- Historical backlog snapshots and SLA trend reporting.

## Open Questions

None for v1 after approval of the assumptions on 2026-09-16.
