# Product Catalogue Import and Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tenant-scoped product catalogue that owners can manage and populate from CSV, Excel, or Google Sheets through a reviewed AI-assisted mapping workflow, while managers receive read-only access and order recognition uses only imported catalogue candidates.

**Architecture:** PostgreSQL stores products, sources, versioned mappings, and import runs. NestJS exposes strict owner/manager APIs, BullMQ workers parse and import sources, OpenAI proposes schema-constrained mappings, and Next.js provides the catalogue and import wizard. Catalogue ingestion and the existing Google Sheets order export remain independent integrations.

**Tech Stack:** TypeScript, NestJS 11, Next.js 16, React 19, Prisma/PostgreSQL, BullMQ/Redis, MinIO/S3, OpenAI Responses API, Google Sheets API, ExcelJS, csv-parse, Zod, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-31-product-catalog-import-design.md`

## Global Constraints

- Every product, source, mapping, and import query is scoped by the authenticated membership's `tenantId`.
- Only `OWNER` may mutate catalogue data or integration settings; `MANAGER` has read-only catalogue access; platform administrators receive aggregates without product content.
- OpenAI proposes column mappings only and never invents product values.
- No catalogue mutation occurs before owner confirmation of the mapping and preview.
- Re-imports upsert by `(tenantId, sku)` and never hard-delete products.
- Empty source values preserve existing product values unless clearing is explicitly enabled for that mapped field.
- Catalogue sources and order-export destinations are independent records and may point to different spreadsheets or tabs.
- Secrets, full source rows, product data, and customer data are not emitted to application logs.

---

### Task 1: Catalogue Persistence and Shared Contracts

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260831090000_catalogue_import/migration.sql`
- Create: `packages/contracts/src/catalogue.ts`
- Create: `packages/contracts/src/catalogue.spec.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: existing `Tenant`, `Product`, authenticated tenant membership, and Prisma JSON support.
- Produces: `CatalogueProduct`, `CatalogueSourceSummary`, `CatalogueMappingProposal`, `CataloguePreview`, and `CatalogueImportSummary` Zod schemas; Prisma models `CatalogueSource`, `CatalogueMapping`, and `CatalogueImportRun`.

- [ ] **Step 1: Write failing contract tests**

```ts
import { describe, expect, it } from 'vitest';
import { catalogueMappingProposalSchema, catalogueProductSchema } from './catalogue';

describe('catalogue contracts', () => {
  it('accepts a typed product and rejects an invented mapping target', () => {
    expect(catalogueProductSchema.parse({ sku: 'LUNA-01', name: 'Luna', aliases: [], active: true }).sku).toBe('LUNA-01');
    expect(() => catalogueMappingProposalSchema.parse({ columns: [{ source: 'Назва', target: 'magic', confidence: 0.8 }] })).toThrow();
  });
});
```

- [ ] **Step 2: Run the contracts test and verify failure**

Run: `pnpm --filter @autosale/contracts test -- catalogue.spec.ts`

Expected: FAIL because `./catalogue` does not exist.

- [ ] **Step 3: Add typed contracts and database models**

Define this stable target-field union and export strict schemas:

```ts
export const catalogueTargetFieldSchema = z.enum([
  'sku', 'name', 'description', 'price', 'currency', 'stockQuantity',
  'category', 'brand', 'aliases', 'color', 'size', 'imageUrls', 'active', 'attributes', 'ignore',
]);

export const catalogueMappingProposalSchema = z.object({
  columns: z.array(z.object({
    source: z.string().min(1),
    target: catalogueTargetFieldSchema,
    confidence: z.number().min(0).max(1),
  }).strict()),
}).strict();
```

Extend `Product` with nullable typed fields, JSON `attributes`/`imageUrls`, and optional source provenance. Add enums for source/import status and tenant-related source, mapping, and import-run models. Use indexes on `(tenantId, active, name)`, `(tenantId, status)`, and `(sourceId, createdAt)` and retain `@@unique([tenantId, sku])`.

- [ ] **Step 4: Generate Prisma client and run focused tests**

Run: `pnpm --filter @autosale/database generate && pnpm --filter @autosale/contracts test -- catalogue.spec.ts && pnpm --filter @autosale/database typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the persistence boundary**

```bash
git add packages/database packages/contracts
git commit -m "feat: add catalogue import persistence"
```

---

### Task 2: Tenant-Scoped Catalogue CRUD and Search

**Files:**
- Create: `apps/api/src/catalogue/catalogue.service.ts`
- Create: `apps/api/src/catalogue/catalogue.service.spec.ts`
- Create: `apps/api/src/catalogue/catalogue.controller.ts`
- Create: `apps/api/src/catalogue/catalogue.controller.spec.ts`
- Create: `apps/api/src/catalogue/catalogue.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: authenticated `request.auth.tenantId`, membership guards, Prisma `Product`, and catalogue contracts from Task 1.
- Produces: `GET /api/catalogue`, `POST /api/catalogue`, `PATCH /api/catalogue/:id`; `CatalogueService.list(tenantId, query)`, `create(tenantId, input)`, and `update(tenantId, productId, input)`.

- [ ] **Step 1: Write failing service tests for tenant isolation and SKU uniqueness**

```ts
it('never returns another tenant product', async () => {
  prisma.product.findMany.mockResolvedValue([]);
  await service.list('tenant-a', { search: 'Luna', page: 1, pageSize: 25 });
  expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ tenantId: 'tenant-a' }),
  }));
});
```

- [ ] **Step 2: Run the service test and verify failure**

Run: `pnpm --filter @autosale/api test -- src/catalogue/catalogue.service.spec.ts`

Expected: FAIL because the catalogue service does not exist.

- [ ] **Step 3: Implement search, pagination, create, and patch**

Normalize SKU with `trim().toUpperCase()`, validate aliases as unique non-empty strings, use explicit Prisma selects, and map Prisma uniqueness errors to `409 Conflict`. Every `findFirst`, `updateMany`, and list query includes `tenantId`; never use `findUnique({ id })` as an authorization check.

```ts
async update(tenantId: string, id: string, input: CatalogueProductUpdate) {
  const result = await this.prisma.product.updateMany({
    where: { id, tenantId },
    data: mapProductUpdate(input),
  });
  if (result.count !== 1) throw new NotFoundException('Catalogue product not found');
  return this.findOne(tenantId, id);
}
```

- [ ] **Step 4: Write controller tests for role boundaries**

Assert `OWNER` can create and patch, `MANAGER` can list, an unauthenticated request receives `401`, and a manager mutation receives `403`.

- [ ] **Step 5: Register the module and run API tests**

Run: `pnpm --filter @autosale/api test -- src/catalogue && pnpm --filter @autosale/api typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the catalogue API**

```bash
git add apps/api/src/catalogue apps/api/src/app.module.ts
git commit -m "feat: add tenant catalogue api"
```

---

### Task 3: Catalogue Screen and Manual Product Management

**Files:**
- Create: `apps/web/app/catalogue/page.tsx`
- Create: `apps/web/app/catalogue/page.spec.tsx`
- Create: `apps/web/src/components/catalogue-table.tsx`
- Create: `apps/web/src/components/catalogue-table.spec.tsx`
- Create: `apps/web/src/components/product-editor.tsx`
- Create: `apps/web/src/components/product-editor.spec.tsx`
- Modify: `apps/web/src/components/primary-navigation.tsx`
- Modify: `apps/web/src/components/primary-navigation.spec.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: Task 2 catalogue endpoints and the existing authenticated server-fetch/mutating-fetch patterns.
- Produces: `/catalogue` route; searchable/paginated catalogue; owner-only create/edit controls; manager read-only view.

- [ ] **Step 1: Write failing component tests**

```tsx
render(<CatalogueTable session={{ membershipRole: 'MANAGER' }} products={[product]} />);
expect(screen.getByText('LUNA-01')).toBeInTheDocument();
expect(screen.queryByRole('button', { name: 'Редагувати' })).not.toBeInTheDocument();
```

Also assert an owner sees `Додати товар`, edits aliases, and submits through `mutatingFetch`.

- [ ] **Step 2: Run the web tests and verify failure**

Run: `pnpm --filter @autosale/web test -- catalogue-table.spec.tsx product-editor.spec.tsx`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the catalogue page and focused components**

Keep server-side data loading in `page.tsx`, rendering and filters in `catalogue-table.tsx`, and mutation state in `product-editor.tsx`. Add `catalogue` to the `Destination` union and show the navigation entry to both owners and managers.

- [ ] **Step 4: Add accessible loading, empty, validation, and API error states**

Use labelled controls, a real table on wide screens, cards on narrow screens, `aria-live` for mutation outcomes, and Ukrainian messages that preserve no raw backend error detail.

- [ ] **Step 5: Run web tests and typecheck**

Run: `pnpm --filter @autosale/web test && pnpm --filter @autosale/web typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the catalogue UI**

```bash
git add apps/web/app/catalogue apps/web/src/components apps/web/app/globals.css
git commit -m "feat: add catalogue management ui"
```

---

### Task 4: CSV/XLSX Parsing, Preview, and Confirmed Import

**Files:**
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/api/src/catalogue-import/source-parser.ts`
- Create: `apps/api/src/catalogue-import/source-parser.spec.ts`
- Create: `apps/api/src/catalogue-import/catalogue-import.service.ts`
- Create: `apps/api/src/catalogue-import/catalogue-import.service.spec.ts`
- Create: `apps/api/src/catalogue-import/catalogue-import.controller.ts`
- Create: `apps/api/src/catalogue-import/catalogue-import.controller.spec.ts`
- Create: `apps/api/src/catalogue-import/catalogue-import.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `tests/fixtures/catalogue/products.csv`
- Create: `tests/fixtures/catalogue/products.xlsx`

**Interfaces:**
- Consumes: Task 1 import models and Task 2 product fields; multipart uploads up to a configured byte limit.
- Produces: `parseCatalogueSource(buffer, mediaType): ParsedTable`; `POST /api/catalogue/imports/upload`; `PATCH /api/catalogue/imports/:id/mapping`; `GET /api/catalogue/imports/:id/preview`; `POST /api/catalogue/imports/:id/confirm`.

- [ ] **Step 1: Add parser dependencies and failing fixture tests**

Install pinned `exceljs` and `csv-parse`. Test both fixtures produce the same normalized representation:

```ts
type ParsedTable = {
  headers: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
  fingerprint: string;
};
```

Run: `pnpm --filter @autosale/api test -- src/catalogue-import/source-parser.spec.ts`

Expected: FAIL because the parser does not exist.

- [ ] **Step 2: Implement bounded deterministic parsing**

Reject empty headers, duplicate normalized headers, encrypted workbooks, unsupported extensions, excessive rows/columns, formula-only values, and CSV cells that exceed the configured limit. Create the fingerprint from ordered normalized headers with SHA-256.

- [ ] **Step 3: Write failing preview and idempotent upsert tests**

Cover missing SKU/name, duplicate SKU row numbers, numeric locale parsing, alias splitting, empty-value preservation, partial-import counts, and a repeated confirmation returning the existing completed run.

- [ ] **Step 4: Implement preview and transaction-batched confirmation**

```ts
type CataloguePreview = {
  rows: Array<{ rowNumber: number; product?: CatalogueProductInput; errors: string[] }>;
  totals: { created: number; updated: number; skipped: number; failed: number };
};
```

Confirmation locks the run with a conditional status update, processes valid rows in bounded transactions, upserts on `tenantId_sku`, and records a privacy-safe report. It never deactivates missing products.

- [ ] **Step 5: Add owner-only multipart endpoints and module registration**

Validate MIME type and extension, generate server-owned object keys, never accept a client path, and enforce CSRF/auth guards through existing controller patterns.

- [ ] **Step 6: Run API tests, database integration tests, and typecheck**

Run: `pnpm --filter @autosale/api test -- src/catalogue-import && pnpm --filter @autosale/api typecheck`

Expected: PASS.

- [ ] **Step 7: Commit file import**

```bash
git add apps/api packages/database tests/fixtures pnpm-lock.yaml
git commit -m "feat: import catalogue files safely"
```

---

### Task 5: Strict OpenAI Mapping Suggestions and Wizard UI

**Files:**
- Create: `apps/worker/src/catalogue/openai-column-mapper.ts`
- Create: `apps/worker/src/catalogue/openai-column-mapper.spec.ts`
- Create: `apps/worker/src/catalogue/catalogue-mapping.processor.ts`
- Create: `apps/worker/src/catalogue/catalogue-mapping.processor.spec.ts`
- Modify: `apps/worker/src/main.ts`
- Create: `apps/web/src/components/catalogue-import-wizard.tsx`
- Create: `apps/web/src/components/catalogue-import-wizard.spec.tsx`
- Modify: `apps/web/app/catalogue/page.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: uploaded import run headers, inferred primitive types, at most five bounded sample rows, Task 1 strict mapping schema, existing OpenAI configuration.
- Produces: `ColumnMapper.suggest(input): Promise<CatalogueMappingProposal>`; BullMQ job `catalogue.mapping`; seven-step import wizard with manual fallback.

- [ ] **Step 1: Write failing mapper tests with a fake OpenAI client**

Assert Ukrainian `Артикул` maps to `sku`, `Назва позиції` maps to `name`, unknown columns map to `ignore`, and invalid or invented targets are rejected by Zod.

- [ ] **Step 2: Implement strict Responses API mapping**

Use JSON schema output derived from `catalogueMappingProposalSchema`. The prompt states that the model classifies columns only, cannot transform row values, and must use `ignore` when evidence is insufficient. Persist model, prompt version, schema version, latency, token counts, and confidence; do not log samples.

- [ ] **Step 3: Implement mapping processor and failure fallback**

On success, persist a draft mapping. On provider or validation failure, set the run to `MAPPING_REVIEW` with an empty manual mapping instead of failing the entire import.

- [ ] **Step 4: Write failing wizard tests**

Test source selection, upload, proposed mappings with confidence, owner correction, required-field blocking, preview totals, confirmation, progress, and manual mapping after AI failure.

- [ ] **Step 5: Implement the wizard**

Render seven explicit steps, retain server-owned import IDs only, and never place source rows in URL or browser storage. Require an owner confirmation checkbox before `POST /confirm`.

- [ ] **Step 6: Run worker/web tests and typechecks**

Run: `pnpm --filter @autosale/worker test -- src/catalogue && pnpm --filter @autosale/web test -- catalogue-import-wizard.spec.tsx && pnpm --filter @autosale/worker typecheck && pnpm --filter @autosale/web typecheck`

Expected: PASS.

- [ ] **Step 7: Commit AI mapping and wizard**

```bash
git add apps/worker/src/catalogue apps/worker/src/main.ts apps/web
git commit -m "feat: add reviewed ai catalogue mapping"
```

---

### Task 6: Google Sheets Catalogue Sources and Safe Synchronization

**Files:**
- Modify: `packages/integrations/src/google-sheets.ts`
- Modify: `packages/integrations/src/google-sheets.spec.ts`
- Create: `apps/api/src/catalogue-sources/catalogue-sources.service.ts`
- Create: `apps/api/src/catalogue-sources/catalogue-sources.service.spec.ts`
- Create: `apps/api/src/catalogue-sources/catalogue-sources.controller.ts`
- Create: `apps/api/src/catalogue-sources/catalogue-sources.controller.spec.ts`
- Create: `apps/api/src/catalogue-sources/catalogue-sources.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/worker/src/catalogue/google-catalogue-sync.processor.ts`
- Create: `apps/worker/src/catalogue/google-catalogue-sync.processor.spec.ts`
- Modify: `apps/worker/src/main.ts`
- Create: `apps/web/src/components/catalogue-source-settings.tsx`
- Create: `apps/web/src/components/catalogue-source-settings.spec.tsx`
- Modify: `apps/web/app/catalogue/page.tsx`

**Interfaces:**
- Consumes: existing service-account Google adapter, confirmed mappings, import preview/confirmation service, and independent `GoogleSheetsDestination` order export.
- Produces: `GoogleSheetsAdapter.readTable({ spreadsheetId, sheetName, maxRows })`; source CRUD/check/sync endpoints; manual `Synchronize now`; scheduled source polling.

- [ ] **Step 1: Write failing Google adapter tests**

```ts
expect(await adapter.readTable({ spreadsheetId: 'sheet-1', sheetName: 'Товари', maxRows: 5000 }))
  .toEqual({ headers: ['SKU', 'Назва'], rows: [['LUNA-01', 'Luna']], revision: expect.any(String) });
```

Test quoted tab names, HTTP 403, missing tab, empty sheet, and maximum-row enforcement.

- [ ] **Step 2: Implement bounded Google table reads**

Read values with `majorDimension=ROWS`, return evaluated values, calculate a deterministic revision/checksum, and classify Google failures into authorization, not-found, rate-limit, and retryable network categories without response bodies in errors.

- [ ] **Step 3: Write source service/controller tests**

Assert the owner can create a source from a full Google URL or spreadsheet ID, choose a tab, test connectivity, and request sync. Assert managers cannot see configuration details or mutate sources. Assert a catalogue source does not change `GoogleSheetsDestination`.

- [ ] **Step 4: Implement source endpoints and URL parsing**

Persist spreadsheet ID and tab separately, show the configured service-account email/action from safe configuration, and never accept uploaded credential JSON through this endpoint.

- [ ] **Step 5: Write and implement synchronization processor tests**

Cover unchanged fingerprint using the confirmed mapping, changed fingerprint pausing as `MAPPING_REVIEW`, missing required columns, repeated revision no-op, retryable API failure, and SKU collision. Reuse Task 4 preview/import logic instead of duplicating upsert code.

- [ ] **Step 6: Add manual sync UI and schedule controls**

Allow `OWNER` to test access, select a tab, save, run now, and choose `MANUAL`, `HOURLY`, or `DAILY`. Show managers only source health and last-sync time.

- [ ] **Step 7: Run integration, API, worker, and web tests**

Run: `pnpm --filter @autosale/integrations test && pnpm --filter @autosale/api test -- src/catalogue-sources && pnpm --filter @autosale/worker test -- google-catalogue-sync.processor.spec.ts && pnpm --filter @autosale/web test -- catalogue-source-settings.spec.tsx`

Expected: PASS.

- [ ] **Step 8: Commit Google catalogue synchronization**

```bash
git add packages/integrations apps/api apps/worker apps/web
git commit -m "feat: sync catalogue from google sheets"
```

---

### Task 7: Recognition Integration, Admin Aggregates, and End-to-End Acceptance

**Files:**
- Modify: `apps/worker/src/orders/order-recognition.service.ts`
- Modify: `apps/worker/src/orders/order-recognition.service.spec.ts`
- Modify: `apps/worker/src/orders/triggered-order.processor.ts`
- Modify: `apps/worker/src/orders/triggered-order.processor.spec.ts`
- Modify: `apps/api/src/admin/admin.service.ts`
- Modify: `apps/api/src/admin/admin.service.spec.ts`
- Create: `tests/e2e/catalogue-import.spec.ts`
- Create: `tests/fixtures/catalogue/alternative-columns.csv`
- Modify: `docs/acceptance/mvp-checklist.md`
- Modify: `docs/integrations/google-sheets-access.md`

**Interfaces:**
- Consumes: active tenant products imported by Tasks 4–6 and the existing order-recognition request.
- Produces: deterministic candidate retrieval limited to active tenant SKUs; privacy-safe admin catalogue counts; acceptance evidence for file and Google imports.

- [ ] **Step 1: Write failing recognition tests**

Create two tenants with overlapping words and assert the recognition request for tenant A contains only tenant A active candidates. Assert an unknown model SKU is rejected and routed to review.

- [ ] **Step 2: Implement bounded candidate retrieval**

Normalize the chat product phrase, score exact SKU, exact alias, normalized name, and token overlap deterministically, cap candidates at 25, and pass only those candidates to OpenAI. Persist the matching algorithm version and evidence already supported by the extraction record.

- [ ] **Step 3: Add privacy-safe platform-admin aggregates**

Expose product count, source status, last run result, duration, and failure category only. Tests must assert names, SKU, price, source URL, mapping, and row errors are absent.

- [ ] **Step 4: Add end-to-end file-import acceptance**

The test registers an owner, uploads `alternative-columns.csv`, accepts the proposed/manual mapping, confirms the preview, verifies products appear once, repeats the import with a changed name, and verifies one updated product.

- [ ] **Step 5: Add Google synchronization acceptance with a fake adapter**

Verify catalogue import and order export can use different spreadsheet IDs and can also use different tabs in one spreadsheet. Change headers and assert synchronization pauses without modifying products.

- [ ] **Step 6: Update operator and acceptance documentation**

Document service-account sharing, catalogue versus order tabs, manual fallback, schedule behavior, safe retry, and the exact acceptance commands.

- [ ] **Step 7: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm test:e2e
docker compose config --quiet
docker compose build api worker web
git diff --check
```

Expected: all commands succeed; a secret-pattern scan finds no API key, credential JSON, tunnel token, or source fixture containing personal data.

- [ ] **Step 8: Deploy locally and perform browser smoke testing**

Run: `docker compose -p autosale-oauth-verify up -d --build api worker web proxy cloudflared`

Verify owner catalogue CRUD, CSV preview/confirm, manager read-only catalogue, Google source health, and unchanged existing conversations/orders/settings flows through `https://sales-aito.com`.

- [ ] **Step 9: Commit acceptance and documentation**

```bash
git add apps tests docs
git commit -m "test: verify catalogue import workflow"
git push origin codex/ai-order-recognition
```
