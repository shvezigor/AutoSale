# Global Workspace Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the disabled header search with a tenant-scoped command palette for customers, orders and catalogue products.

**Architecture:** Add one stable `/api/search` aggregator that reuses the existing tenant-scoped `OrdersService.list` and `CatalogueService.list` behavior and maps bounded results into a provider-neutral contract. A focused client component owns the dialog, debounce, cancellation, keyboard behavior and navigation; `AppHeader` only places that component in the existing shell.

**Tech Stack:** TypeScript, NestJS, Prisma tenant transactions through existing services, Zod contracts, Next.js/React, Vitest, Testing Library, existing Sales AITO CSS and i18n.

**Spec:** `docs/superpowers/specs/2026-10-02-global-workspace-search-design.md`

## Global Constraints

- Search is limited to the authenticated tenant and requires at least `MANAGER` membership.
- Query length is 2–100 trimmed characters and each result group is capped at 1–10 items, default 5.
- No message content, provider payloads, credentials, cross-tenant data, search history or AI/semantic search.
- Customer identity prefers phone, then Instagram username, then normalized name.
- Use shared button variants; never introduce browser-default action buttons.
- Ukrainian and English copy must ship together.
- Keep `artifacts/`, environment files, credentials and production personal data untracked.

---

### Task 1: Shared search contract

**Files:**
- Create: `packages/contracts/src/search.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/search.spec.ts`

**Interfaces:**
- Produces: `workspaceSearchQuerySchema`, `workspaceSearchResponseSchema`, `WorkspaceSearchQuery`, `WorkspaceSearchResponse`, `WorkspaceSearchCustomer`, `WorkspaceSearchOrder`, `WorkspaceSearchProduct`.
- Result objects contain ready-to-use same-origin `href` values so web navigation does not reconstruct domain rules.

- [ ] **Step 1: Write the failing contract test**

```ts
import { describe, expect, it } from 'vitest';
import { workspaceSearchQuerySchema, workspaceSearchResponseSchema } from './search.js';

describe('workspace search contracts', () => {
  it('normalizes a bounded search query', () => {
    expect(workspaceSearchQuerySchema.parse({ q: '  Ігор  ', limit: '5' })).toEqual({ q: 'Ігор', limit: 5 });
    expect(() => workspaceSearchQuerySchema.parse({ q: 'a' })).toThrow();
    expect(() => workspaceSearchQuerySchema.parse({ q: 'x'.repeat(101) })).toThrow();
  });

  it('accepts grouped results with safe local destinations', () => {
    expect(workspaceSearchResponseSchema.parse({
      query: 'AS-260918',
      customers: [{ key: 'phone:+380501112233', name: 'Олена', context: '+380501112233', href: '/orders?search=%2B380501112233' }],
      orders: [{ id: 'b46c9029-ecdd-4fa5-8c0a-e3146ffe3168', publicNumber: 'AS-260918', customerName: 'Олена', productSummary: 'Двері', status: 'APPROVED', href: '/orders/b46c9029-ecdd-4fa5-8c0a-e3146ffe3168' }],
      products: [{ id: 'e46c9029-ecdd-4fa5-8c0a-e3146ffe3168', sku: 'AUTO-1', name: 'Двері', price: 3700, currency: 'UAH', stockQuantity: 7, href: '/catalogue?search=AUTO-1' }],
    }).query).toBe('AS-260918');
  });
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @autosale/contracts exec vitest run src/search.spec.ts`

Expected: FAIL because `search.ts` does not exist.

- [ ] **Step 3: Implement the schemas and exported types**

Create strict Zod schemas. Constrain every `href` with `z.string().startsWith('/')`, UUIDs with `z.string().uuid()`, result arrays with `.max(10)`, order status with the existing status enum values, and nullable commercial fields explicitly. Export the new module from `packages/contracts/src/index.ts`.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @autosale/contracts exec vitest run src/search.spec.ts && pnpm --filter @autosale/contracts build`

Expected: contract tests and TypeScript build pass.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/search.ts packages/contracts/src/search.spec.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): define workspace search results"
```

---

### Task 2: Tenant-scoped aggregated search API

**Files:**
- Create: `apps/api/src/search/search.service.ts`
- Create: `apps/api/src/search/search.service.spec.ts`
- Create: `apps/api/src/search/search.controller.ts`
- Create: `apps/api/src/search/search.controller.spec.ts`
- Create: `apps/api/src/search/search.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `workspaceSearchQuerySchema`, `WorkspaceSearchQuery`, `WorkspaceSearchResponse`, `OrdersService.list(tenantId, query)`, `CatalogueService.list(tenantId, query)`.
- Produces: `SearchService.search(tenantId: string, query: WorkspaceSearchQuery): Promise<WorkspaceSearchResponse>` and authenticated `GET /api/search`.

- [ ] **Step 1: Write failing service tests**

```ts
it('searches existing tenant services in parallel and groups bounded results', async () => {
  const orders = { list: vi.fn().mockResolvedValue({ items: [matchingOrder], page: 1, pageSize: 5, total: 1 }) };
  const catalogue = { list: vi.fn().mockResolvedValue({ items: [matchingProduct], page: 1, pageSize: 5, total: 1 }) };
  const result = await new SearchService(orders as never, catalogue as never).search('tenant-a', { q: 'Олена', limit: 5 });
  expect(orders.list).toHaveBeenCalledWith('tenant-a', expect.objectContaining({ search: 'Олена', pageSize: 5 }));
  expect(catalogue.list).toHaveBeenCalledWith('tenant-a', expect.objectContaining({ search: 'Олена', pageSize: 5 }));
  expect(result.customers).toEqual([{ key: 'phone:0970000000', name: 'Олена', context: '0970000000', href: '/orders?search=0970000000' }]);
  expect(result.orders[0]?.href).toBe(`/orders/${matchingOrder.id}`);
  expect(result.products[0]?.href).toBe('/catalogue?search=AUTO-1');
});

it('deduplicates customers by phone and uses username then name as fallbacks', async () => {
  // Return repeated phone entries plus username-only and name-only orders.
  expect((await service.search('tenant-a', { q: 'О', limit: 5 })).customers.map((item) => item.key))
    .toEqual(['phone:0970000000', 'instagram:olena_shop', 'name:марія']);
});
```

- [ ] **Step 2: Verify service RED**

Run: `pnpm --filter @autosale/api exec vitest run src/search/search.service.spec.ts`

Expected: FAIL because `SearchService` does not exist.

- [ ] **Step 3: Implement minimal service mapping**

Call both existing services with `{ search: q, page: 1, pageSize: limit }`, deterministic sorts, and `Promise.all`. Map `ManagerOrder.customer`, first item product summary and catalogue product fields. Use `URLSearchParams` for filtered-list URLs. Deduplicate customers with a `Map`, preserving order, and slice every group to `limit`.

- [ ] **Step 4: Verify service GREEN**

Run: `pnpm --filter @autosale/api exec vitest run src/search/search.service.spec.ts`

Expected: all service cases pass.

- [ ] **Step 5: Write failing controller tests**

```ts
it('validates input and forwards the authenticated tenant', async () => {
  const search = vi.fn().mockResolvedValue({ query: 'Олена', customers: [], orders: [], products: [] });
  const controller = new SearchController({ search } as never);
  await expect(controller.search({ tenantId: 'tenant-a' } as never, { q: ' Олена ', limit: '5' })).resolves.toMatchObject({ query: 'Олена' });
  expect(search).toHaveBeenCalledWith('tenant-a', { q: 'Олена', limit: 5 });
  await expect(controller.search({ tenantId: 'tenant-a' } as never, { q: 'a' })).rejects.toThrow(BadRequestException);
});
```

Also assert the controller carries `@RequireMembership('MANAGER')` using the repository's authorization metadata helper.

- [ ] **Step 6: Verify controller RED**

Run: `pnpm --filter @autosale/api exec vitest run src/search/search.controller.spec.ts`

Expected: FAIL because the controller is absent.

- [ ] **Step 7: Implement controller, module and registration**

`SearchController` parses `@Query()` with `workspaceSearchQuerySchema` and throws `BadRequestException('Invalid workspace search query')` without raw Zod output. `SearchModule.register(env)` creates one Prisma client and supplies `SearchService` with `new OrdersService(prisma, new ProcurementStore(prisma))` and `new CatalogueService(prisma)`. Register the module once in `AppModule.register(env)`.

- [ ] **Step 8: Verify API GREEN**

Run: `pnpm --filter @autosale/api exec vitest run src/search && pnpm --filter @autosale/api build`

Expected: search tests and API build pass.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/search apps/api/src/app.module.ts
git commit -m "feat(api): add tenant workspace search"
```

---

### Task 3: Search client and accessible command dialog

**Files:**
- Create: `apps/web/src/api/workspace-search.ts`
- Create: `apps/web/src/components/workspace-search.tsx`
- Create: `apps/web/src/components/workspace-search.spec.tsx`

**Interfaces:**
- Consumes: `WorkspaceSearchResponse`, `useI18n()`, `useRouter().push`, `authenticatedApiFetch`.
- Produces: `searchWorkspace(query: string, signal?: AbortSignal): Promise<WorkspaceSearchResponse>` and `<WorkspaceSearch />`.

- [ ] **Step 1: Write failing component tests**

```tsx
it('opens from click and Ctrl+K, waits for two characters, then shows grouped results', async () => {
  renderSearch();
  fireEvent.click(screen.getByRole('button', { name: 'Глобальний пошук' }));
  const input = screen.getByRole('combobox', { name: 'Глобальний пошук' });
  fireEvent.change(input, { target: { value: 'О' } });
  expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('/api/search'), expect.anything());
  fireEvent.change(input, { target: { value: 'Ол' } });
  await vi.advanceTimersByTimeAsync(250);
  expect(await screen.findByRole('heading', { name: 'Клієнти' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /Олена/ })).toBeInTheDocument();
});

it('supports ArrowDown, Enter and Escape with focus restoration', async () => {
  renderSearch();
  const trigger = screen.getByRole('button', { name: 'Глобальний пошук' });
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  const input = screen.getByRole('combobox', { name: 'Глобальний пошук' });
  fireEvent.change(input, { target: { value: 'AS' } });
  await vi.advanceTimersByTimeAsync(250);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(push).toHaveBeenCalledWith('/orders/b46c9029-ecdd-4fa5-8c0a-e3146ffe3168');
  fireEvent.click(trigger);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(trigger).toHaveFocus();
});
```

Add separate cases for aborted stale requests, retry after a safe error, no results, and English labels.

- [ ] **Step 2: Verify component RED**

Run: `pnpm --filter @autosale/web exec vitest run src/components/workspace-search.spec.tsx`

Expected: FAIL because the client and component do not exist.

- [ ] **Step 3: Implement the typed API client**

Build `/api/search?q=${encodeURIComponent(query)}&limit=5`, pass `signal`, reject non-OK responses with a safe `WorkspaceSearchApiError`, and parse the JSON with `workspaceSearchResponseSchema`.

- [ ] **Step 4: Implement the command dialog**

Use a real trigger button, `role="dialog"`, labelled input with combobox attributes, grouped `role="listbox"` results and `role="option"` links. Debounce for 250 ms, abort the previous request, ignore stale completions, reset active index on new results, and route with `router.push(href)`. Register and clean up the global shortcut. On close, clear state and restore trigger focus.

- [ ] **Step 5: Verify component GREEN**

Run: `pnpm --filter @autosale/web exec vitest run src/components/workspace-search.spec.tsx`

Expected: all command-dialog behavior passes without act warnings.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api/workspace-search.ts apps/web/src/components/workspace-search.tsx apps/web/src/components/workspace-search.spec.tsx
git commit -m "feat(web): add workspace search dialog"
```

---

### Task 4: Header integration, localization and responsive styling

**Files:**
- Modify: `apps/web/src/components/app-header.tsx`
- Modify: `apps/web/src/components/app-header.spec.tsx`
- Modify: `apps/web/src/i18n/messages/uk.ts`
- Modify: `apps/web/src/i18n/messages/en.ts`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: `<WorkspaceSearch />` from Task 3.
- Produces: active header search in the existing shell on desktop and mobile.

- [ ] **Step 1: Replace the old header expectation with a failing active-search test**

```tsx
it('renders an operable global search instead of an unavailable shell', () => {
  renderHeader(ownerSession);
  const search = screen.getByRole('button', { name: 'Глобальний пошук' });
  expect(search).toHaveTextContent('Пошук клієнта, товару, №');
  expect(search).not.toHaveAttribute('aria-disabled');
});
```

- [ ] **Step 2: Verify integration RED**

Run: `pnpm --filter @autosale/web exec vitest run src/components/app-header.spec.tsx`

Expected: FAIL because the current shell is `aria-disabled` and is not a button.

- [ ] **Step 3: Integrate and localize**

Replace the decorative `app-header-search` block with `<WorkspaceSearch />`. Add Ukrainian and English keys for the dialog label, hint, minimum-query instruction, group headings, loading, empty, error, retry, type labels, stock/price fallbacks and mobile close action. Remove `header.searchUnavailable` only after repository search proves no consumer remains.

- [ ] **Step 4: Add responsive CSS**

Preserve the 44 px header trigger. Anchor a maximum 640 px desktop dialog below the header and use a fixed inset sheet below the app header at `max-width: 720px`. Give every interactive result at least 44 px on mobile, constrain long names with wrapping/ellipsis, keep `z-index` above page content but below the mobile navigation, and provide visible keyboard focus. Reuse `text-button` for retry/close actions.

- [ ] **Step 5: Verify integration GREEN**

Run: `pnpm --filter @autosale/web exec vitest run src/components/app-header.spec.tsx src/components/workspace-search.spec.tsx && pnpm --filter @autosale/web typecheck`

Expected: header/search tests and typecheck pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/app-header.tsx apps/web/src/components/app-header.spec.tsx apps/web/src/i18n/messages/uk.ts apps/web/src/i18n/messages/en.ts apps/web/app/globals.css
git commit -m "feat(web): activate global header search"
```

---

### Task 5: Canonical documentation, full verification and release

**Files:**
- Modify: `docs/features/README.md`
- Modify if the implementation changes the approved contract: `docs/superpowers/specs/2026-10-02-global-workspace-search-design.md`

**Interfaces:**
- Produces: evidence that the documented capability matches the merged and deployed behavior.

- [ ] **Step 1: Update the feature index**

Add `Global workspace search` as `Available`, linking the approved design, API search module, web component and their tests. State the exact initial scope: customers derived from orders, orders and catalogue products; no message/settings/team search.

- [ ] **Step 2: Run repository verification**

Run:

```bash
pnpm --filter @autosale/contracts test
pnpm --filter @autosale/api test
pnpm --filter @autosale/web test
pnpm --filter @autosale/contracts build
pnpm --filter @autosale/api build
pnpm --filter @autosale/web typecheck
pnpm --filter @autosale/web build
git diff --check
```

Expected: zero failing tests, type errors, build errors or whitespace errors.

- [ ] **Step 3: Browser acceptance on the deployed local stack**

Rebuild with `docker compose up -d --build api web`. Verify on `https://sales-aito.com`:

- click and `Ctrl+K` opening;
- a real order-number result opens the matching order;
- a real SKU opens filtered catalogue;
- a customer result opens filtered orders;
- `ArrowDown`, `Enter`, `Escape` and focus restoration;
- loading, no-results and safe error behavior;
- Ukrainian and English labels;
- 390×844 and desktop layouts with zero horizontal overflow;
- no new application console errors.

- [ ] **Step 4: Commit documentation**

```bash
git add docs/features/README.md docs/superpowers/specs/2026-10-02-global-workspace-search-design.md
git commit -m "docs: publish workspace search capability"
```

- [ ] **Step 5: Integrate and clean up**

Fetch `origin/master`, fast-forward or reconcile without force-pushing, merge the verified `codex/global-workspace-search` branch into `master`, rerun the affected test suites on the merged result, push `master`, delete the merged feature branch and confirm that only the pre-existing untracked `artifacts/` remains.
