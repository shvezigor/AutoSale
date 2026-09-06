# AI-assisted catalogue table structure analysis

## Goal

AutoSale must import product catalogues whose headers and product rows are not in fixed positions. The system must use AI to identify the table structure and ambiguous rows while keeping the final import deterministic, tenant-scoped, bounded, and reviewable.

The owner continues to select a Google Sheet, CSV, or Excel file and click one action. A preview is shown only when the analysis is uncertain or invalid; a high-confidence analysis imports automatically.

## Current limitation

The current pipeline asks AI to map columns only after deterministic code has already selected a header row. This makes AI unable to recover when a supplier file contains title blocks, merged multi-row headers, spacer columns, repeated section headings, or product data that begins far below the top of the sheet.

## Chosen approach

Use a two-stage hybrid analysis:

1. AI proposes the document structure and semantic column mapping from a bounded structural profile.
2. Deterministic code applies the proposal to every row and identifies obvious product, category, metadata, and empty rows.
3. Only ambiguous rows are classified by AI in bounded batches.
4. Strict validation decides between automatic import and manager review.

AI never rewrites, completes, or invents product values. Imported values always come from their original cells.

## Data flow

### 1. Raw extraction

Google Sheets, CSV, and XLSX readers produce a `RawCatalogueMatrix` instead of assuming that the first meaningful row is the header:

- original one-based row numbers;
- original zero-based column positions;
- primitive cell values;
- source revision;
- maximum 5,000 rows and 500 columns;
- existing cell-size and source-size limits.

Empty leading rows and columns remain addressable. The raw matrix is stored in the private tenant catalogue snapshot and is never logged.

### 2. Local structural profile

A deterministic profiler creates a bounded AI input containing:

- row numbers and non-empty column positions;
- up to 120 leading non-empty rows;
- up to 40 evenly distributed rows from the remainder of a long sheet;
- primitive type summaries per column;
- cell samples truncated to 200 characters;
- repeated row-shape statistics.

The complete 5,000-row source is not sent in the first AI request.

### 3. AI structure proposal

The OpenAI Responses API returns strict JSON matching `TableStructureProposal`:

- `headerStartRow` and `headerEndRow`, with at most three header rows;
- `dataStartRow`;
- semantic columns identified by stable numeric column indexes;
- combined display labels for multi-row headers;
- a target field and confidence for every selected column;
- ignored columns;
- overall structure confidence;
- row-shape hints used by the deterministic classifier.

Column indexes, rather than header text alone, preserve duplicate labels and spacer columns.

### 4. Deterministic normalization

The normalizer validates that proposed coordinates exist, combines multi-row labels, and projects only selected columns. It then classifies every source row:

- `EMPTY`: no mapped values;
- `PRODUCT`: has a mapped name and sufficient product-shaped values;
- `CATEGORY`: section or group label without sufficient product data;
- `METADATA`: contact, title, currency note, or other pre-table content;
- `AMBIGUOUS`: cannot be classified safely by deterministic rules.

Rows keep their original row numbers for error reporting. The normalizer must not silently convert an ambiguous row into a product.

### 5. AI classification of ambiguous rows

Ambiguous rows are sent to a second strict-schema AI request in batches of at most 100 rows. Each result contains only the original row number, `PRODUCT` or `SKIP`, and confidence. The response cannot contain replacement cell values.

If a catalogue produces more than 1,000 ambiguous rows, automatic import stops and manager review is required. This prevents unbounded cost and signals that the proposed structure is unreliable.

### 6. Decision and import

Automatic import is allowed only when:

- overall structure confidence is at least 0.90;
- a name column exists with confidence at least 0.90;
- semantic targets are unique;
- at least one valid product row exists;
- every AI-classified ambiguous row has confidence at least 0.90;
- deterministic validation finds no coordinate or schema inconsistency.

Otherwise the existing review screen opens with the recognized header rows, column mapping, sample products, skipped-row counts, and explicit reasons for review.

## Persistence and compatibility

The existing `CatalogueMapping.columns` remains the canonical semantic mapping consumed by the importer. `CatalogueMapping.transformSettings` stores a versioned `structurePlan` containing header coordinates, stable source column indexes, row-policy metadata, and prompt/schema versions.

Existing confirmed mappings without a structure plan continue to work for already normalized sources. A new or structurally changed source creates a version-2 structure analysis. The structure fingerprint includes header coordinates, selected column indexes, and normalized labels, so changing only product values does not trigger remapping.

No database migration is required for the first version because `transformSettings` is already JSON.

## Components and boundaries

- `packages/integrations`: add raw matrix readers; retain existing `readTable` behavior for order-export code.
- `packages/contracts`: define strict structure proposal, row classification, and versioned structure-plan schemas.
- `apps/worker/catalogue-table-profiler`: create privacy-bounded AI input.
- `apps/worker/openai-table-structure-analyzer`: request and validate the structure proposal.
- `apps/worker/catalogue-row-classifier`: classify deterministic rows and request AI only for ambiguous rows.
- `apps/worker/catalogue-mapping.processor`: orchestrate analysis, persist the mapping/plan, and select auto-import or review.
- `apps/worker/catalogue-auto-importer`: consume normalized rows with original row numbers.
- `apps/web`: keep the simple source-selection flow; add analysis progress and show structure details only when review is required.

Each component receives plain typed data and has no access to unrelated tenant records.

## Failure handling

- Invalid or out-of-range AI coordinates: review required; no import.
- Missing name mapping or no valid products: review required.
- OpenAI timeout, malformed response, or quota failure: review required with a retry action.
- Google/API/storage failure: preserve the last valid catalogue and use the existing retryable source status.
- Source changes during analysis: reject the stale result using the source revision and retry against the new revision.
- Partial ambiguous-row classification: review required; never import the partially classified set.

## Privacy, cost, and observability

- OpenAI requests use `store: false`.
- Raw cells, samples, prompts containing cells, and AI row responses are not logged.
- Logs and platform-admin views expose only counts, timings, model/prompt versions, confidence bands, and failure codes.
- AI input and output sizes are bounded; ambiguous classification has a hard row cap.
- Every database and storage access remains scoped by `tenantId`.

## User experience

The owner sees these progress stages in the existing blocking loader:

1. Reading the table.
2. Recognizing its structure.
3. Checking product rows.
4. Importing products.

On high confidence, the final toast reports imported, updated, skipped, and failed counts. On low confidence, the user is taken to a concise review showing only decisions that need confirmation. The normal catalogue screen does not expose the technical analysis.

## Testing

Unit and integration tests must cover:

- headers after row 20 and multi-row headers;
- sparse columns and duplicate header labels;
- title/contact blocks before data;
- category rows interleaved with products;
- one-column catalogues and catalogues without prices;
- AI classification of ambiguous rows;
- malformed/out-of-range AI responses;
- low-confidence review fallback;
- source revision changes during analysis;
- no raw product data in logs;
- unchanged-source reuse of a confirmed structure plan;
- Google Sheets, CSV, and XLSX parity;
- the current MetrDoor layout: rows 21–22 as headers, columns F/H as name/price, category rows skipped, product rows imported.

The change is delivered test-first and deployed behind a worker configuration flag. After production verification on the current catalogue, the flag becomes the default and the legacy deterministic header selector remains only as a temporary rollback path.
