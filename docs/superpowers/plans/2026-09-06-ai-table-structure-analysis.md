# AI Table Structure Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed-position catalogue parsing with a hybrid AI structure analyser that finds headers, semantic columns, product rows, and ambiguous rows before a safe deterministic import.

**Architecture:** Source readers preserve a bounded raw matrix with original coordinates. OpenAI returns a strict structure proposal; local code validates it, deterministically classifies clear rows, asks AI only about ambiguous rows, and stores a versioned structure plan beside the existing mapping. High-confidence results auto-import, while uncertainty uses the existing review flow.

**Tech Stack:** TypeScript, Zod, OpenAI Responses API, NestJS 11, BullMQ, Prisma/PostgreSQL, Google Sheets API, ExcelJS, csv-parse, Next.js 16, React 19, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-06-ai-table-structure-analysis-design.md`

## Global Constraints

- AI never rewrites, completes, or invents product cell values.
- OpenAI calls use `store: false`; raw cells, prompts containing cells, and row decisions are never logged.
- Sources remain bounded to 5,000 rows, 500 columns, and 65,536 characters per cell in this flow.
- Initial AI profiling sends at most 120 leading non-empty rows and 40 distributed rows; cell samples are capped at 200 characters.
- Ambiguous rows are sent in batches of at most 100, with a hard cap of 1,000 ambiguous rows.
- Automatic import requires structure, name-column, and ambiguous-row confidence of at least 0.90.
- Every database, object-storage, API, and queue operation remains scoped by `tenantId`.
- Existing order-export Google Sheets behavior must not change.
- Existing confirmed mappings without a version-2 structure plan remain readable during rollback.

---

### Task 1: Strict structure-analysis contracts

**Files:**
- Modify: `packages/contracts/src/catalogue.ts`
- Modify: `packages/contracts/src/catalogue.spec.ts`

**Interfaces:**
- Consumes: existing `catalogueTargetFieldSchema`.
- Produces: `rawCatalogueMatrixSchema`, `tableStructureProposalSchema`, `catalogueStructurePlanSchema`, `ambiguousRowClassificationSchema` and their inferred TypeScript types.

- [ ] **Step 1: Write failing contract tests**

```ts
it('accepts indexed multi-row structure proposals and rejects invented coordinates', () => {
  const proposal = tableStructureProposalSchema.parse({
    headerStartRow: 21,
    headerEndRow: 22,
    dataStartRow: 23,
    structureConfidence: 0.97,
    columns: [
      { index: 5, label: 'Асортимент', target: 'name', confidence: 0.99 },
      { index: 7, label: 'Ціна (грн) / Роздріб', target: 'price', confidence: 0.98 },
    ],
  });
  expect(proposal.columns[0]?.index).toBe(5);
  expect(() => tableStructureProposalSchema.parse({ ...proposal, headerEndRow: 25 })).toThrow();
});

it('accepts only row decisions that preserve a positive source row number', () => {
  expect(ambiguousRowClassificationSchema.parse({ rowNumber: 24, kind: 'PRODUCT', confidence: 0.96 }).kind).toBe('PRODUCT');
  expect(() => ambiguousRowClassificationSchema.parse({ rowNumber: 0, kind: 'PRODUCT', confidence: 0.96 })).toThrow();
});
```

- [ ] **Step 2: Run the contract tests and verify RED**

Run: `pnpm --filter @autosale/contracts test -- src/catalogue.spec.ts`

Expected: FAIL because the new schemas are not exported.

- [ ] **Step 3: Implement the strict schemas**

```ts
export const rawCatalogueCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const rawCatalogueMatrixSchema = z.object({
  rows: z.array(z.object({ rowNumber: z.number().int().positive(), cells: z.array(rawCatalogueCellSchema).max(500) }).strict()).max(5_000),
  revision: z.string().min(1),
}).strict();

export const tableStructureProposalSchema = z.object({
  headerStartRow: z.number().int().positive(),
  headerEndRow: z.number().int().positive(),
  dataStartRow: z.number().int().positive(),
  structureConfidence: z.number().min(0).max(1),
  columns: z.array(z.object({
    index: z.number().int().min(0).max(499),
    label: z.string().min(1).max(300),
    target: catalogueTargetFieldSchema,
    confidence: z.number().min(0).max(1),
  }).strict()).min(1).max(500),
}).strict().superRefine((value, context) => {
  if (value.headerEndRow < value.headerStartRow || value.headerEndRow - value.headerStartRow > 2) context.addIssue({ code: 'custom', message: 'Header span must contain one to three rows' });
  if (value.dataStartRow <= value.headerEndRow) context.addIssue({ code: 'custom', message: 'Data must start after headers' });
});

export const ambiguousRowClassificationSchema = z.object({
  rowNumber: z.number().int().positive(),
  kind: z.enum(['PRODUCT', 'SKIP']),
  confidence: z.number().min(0).max(1),
}).strict();
```

Define the plan as a flat extension so later consumers use the same coordinate names:

```ts
export const catalogueStructurePlanSchema = tableStructureProposalSchema.extend({
  version: z.literal(2),
  productRowNumbers: z.array(z.number().int().positive()).max(5_000),
  skippedRowNumbers: z.array(z.number().int().positive()).max(5_000),
  sourceRowNumbers: z.array(z.number().int().positive()).max(5_000),
  sourceRevision: z.string().min(1),
}).strict();
```

- [ ] **Step 4: Run contract tests and typecheck**

Run: `pnpm --filter @autosale/contracts test && pnpm --filter @autosale/contracts typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the contracts**

```bash
git add packages/contracts/src/catalogue.ts packages/contracts/src/catalogue.spec.ts
git commit -m "feat: define catalogue structure contracts"
```

---

### Task 2: Coordinate-preserving raw source readers

**Files:**
- Create: `packages/integrations/src/catalogue-matrix.ts`
- Create: `packages/integrations/src/catalogue-matrix.spec.ts`
- Modify: `packages/integrations/src/google-sheets.ts`
- Modify: `packages/integrations/src/google-sheets.spec.ts`
- Modify: `packages/integrations/src/index.ts`
- Modify: `apps/api/src/catalogue-import/source-parser.ts`
- Modify: `apps/api/src/catalogue-import/source-parser.spec.ts`

**Interfaces:**
- Consumes: `RawCatalogueMatrix` from Task 1.
- Produces: `matrixFromRows(rows, revision)`, `GoogleSheetsAdapter.readMatrix(input)`, and `parseCatalogueMatrix(buffer, mediaType, revision)`.

- [ ] **Step 1: Write failing tests for sparse and late-header inputs**

```ts
it('preserves original row and column coordinates without requiring row one headers', () => {
  const matrix = matrixFromRows([
    [],
    [null, null, 'Постачальник'],
    [],
    [null, null, 'Назва', null, 'Ціна'],
    [null, null, 'Сукня', null, 1200],
  ], 'revision-1');
  expect(matrix.rows[3]).toEqual({ rowNumber: 4, cells: [null, null, 'Назва', null, 'Ціна'] });
});
```

Add equivalent CSV and XLSX tests with title rows and a Google adapter test asserting that `readMatrix` retains rows 1–N and does not choose a header.

- [ ] **Step 2: Run reader tests and verify RED**

Run: `pnpm --filter @autosale/integrations test -- src/catalogue-matrix.spec.ts src/google-sheets.spec.ts && pnpm --filter @autosale/api test -- src/catalogue-import/source-parser.spec.ts`

Expected: FAIL because raw matrix APIs do not exist.

- [ ] **Step 3: Implement shared matrix normalization**

```ts
export function matrixFromRows(rows: unknown[][], revision: string): RawCatalogueMatrix {
  if (rows.length > 5_000 && rows.slice(5_000).some((row) => row.some(hasCatalogueValue))) {
    throw new RangeError('Catalogue matrix exceeds 5000 populated rows');
  }
  return rawCatalogueMatrixSchema.parse({
    revision,
    rows: rows.slice(0, 5_000).map((row, index) => ({
      rowNumber: index + 1,
      cells: row.slice(0, 500).map(normalizeCatalogueCell),
    })),
  });
}
```

`readMatrix` must use the same bounded Google values endpoint as `readTable` but return the raw matrix. Keep `readTable` as a compatibility wrapper so order export and rollback behavior remain unchanged.

- [ ] **Step 4: Add raw parsing without weakening archive protections**

```ts
export async function parseCatalogueMatrix(buffer: Buffer, mediaType: string, revision: string): Promise<RawCatalogueMatrix> {
  validateMediaTypeAndWorkbookArchive(buffer, mediaType);
  const rows = isCsv(mediaType) ? readCsv(buffer) : await readWorkbook(buffer);
  validateCellBounds(rows);
  return matrixFromRows(rows, revision);
}
```

Keep `parseCatalogueSource` temporarily as a legacy wrapper used when the feature flag is disabled.

- [ ] **Step 5: Run all integration and parser tests**

Run: `pnpm --filter @autosale/integrations test && pnpm --filter @autosale/api test -- src/catalogue-import/source-parser.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit raw readers**

```bash
git add packages/integrations apps/api/src/catalogue-import/source-parser.ts apps/api/src/catalogue-import/source-parser.spec.ts
git commit -m "feat: preserve raw catalogue coordinates"
```

---

### Task 3: Bounded structural profiler and OpenAI analyser

**Files:**
- Create: `apps/worker/src/catalogue/catalogue-table-profiler.ts`
- Create: `apps/worker/src/catalogue/catalogue-table-profiler.spec.ts`
- Create: `apps/worker/src/catalogue/openai-table-structure-analyzer.ts`
- Create: `apps/worker/src/catalogue/openai-table-structure-analyzer.spec.ts`

**Interfaces:**
- Consumes: `RawCatalogueMatrix`.
- Produces: `buildCatalogueStructureProfile(matrix): CatalogueStructureProfile`; `TableStructureAnalyzer.analyze(profile): Promise<TableStructureSuggestion>`.

- [ ] **Step 1: Write a failing profiler test**

```ts
it('keeps leading and distributed evidence within privacy bounds', () => {
  const matrix = makeMatrix(5_000);
  const profile = buildCatalogueStructureProfile(matrix);
  expect(profile.rows.length).toBeLessThanOrEqual(160);
  expect(profile.rows[0]?.cells.every((cell) => String(cell.value ?? '').length <= 200)).toBe(true);
  expect(profile.totalRows).toBe(5_000);
});
```

- [ ] **Step 2: Run the profiler test and verify RED**

Run: `pnpm --filter @autosale/worker test -- src/catalogue/catalogue-table-profiler.spec.ts`

Expected: FAIL because the profiler does not exist.

- [ ] **Step 3: Implement the deterministic profiler**

```ts
export function buildCatalogueStructureProfile(matrix: RawCatalogueMatrix): CatalogueStructureProfile {
  const nonEmpty = matrix.rows.filter(hasAnyValue);
  const leading = nonEmpty.slice(0, 120);
  const distributed = evenlySample(nonEmpty.slice(120), 40);
  return {
    totalRows: matrix.rows.length,
    maxColumns: Math.max(0, ...matrix.rows.map((row) => row.cells.length)),
    rows: uniqueByRowNumber([...leading, ...distributed]).map(toBoundedProfileRow),
    columnTypes: inferColumnTypes(matrix.rows),
  };
}
```

- [ ] **Step 4: Write failing strict-response tests for the analyser**

```ts
it('returns a validated indexed structure and sends store false', async () => {
  client.responses.create.mockResolvedValue(validMetrDoorResponse());
  const result = await analyzer.analyze(metrDoorProfile());
  expect(result.proposal.headerStartRow).toBe(21);
  expect(result.proposal.columns.map((column) => column.index)).toEqual([5, 7]);
  expect(client.responses.create).toHaveBeenCalledWith(expect.objectContaining({ store: false }));
});

it('rejects coordinates absent from the supplied profile', async () => {
  client.responses.create.mockResolvedValue(responseWithHeaderRow(9_999));
  await expect(analyzer.analyze(metrDoorProfile())).rejects.toBeInstanceOf(TableStructureResponseError);
});
```

- [ ] **Step 5: Run analyser tests and verify RED**

Run: `pnpm --filter @autosale/worker test -- src/catalogue/openai-table-structure-analyzer.spec.ts`

Expected: FAIL because the analyser does not exist.

- [ ] **Step 6: Implement the OpenAI analyser**

Use one Responses API request with strict JSON schema derived from `tableStructureProposalSchema`. Instructions must state:

```ts
const instructions = `Identify catalogue structure only. Return original one-based row numbers and zero-based column indexes. Combine at most three adjacent header rows. Map semantic columns without changing cell values. Treat titles, contacts, currency notes, category labels, and repeated headers as non-product structure. Use low confidence when evidence is insufficient.`;
```

Validate that proposed rows and columns exist, targets are unique except `ignore`, and the response contains exactly the schema fields.

- [ ] **Step 7: Run worker tests and commit**

Run: `pnpm --filter @autosale/worker test -- src/catalogue/catalogue-table-profiler.spec.ts src/catalogue/openai-table-structure-analyzer.spec.ts`

Expected: PASS.

```bash
git add apps/worker/src/catalogue/catalogue-table-profiler.ts apps/worker/src/catalogue/catalogue-table-profiler.spec.ts apps/worker/src/catalogue/openai-table-structure-analyzer.ts apps/worker/src/catalogue/openai-table-structure-analyzer.spec.ts
git commit -m "feat: analyse catalogue table structure with AI"
```

---

### Task 4: Deterministic row normalization and selective AI classification

**Files:**
- Create: `apps/worker/src/catalogue/catalogue-row-classifier.ts`
- Create: `apps/worker/src/catalogue/catalogue-row-classifier.spec.ts`
- Create: `apps/worker/src/catalogue/openai-ambiguous-row-classifier.ts`
- Create: `apps/worker/src/catalogue/openai-ambiguous-row-classifier.spec.ts`
- Modify: `packages/database/src/catalogue-import-engine.ts`
- Modify: `packages/database/src/catalogue-import-engine.spec.ts`

**Interfaces:**
- Consumes: raw matrix and validated structure proposal.
- Produces: `normalizeCatalogueRows(input): CatalogueRowClassification`; `AmbiguousRowClassifier.classify(rows): Promise<AmbiguousRowDecision[]>`; optional `sourceRowNumbers` for `importCatalogueTable`.

- [ ] **Step 1: Write failing classification tests using the MetrDoor shape**

```ts
it('imports priced products and skips category and secondary header rows', () => {
  const result = normalizeCatalogueRows({ matrix: metrDoorMatrix(), proposal: metrDoorProposal() });
  expect(result.headers).toEqual(['Асортимент', 'Ціна (грн) / Роздріб']);
  expect(result.products).toContainEqual({ sourceRowNumber: 24, cells: ['860х2050 Регіон', 2420] });
  expect(result.skippedRowNumbers).toEqual(expect.arrayContaining([22, 23, 28]));
});

it('keeps uncertain product-shaped rows for AI instead of dropping them', () => {
  const result = normalizeCatalogueRows({ matrix: oneColumnMixedMatrix(), proposal: oneColumnProposal() });
  expect(result.ambiguous.map((row) => row.sourceRowNumber)).toContain(8);
});
```

- [ ] **Step 2: Run classifier tests and verify RED**

Run: `pnpm --filter @autosale/worker test -- src/catalogue/catalogue-row-classifier.spec.ts`

Expected: FAIL because normalization is not implemented.

- [ ] **Step 3: Implement deterministic classification**

```ts
export function normalizeCatalogueRows(input: NormalizeCatalogueRowsInput): CatalogueRowClassification {
  validateProposalAgainstMatrix(input.matrix, input.proposal);
  const projected = projectMappedColumns(input.matrix, input.proposal);
  return classifyProjectedRows(projected, {
    product: rowHasNameAndProductEvidence,
    empty: rowHasNoMappedValues,
    metadata: rowPrecedesDataOrMatchesRepeatedHeader,
    category: rowHasOnlyNameLikeSectionValue,
  });
}
```

One-column catalogues with repeated product-shaped rows must become `AMBIGUOUS`, not `CATEGORY`, unless a confirmed version-2 plan already classifies the pattern.

- [ ] **Step 4: Write failing AI ambiguous-row tests**

```ts
it('classifies only supplied row numbers in batches of at most 100', async () => {
  const decisions = await classifier.classify(makeAmbiguousRows(205));
  expect(client.responses.create).toHaveBeenCalledTimes(3);
  expect(decisions).toHaveLength(205);
});

it('rejects partial and invented row decisions', async () => {
  client.responses.create.mockResolvedValue(responseForRows([{ rowNumber: 999, kind: 'PRODUCT', confidence: 1 }]));
  await expect(classifier.classify(makeAmbiguousRows(1))).rejects.toBeInstanceOf(AmbiguousRowResponseError);
});
```

- [ ] **Step 5: Implement selective OpenAI row classification**

Send only mapped cells and original row numbers. Require one decision for every supplied row and reject more than 1,000 ambiguous rows before calling OpenAI.

```ts
const instructions = `Classify each supplied row as PRODUCT or SKIP. Never return or modify cell values. Category labels, repeated headers, contacts, notes, and totals are SKIP. Return exactly one decision for every original rowNumber.`;
```

- [ ] **Step 6: Preserve original row numbers in import errors**

Extend `importCatalogueTable` input with `sourceRowNumbers?: number[]` and replace generated `index + 2` error numbers with `sourceRowNumbers?.[index] ?? index + 2`. Add a database test asserting a failed normalized row reports source row 24.

- [ ] **Step 7: Run worker and database tests, then commit**

Run: `pnpm --filter @autosale/worker test -- src/catalogue/catalogue-row-classifier.spec.ts src/catalogue/openai-ambiguous-row-classifier.spec.ts && pnpm --filter @autosale/database test -- src/catalogue-import-engine.spec.ts`

Expected: PASS.

```bash
git add apps/worker/src/catalogue packages/database/src/catalogue-import-engine.ts packages/database/src/catalogue-import-engine.spec.ts
git commit -m "feat: classify catalogue product rows safely"
```

---

### Task 5: Orchestrate version-2 analysis for uploaded files

**Files:**
- Modify: `apps/api/src/catalogue-import/catalogue-import.service.ts`
- Modify: `apps/api/src/catalogue-import/catalogue-import.service.spec.ts`
- Modify: `apps/worker/src/catalogue/catalogue-mapping.processor.ts`
- Modify: `apps/worker/src/catalogue/catalogue-mapping.processor.spec.ts`
- Modify: `apps/worker/src/catalogue/catalogue-auto-importer.ts`
- Modify: `apps/worker/src/catalogue/catalogue-auto-importer.spec.ts`
- Modify: `apps/worker/src/main.ts`

**Interfaces:**
- Consumes: Tasks 1–4 analysers and normalized rows.
- Produces: version-2 `CatalogueMapping` records and automatic/review decisions for CSV/XLSX uploads.

- [ ] **Step 1: Write failing processor tests**

```ts
it('analyses raw upload structure before mapping and persists a version-2 plan', async () => {
  structureAnalyzer.analyze.mockResolvedValue(metrDoorSuggestion());
  const result = await processor.process({ tenantId, runId });
  expect(result.status).toBe('COMPLETED');
  expect(prisma.catalogueMapping.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    transformSettings: expect.objectContaining({ structurePlan: expect.objectContaining({ version: 2, headerStartRow: 21 }) }),
  }) }));
});

it('routes low-confidence structure to review without importing', async () => {
  structureAnalyzer.analyze.mockResolvedValue(lowConfidenceSuggestion());
  await expect(processor.process({ tenantId, runId })).resolves.toMatchObject({ status: 'MAPPING_REVIEW' });
  expect(autoImporter.process).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run processor tests and verify RED**

Run: `pnpm --filter @autosale/worker test -- src/catalogue/catalogue-mapping.processor.spec.ts`

Expected: FAIL because the processor still assumes row one headers.

- [ ] **Step 3: Persist raw upload metadata in the API**

When AI structure analysis is enabled, `upload` validates archive/media/bounds with `parseCatalogueMatrix`, stores the original object, sets a raw-matrix revision fingerprint, creates an `UPLOADED` run without claiming a final header mapping, and queues `catalogue.mapping` as before.

```ts
const matrix = await parseCatalogueMatrix(file.buffer, file.mediaType, sourceRevision);
const provisionalFingerprint = createHash('sha256').update(JSON.stringify(matrix.rows.map(rowShape))).digest('hex');
```

- [ ] **Step 4: Replace column-only orchestration with hybrid orchestration**

```ts
const profile = buildCatalogueStructureProfile(matrix);
const structure = await this.structureAnalyzer.analyze(profile);
const localRows = normalizeCatalogueRows({ matrix, proposal: structure.proposal });
const aiRows = await this.ambiguousRows.classify(localRows.ambiguous);
const normalized = applyAmbiguousDecisions(localRows, aiRows);
const decision = decideHybridCatalogueImport({ structure, normalized });
```

Persist existing semantic `columns` plus `transformSettings: { clearEmptyFields: [], structurePlan }`. Store the normalized snapshot under a new private object key so preview and import consume the exact validated rows.

The existing `OpenAiColumnMapper` remains wired only in the feature-flag rollback branch; the version-2 analyser owns both structural and semantic column decisions.

- [ ] **Step 5: Teach auto-import and manual preview to consume normalized snapshots**

Use `structurePlan.sourceRowNumbers` when invoking `importCatalogueTable`. Preserve the legacy file parser when no version-2 plan exists or the feature flag is disabled.

- [ ] **Step 6: Run API and worker suites**

Run: `pnpm --filter @autosale/api test -- src/catalogue-import && pnpm --filter @autosale/worker test -- src/catalogue`

Expected: PASS.

- [ ] **Step 7: Commit uploaded-file orchestration**

```bash
git add apps/api/src/catalogue-import apps/worker/src/catalogue apps/worker/src/main.ts
git commit -m "feat: run hybrid AI analysis for catalogue uploads"
```

---

### Task 6: Use version-2 analysis for Google catalogue synchronization

**Files:**
- Modify: `apps/worker/src/catalogue/google-catalogue-sync.processor.ts`
- Modify: `apps/worker/src/catalogue/google-catalogue-sync.processor.spec.ts`
- Modify: `apps/worker/src/catalogue/catalogue-import-decision.ts`
- Modify: `apps/worker/src/catalogue/catalogue-import-decision.spec.ts`

**Interfaces:**
- Consumes: `GoogleSheetsAdapter.readMatrix`, hybrid analyser, and stored structure plans.
- Produces: safe initial Google import, plan reuse for unchanged layouts, and re-analysis for changed layouts.

- [ ] **Step 1: Write failing Google synchronization tests**

```ts
it('imports MetrDoor rows 24 onward from a header at rows 21 and 22', async () => {
  sheets.readMatrix.mockResolvedValue(metrDoorMatrix());
  await processor.process({ tenantId, sourceId });
  expect(importer.importTable).toHaveBeenCalledWith(expect.objectContaining({
    headers: ['Асортимент', 'Ціна (грн) / Роздріб'],
    sourceRowNumbers: expect.arrayContaining([24]),
  }));
});

it('reuses a confirmed structure plan when coordinates and labels remain valid', async () => {
  sheets.readMatrix.mockResolvedValue(changedPricesSameStructure());
  await processor.process({ tenantId, sourceId });
  expect(structureAnalyzer.analyze).not.toHaveBeenCalled();
});

it('does not mutate the last valid catalogue when re-analysis is uncertain', async () => {
  structureAnalyzer.analyze.mockResolvedValue(lowConfidenceSuggestion());
  await processor.process({ tenantId, sourceId });
  expect(importer.importTable).not.toHaveBeenCalled();
  expect(prisma.catalogueSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PAUSED' }) }));
});
```

- [ ] **Step 2: Run Google sync tests and verify RED**

Run: `pnpm --filter @autosale/worker test -- src/catalogue/google-catalogue-sync.processor.spec.ts`

Expected: FAIL because synchronization still consumes preselected headers.

- [ ] **Step 3: Implement plan reuse and safe re-analysis**

Validate a stored structure plan against the current raw matrix. If coordinates and combined labels match, normalize locally and reuse the confirmed semantic mapping. Otherwise store the raw revision snapshot, run hybrid analysis, and either import a high-confidence result or pause for review.

```ts
const storedPlan = readStructurePlan(mapping?.transformSettings);
const normalized = storedPlan && structurePlanMatches(matrix, storedPlan)
  ? applyStructurePlan(matrix, storedPlan)
  : await analyseCatalogueMatrix(matrix);
```

- [ ] **Step 4: Correct worker success metrics**

The job wrapper must record `result: failure` when the processor returns `{ status: 'FAILED' }`, rather than logging `catalogue_sync_completed` for validation failures.

- [ ] **Step 5: Run the complete catalogue worker suite and commit**

Run: `pnpm --filter @autosale/worker test -- src/catalogue`

Expected: PASS.

```bash
git add apps/worker/src/catalogue apps/worker/src/main.ts
git commit -m "feat: analyse Google catalogue layouts with AI"
```

---

### Task 7: Expose analysis progress and concise review context

**Files:**
- Modify: `apps/api/src/catalogue-import/catalogue-import.service.ts`
- Modify: `apps/api/src/catalogue-import/catalogue-import.service.spec.ts`
- Modify: `apps/web/src/components/catalogue-source-settings.tsx`
- Modify: `apps/web/src/components/catalogue-source-settings.spec.tsx`
- Modify: `apps/web/src/components/catalogue-import-wizard.tsx`
- Modify: `apps/web/src/components/catalogue-import-wizard.spec.tsx`

**Interfaces:**
- Consumes: persisted version-2 structure plan and import-run status.
- Produces: privacy-safe `analysis` status fields and four user-facing progress stages.

- [ ] **Step 1: Write failing API response tests**

```ts
expect(await service.status(tenantId, runId)).toMatchObject({
  analysis: {
    version: 2,
    headerRows: [21, 22],
    productRows: 46,
    skippedRows: 12,
    confidenceBand: 'HIGH',
    reviewReasons: [],
  },
});
expect(JSON.stringify(await service.status(tenantId, runId))).not.toContain('860х2050');
```

- [ ] **Step 2: Run API tests and verify RED**

Run: `pnpm --filter @autosale/api test -- src/catalogue-import/catalogue-import.service.spec.ts`

Expected: FAIL because analysis metadata is not returned.

- [ ] **Step 3: Add privacy-safe analysis status**

Return counts, coordinate summaries, confidence band, and review reason codes only. Never return raw profiling samples through the status endpoint.

```ts
analysis: plan ? {
  version: plan.version,
  headerRows: range(plan.headerStartRow, plan.headerEndRow),
  productRows: plan.productRowNumbers.length,
  skippedRows: plan.skippedRowNumbers.length,
  confidenceBand: confidenceBand(plan.structureConfidence),
  reviewReasons: readReviewReasons(run.rowErrors),
} : null
```

- [ ] **Step 4: Write failing UI progress and review tests**

```tsx
expect(screen.getByText('Розпізнаємо структуру таблиці')).toBeInTheDocument();
expect(screen.queryByText('Рядки заголовків: 21–22')).not.toBeInTheDocument();

renderReview({ confidenceBand: 'LOW', headerRows: [21, 22] });
expect(screen.getByText('Рядки заголовків: 21–22')).toBeInTheDocument();
expect(screen.getByRole('link', { name: 'Перевірити сумнівні поля' })).toBeInTheDocument();
```

- [ ] **Step 5: Implement progress copy and conditional review details**

The blocking loader cycles only when the backend stage changes: `Читаємо таблицю` → `Розпізнаємо структуру таблиці` → `Перевіряємо товарні рядки` → `Завантажуємо товари`. Do not use a cosmetic timer. Keep technical structure details hidden for completed high-confidence imports.

- [ ] **Step 6: Run API and web tests, then commit**

Run: `pnpm --filter @autosale/api test -- src/catalogue-import && pnpm --filter @autosale/web test -- src/components/catalogue-source-settings.spec.tsx src/components/catalogue-import-wizard.spec.tsx`

Expected: PASS.

```bash
git add apps/api/src/catalogue-import apps/web/src/components/catalogue-source-settings.tsx apps/web/src/components/catalogue-source-settings.spec.tsx apps/web/src/components/catalogue-import-wizard.tsx apps/web/src/components/catalogue-import-wizard.spec.tsx
git commit -m "feat: show catalogue analysis progress"
```

---

### Task 8: Feature flag, privacy verification, and production acceptance

**Files:**
- Modify: `packages/config/src/worker-env.ts`
- Modify: `packages/config/src/worker-env.spec.ts`
- Modify: `.env.example`
- Modify: `compose.yaml`
- Modify: `tasks/todo.md`
- Create: `tests/e2e/catalogue-hybrid-analysis.spec.ts`

**Interfaces:**
- Consumes: completed hybrid pipeline.
- Produces: `CATALOGUE_AI_STRUCTURE_ANALYSIS` rollback flag, E2E evidence, and updated task status.

- [ ] **Step 1: Write a failing configuration test**

```ts
it('enables hybrid catalogue analysis by default and accepts an explicit rollback', () => {
  expect(parseWorkerEnv(validEnv()).CATALOGUE_AI_STRUCTURE_ANALYSIS).toBe(true);
  expect(parseWorkerEnv({ ...validEnv(), CATALOGUE_AI_STRUCTURE_ANALYSIS: 'false' }).CATALOGUE_AI_STRUCTURE_ANALYSIS).toBe(false);
});
```

- [ ] **Step 2: Run the config test and verify RED**

Run: `pnpm --filter @autosale/config test -- src/worker-env.spec.ts`

Expected: FAIL because the flag is absent.

- [ ] **Step 3: Implement and wire the rollback flag**

```ts
CATALOGUE_AI_STRUCTURE_ANALYSIS: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
```

Pass the value into `CatalogueMappingProcessor` and `GoogleCatalogueSyncProcessor`; `false` selects the preserved legacy reader.

- [ ] **Step 4: Add end-to-end acceptance coverage**

The E2E test uploads a fixture with title rows, a two-row header, spacer columns, category rows, and product rows. It asserts automatic completion, exact product names/prices, category rows absent from products, original row numbers in errors, and no raw values in captured structured logs.

- [ ] **Step 5: Run the full verification suite**

Run: `pnpm -r test && pnpm -r build && pnpm exec playwright test tests/e2e/catalogue-hybrid-analysis.spec.ts`

Expected: all tests and builds PASS.

- [ ] **Step 6: Commit acceptance and configuration**

```bash
git add packages/config .env.example compose.yaml tasks/todo.md tests/e2e/catalogue-hybrid-analysis.spec.ts
git commit -m "test: verify hybrid catalogue analysis"
```

- [ ] **Step 7: Deploy and verify the real MetrDoor sheet**

Run:

```powershell
docker compose --env-file 'C:\Users\User\Documents\ChatGPT\AutoSales\.env' -p autosale up -d --build api web worker
docker compose --env-file 'C:\Users\User\Documents\ChatGPT\AutoSales\.env' -p autosale ps
```

Expected: `api`, `web`, and `worker` are healthy. Re-import the `прайс` tab and verify the UI reports a completed high-confidence import, product rows contain names and numeric prices, category/header rows are skipped, and no manual preview appears.

- [ ] **Step 8: Push the verified branch to master**

```bash
git push origin HEAD:master
```
