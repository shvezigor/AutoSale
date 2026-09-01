# Product Catalogue Import and Synchronization Design

## Purpose

AutoSale needs a tenant-scoped product catalogue that becomes the trusted source for recognizing products mentioned in customer chats. A tenant owner can populate the catalogue from Excel, CSV, or Google Sheets even when source columns use arbitrary names. OpenAI proposes a mapping between source columns and AutoSale fields, but the owner reviews the mapping and explicitly confirms every first import or structural change.

Catalogue ingestion and order export are independent integrations. They may use separate spreadsheets, separate tabs in one spreadsheet, or unrelated sources. The internal PostgreSQL catalogue remains the source used by order recognition; external tables are import and export boundaries, not the application database.

## Scope

The first release includes:

- an owner-managed catalogue screen with tenant-scoped product search and filters;
- manual product creation and editing;
- `.xlsx` and `.csv` upload;
- Google Sheets catalogue connections using a spreadsheet and tab selected by the owner;
- AI-assisted column mapping with confidence and manual correction;
- preview, validation, confirmed import, and an import report;
- SKU-based idempotent upserts;
- saved mappings and manual or scheduled Google Sheets synchronization;
- read-only catalogue access for tenant managers;
- privacy-safe aggregate health information for platform administrators;
- independent configuration for catalogue sources and order-export destinations.

This release does not include arbitrary ERP connectors, destructive source mirroring, automatic product deletion, or AI-generated catalogue values.

## Roles and Isolation

- `OWNER` can create and edit products, configure sources, approve mappings, run imports, manage schedules, and inspect reports.
- `MANAGER` can search and view the tenant catalogue and select products while reviewing orders, but cannot change sources or catalogue data.
- The platform administrator can see operational status, import counts, durations, and failure categories. The administrator cannot see product names, SKU values, prices, source rows, mappings containing source data, or tenant customer data.
- Every query, mutation, job, source, mapping, product, and import run is scoped by `tenantId` on the server. Client-supplied tenant identifiers are never trusted.

## Domain Model

### Product

The existing `Product` model is extended to support:

- `sku`: stable unique identifier within a tenant;
- `name`: canonical display name;
- `description`;
- `price` and `currency`;
- `stockQuantity`;
- `category`;
- `brand`;
- `aliases`: alternative names used by deterministic and AI-assisted matching;
- `color`, `size`, and `attributes` for other tenant-specific characteristics;
- `imageUrls` containing validated external image references;
- `active`;
- `sourceId`, `sourceRowKey`, and `sourceUpdatedAt` for synchronization provenance;
- normal audit timestamps.

`attributes` is JSON and preserves additional mapped fields without adding a database column for every tenant-specific characteristic. Critical matching and export fields remain typed columns.

### CatalogueSource

A source describes one reusable input:

- source type: `XLSX_UPLOAD`, `CSV_UPLOAD`, or `GOOGLE_SHEETS`;
- tenant, display name, status, and owner;
- Google spreadsheet ID and tab identifier where applicable;
- encrypted or referenced credentials, never raw credentials in the database or API response;
- confirmed mapping version;
- optional synchronization schedule;
- last successful synchronization and privacy-safe error summary;
- a structural fingerprint derived from normalized headers.

Uploaded files are stored in controlled object storage for the duration required by the import and configured audit retention. Raw file access is owner-only and expires according to policy.

### CatalogueMapping

A versioned mapping stores:

- source header and normalized header;
- target field or ignored status;
- optional transformation settings;
- AI confidence and reason category;
- whether the owner changed or confirmed the suggestion;
- the source structure fingerprint;
- prompt and schema version without source row contents.

Only an owner-confirmed mapping can be reused for automatic synchronization.

### CatalogueImportRun

An import run records:

- source, mapping version, actor, and status;
- source checksum or Google revision marker;
- total, valid, created, updated, skipped, and failed row counts;
- start and completion timestamps;
- row-level validation results stored with bounded retention;
- an idempotency key so retries cannot create duplicate runs or products.

## Import Workflow

1. The owner opens Catalogue and selects **Import**.
2. The owner chooses Excel, CSV, or Google Sheets.
3. For a file, the API validates type and size before placing it in controlled storage. For Google Sheets, the owner supplies or selects a spreadsheet and tab, and the API verifies access.
4. A background parser reads headers and a bounded sample. Formula results are read as values; formulas are never executed by AutoSale.
5. The API sends headers, data types, and a small redacted sample to the OpenAI Responses API using a strict mapping schema.
6. OpenAI proposes target fields and confidence values. It cannot provide product field values or invent columns.
7. The owner reviews the mapping. Low-confidence, conflicting, or missing required mappings are highlighted.
8. The system parses and validates the complete source using the confirmed mapping and displays a preview plus created/updated/skipped/error counts.
9. The owner confirms the import.
10. The importer validates all rows and tenant SKU collisions before mutation, then performs every product upsert in one serializable transaction and saves an import report. A late collision or lost source fence rolls back the whole product mutation.
11. The internal catalogue becomes available to deterministic candidate search and order recognition.

If OpenAI is unavailable or returns invalid output, the owner can configure mappings manually. AI assistance is not a hard dependency for importing a known structure.

## Mapping Rules

Supported first-release fields are SKU, name, description, price, currency, stock quantity, category, brand, aliases, color, size, image URLs, active status, and arbitrary attributes.

- SKU and name are required before import confirmation.
- AI may map columns but may not invent missing SKU, name, price, stock, or attribute values.
- If the source lacks a SKU, the owner may select another unique source column or explicitly enable deterministic generated identifiers. A generated identifier is derived from stable normalized source values and never generated by the language model.
- One source column maps to at most one typed target field. Multiple columns may be combined only through an explicit, deterministic transformation shown in the mapping UI.
- Unknown columns default to ignored and may optionally be preserved under `attributes`.
- Empty incoming values do not erase existing values unless the owner explicitly enables clearing for that field.
- Duplicate SKU values are rejected with source row numbers. They are not silently merged.
- Price parsing uses an explicit currency and locale. Ambiguous numbers require correction.
- Alias cells may be split using a user-confirmed delimiter and are normalized and deduplicated.

## Upsert and Deactivation Rules

Products are matched by `(tenantId, sku)`. A repeated import updates that product rather than appending another record. The import records which fields changed and who confirmed the mapping.

Source ownership is explicit at the import boundary:

- CSV and XLSX uploads are replaceable snapshots. A changed file creates a new source record but may update and take provenance ownership of an existing tenant SKU, including a changed product name.
- Google Sheets sources are continuously synchronized owners. They may update SKUs already owned by the same source, but a SKU owned by another Google or file source is a collision that pauses before mutation.
- Preview counts remain tenant-SKU based; the ownership policy affects confirmation safety, not whether an existing SKU is reported as an update.

Products missing from a later source revision remain unchanged by default. The owner may request a separate deactivation preview. Only after confirmation can products that belong to that source be marked inactive. Imports never hard-delete products because historical orders may reference them.

## Google Sheets Synchronization

Catalogue sources and order destinations are separate records. The user may configure:

- two unrelated spreadsheets;
- two tabs in the same spreadsheet;
- a file-based catalogue with Google Sheets order export;
- multiple catalogue sources, provided SKU collisions are resolved before import.

A Google catalogue source supports **Synchronize now** and an optional schedule. Automatic synchronization runs only when:

- access remains valid;
- the confirmed mapping exists;
- the normalized header fingerprint is unchanged;
- required columns are present;
- no unresolved SKU collision exists.

When the structure changes, synchronization pauses before product mutation and creates a mapping review task for the owner. The last valid internal catalogue remains available.

Google reads request complete rows so columns beyond the 100-column cap remain detectable. Reads accept at most 5,000 product rows and scan a finite additional 5,000-row window for sparse overflow; structural limit failures are owner-fixable validation errors, never provider retries.

Every Google synchronization or snapshot confirmation atomically claims the source version with a renewable five-minute token lease. A one-minute heartbeat renews the lease during long reads/imports. The product transaction checks the token, version, and unexpired lease before and after mutation, and completion atomically fences the run/source state, so an expired or replaced claimant cannot commit or mark the source active. A preview stores its source version and cannot be confirmed after configuration changes; a refreshed identical preview is reassigned to the current fenced version and remains visible to the owner.

Order export continues through its existing destination and idempotent `orderId` mapping. Catalogue synchronization never writes order rows, and order export never mutates catalogue source data.

## User Interface

### Catalogue Screen

The screen contains:

- searchable, paginated products with active, source, category, and stock filters;
- active product count, latest import status, and source health;
- owner actions for adding a product, importing, editing sources, and synchronizing;
- manager read-only access;
- links to import reports and mapping review tasks.

### Import Wizard

The wizard has the following steps:

1. Choose source type.
2. Upload a file or connect a Google spreadsheet and select a tab.
3. Review detected headers.
4. Review and correct AI-proposed mappings and confidence.
5. Preview normalized products and validation messages.
6. Confirm the import.
7. Track background progress and open the final report.

The preview shows representative transformed rows and the exact totals expected to be created, updated, skipped, or rejected. No catalogue mutation happens before the confirmation step.

## Error Handling

- Unsupported, corrupt, encrypted, or oversized files fail before import creation with an actionable message.
- CSV encoding and delimiter detection is automatic but user-overridable.
- A private or inaccessible Google Sheet displays the service identity or authorization action required to grant access.
- Invalid spreadsheet links, missing tabs, and missing headers do not save an active source.
- Duplicate or missing SKU values produce row-level errors.
- AI failure falls back to manual mapping.
- Google API, rate-limit, and network failures preserve the previous catalogue and create a retryable run.
- Multiple retry clicks reuse the same idempotency boundary.
- Valid rows may be imported when other rows fail only after the preview explicitly identifies a partial import. The report retains every skipped row reason.
- Structural changes pause scheduled synchronization rather than guessing a new mapping.

No raw credential, access token, complete source row, or product/customer data is written to application logs.

## API and Processing Boundaries

The NestJS API owns authenticated catalogue CRUD, source configuration, upload initiation, mapping review, preview access, and import confirmation. Long-running parsing, AI mapping, complete validation, batch upsert, and scheduled synchronization run in BullMQ workers. PostgreSQL stores canonical state and job outcomes; object storage holds temporary source files and bounded reports.

API responses use shared strict contracts. File upload limits are enforced at both proxy and API boundaries. Jobs carry internal IDs only and reload tenant-scoped state from PostgreSQL.

## Testing and Acceptance

Automated coverage includes:

- XLSX and CSV parsing, delimiters, encodings, and invalid files;
- Google Sheets access and tab selection;
- alternative header names and strict OpenAI mapping output;
- low-confidence and conflicting mappings;
- manual mapping and AI outage fallback;
- SKU upsert idempotency, duplicate rejection, partial imports, and empty-value rules;
- changed Google Sheet structure and paused synchronization;
- independent catalogue and order-export destinations;
- owner/manager/admin permissions and tenant isolation;
- retry behavior and absence of duplicated products or jobs;
- secret and personal-data redaction.

End-to-end acceptance requires an owner to import equivalent sample data through CSV and Google Sheets, review the mapping, confirm the import, re-import an updated row without duplication, find the product in catalogue search, and have the order-recognition flow select only a candidate from the imported tenant catalogue.

## Delivery Sequence

Implementation should proceed in vertical increments:

1. Extend the product model and deliver tenant-scoped catalogue CRUD/search.
2. Add CSV/XLSX upload, deterministic parsing, mapping UI, preview, and confirmed import.
3. Add strict OpenAI mapping suggestions and manual fallback.
4. Add Google Sheets catalogue sources using the existing Google integration boundary.
5. Add saved mappings, structural fingerprints, scheduled synchronization, reports, and safe retry.
6. Connect imported catalogue candidates to recognition evaluations and complete end-to-end acceptance.

