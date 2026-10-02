# Platform administration workspace

**Status:** approved for implementation

**Actor:** Sales AITO platform administrator

**Capability id:** `platform-admin-workspace`

## Objective

Replace the current platform-admin card list with a dedicated, responsive administration workspace that lets an operator answer two questions quickly:

1. Which Sales AITO customer organization needs attention?
2. Are the platform and its background queues operating normally?

In this capability, a **client** means a Sales AITO tenant organization. It never means that tenant's Instagram customer. Success means a platform administrator can identify a degraded queue and open the affected organization's safe summary within two navigation actions without gaining access to tenant business content.

## Scope

### Included

- A separate admin shell with persistent desktop navigation and a mobile drawer.
- An overview dashboard with privacy-safe platform KPIs and operational health.
- A client table with sequential numbering, search, status filtering, sorting and a clickable row plus an explicit **View** action.
- A client-detail page with organization identity, owner email, member/order aggregates, status, creation date, block/unblock control and the existing data-lifecycle controls.
- An operations page with API/database reachability and BullMQ queue counts, worker presence, backlog age and safe status labels.
- Ukrainian and English interface copy selected from the signed-in administrator's locale.
- Responsive, keyboard-accessible states and shared Sales AITO button variants.

### Not included

- Tenant impersonation or links into a tenant workspace.
- Conversations, customer contacts, addresses, attachments, order rows, product data, payment facts or raw logs.
- Arbitrary SQL, raw Prometheus output, job payloads, job retry/removal controls or infrastructure secrets.
- Billing, subscription enforcement, individual tenant-user administration or a new authorization role.
- Third-party incident management or long-term metrics storage.

## Information architecture

| Route | Navigation label | Responsibility |
|---|---|---|
| `/admin` | Overview | KPI cards, platform state and queue-attention summary |
| `/admin/tenants` | Clients | Searchable, sortable organization table |
| `/admin/tenants/:tenantId` | — | Privacy-safe organization detail and existing administrative actions |
| `/admin/operations` | Operations | Service and background queue diagnostics |

The shell header identifies the platform-administrator context and offers logout. The admin navigation is separate from tenant navigation and does not expose workspace search or tenant notifications.

## Data contracts

The existing `AdminTenantSummary` remains the only organization record exposed to the browser:

```ts
type AdminTenantSummary = {
  tenantId: string;
  tenantName: string;
  status: 'ACTIVE' | 'BLOCKED';
  ownerEmail: string | null;
  userCount: number;
  orderCount: number;
  createdAt: string;
};
```

The overview adds only aggregates derived from those summaries. Operations expose queue names and numeric state only:

```ts
type AdminQueueSummary = {
  queue: 'instagram' | 'catalogue' | 'delivery' | 'telegram' | 'tenant-lifecycle';
  status: 'HEALTHY' | 'IDLE' | 'ATTENTION';
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  workerCount: number;
  oldestPendingAt: string | null;
  available: boolean;
};
```

The operations summary reports PostgreSQL as `HEALTHY` only after a live `SELECT 1` probe. Probe errors are reduced to `ATTENTION`; exception text and connection details are never returned.

No job id, payload, error message, tenant id or customer identifier may be returned by the operations endpoint. A queue is `ATTENTION` when it has failed jobs or pending work without a worker. No worker and no pending work is `IDLE`, not an incident. The platform summary is degraded when at least one queue needs attention.

## Security and privacy invariants

- Every admin endpoint remains protected by `PLATFORM_ADMIN`; middleware still redirects tenant users away from `/admin`.
- Organization aggregates continue to come from the existing restricted `platform_tenant_directory()` and `platform_order_counts()` functions.
- Client detail is resolved from the same aggregate result, not by bypassing RLS on business tables.
- Queue monitoring reads counts and worker metadata only. Job bodies, return values and failure reasons never cross the API boundary.
- Blocking remains a deliberate mutation with confirmation, session revocation and `LoadingButton` feedback.
- Existing step-up and idempotency requirements for lifecycle export/deletion remain unchanged.

## Failure handling

- If the overview cannot load, the route fails closed and displays the existing safe application error boundary; it must not substitute fabricated healthy data.
- A queue inspection failure returns that queue as `ATTENTION` with zeroed counters and a safe availability flag; it does not expose the provider exception.
- An unknown tenant detail returns the normal 404 page.
- Block/unblock preserves the current state when the API fails and shows a localized, non-sensitive form-level error.

## Tech stack and project structure

- Next.js 16 / React 19 server routes for data loading.
- Client components only for shell navigation, table interaction and mutations.
- NestJS 11 admin controller/service for platform data.
- BullMQ 5 queue inspection through narrow injectable monitor interfaces.
- Zod contracts in `packages/contracts/src/auth.ts`.
- Vitest and Testing Library colocated tests; Playwright for the final browser path.

Primary locations:

- `apps/web/app/admin/**` — admin routes and layout.
- `apps/web/src/components/admin-*.tsx` — shell, dashboard, tables and detail UI.
- `apps/api/src/admin/**` — aggregate and operations endpoints.
- `packages/contracts/src/auth.ts` — response schemas and inferred types.
- `docs/features/README.md` — capability index.

## Code style

Use explicit privacy-safe view models and exhaustive statuses:

```ts
const status: AdminQueueSummary['status'] = failed > 0 || (pending > 0 && workerCount === 0)
  ? 'ATTENTION'
  : workerCount === 0
    ? 'IDLE'
    : 'HEALTHY';
```

Use shared `primary-button`, `secondary-button`, `danger-button`, `text-button` and `icon-button` classes. Async mutations use `LoadingButton`. No browser-default or legacy button tokens are permitted.

## Commands

- Focused API tests: `pnpm --filter @autosale/api test -- src/admin/admin.service.spec.ts src/admin/admin.controller.spec.ts`
- Focused web tests: `pnpm --filter @autosale/web test -- src/components/admin-dashboard.spec.tsx src/components/admin-tenants-table.spec.tsx src/components/admin-shell.spec.tsx`
- Contracts tests: `pnpm --filter @autosale/contracts test`
- Typecheck: `pnpm typecheck`
- Production build: `pnpm build`
- Full tests: `pnpm test`

## Testing strategy

- Contract tests reject extra or sensitive queue fields.
- Service tests prove aggregate calculations, queue-state classification and safe degradation when queue inspection fails.
- Controller tests prove platform-admin authorization remains the only access path.
- Component tests prove privacy exclusions, navigation, table search/filter/sort, keyboard row activation, status rendering and mutation feedback.
- Browser acceptance covers desktop and mobile shell navigation, client-detail navigation and an operations view without horizontal overflow.
- Existing RLS and lifecycle suites remain regression gates.

## Boundaries

### Always

- Preserve tenant isolation and aggregate-only platform administration.
- Keep all dates locale-aware and all statuses human-readable.
- Use shared design-system buttons and accessible table/navigation semantics.
- Update this document and the feature index when behavior changes.

### Ask first

- Adding a new platform role, schema migration, third-party monitoring dependency or mutation over queue jobs.
- Exposing any tenant integration identifier or user-level listing.

### Never

- Expose business data, job payloads, raw errors, credentials or object-storage addresses.
- Add impersonation or a tenant-workspace deep link.
- Report a fabricated healthy state after a monitoring failure.

## Success criteria

1. `/admin` has a responsive sidebar and shows total/active/blocked clients, users, orders, newly created clients and operational state.
2. `/admin/tenants` renders a real table with number, organization, owner, users, orders, status, date and action; search, filter and sorting are covered by tests.
3. Clicking or keyboard-activating a row opens `/admin/tenants/:tenantId`; the explicit **View** action does the same.
4. The detail route shows only the approved aggregate fields and retains block/unblock plus lifecycle administration.
5. `/admin/operations` lists all configured queues with numeric counts, worker presence, oldest pending age and a safe status.
6. No page contains tenant conversations, contacts, addresses, attachments, order contents, raw job information or tenant-workspace links.
7. Desktop and 390 px mobile layouts have no unintended horizontal overflow and preserve keyboard navigation.
8. Focused tests, full typecheck, production build and relevant browser acceptance pass.

## Open questions

None block this vertical slice. Historical charts, alert delivery, queue mutations and external incident tooling remain separate future capabilities.
