# Task 6 Fix Round 2 Report

## Scope

This successor patch addresses all seven round-2 catalogue import findings without modifying an already-applied migration.

## Findings and fixes

1. **Explicit SKU ownership semantics**
   - The import boundary now requires an ownership policy.
   - CSV/XLSX snapshots use `REASSIGN`: a changed upload/new source updates the tenant-wide SKU and takes source provenance, including the Task 7 changed-name case.
   - Google synchronization uses `FENCE_CROSS_SOURCE`: a SKU with a different non-null source owner pauses before mutation.
   - The design specification documents these rules.

2. **Whole-import validation before mutation**
   - All valid SKUs are collision-checked before the first upsert.
   - All product writes run in one serializable transaction instead of independently committed 100-row batches.
   - A collision on row 101 therefore leaves rows 1-100 unmodified.

3. **Renewable lease and commit fencing**
   - Google workers and owner confirmation renew their five-minute source lease every minute.
   - Product transactions verify the lease token, source version, and unexpired deadline before and after writes.
   - The source row remains transactionally locked while product writes occur, so an expired claimant cannot be replaced mid-commit.
   - Product changes roll back when the final fence is lost; run/source completion is also atomic and fenced.
   - The interactive transaction timeout allows imports longer than five minutes.

4. **Atomic Google snapshot confirmation**
   - Confirmation atomically claims the source and transitions the preview run.
   - The stored `sourceSyncVersion` must match current configuration, then both source and run advance to the new fence version.
   - Stale snapshots/configuration races cannot import products or mark the source `ACTIVE`.

5. **Real Google bounds and local validation classification**
   - Reads request complete rows rather than an A:CV rectangle, so a populated 101st column is visible and rejected.
   - The accepted limit remains 5,000 data rows, 100 columns, and 10,000 characters per cell.
   - A documented finite 5,000-row overflow window detects sparse populated rows beyond the accepted row cap.
   - Local row/column/cell/header violations use non-retryable `GoogleSheetsTableValidationError` categories; provider authorization, not-found, rate-limit, and transient failures retain their separate classifications.

6. **Schedule successor migration**
   - Added `20260901130000_catalogue_sync_schedule_backfill`.
   - Existing `ACTIVE` Google sources with `HOURLY` or `DAILY` schedules and null `next_sync_at` become immediately discoverable by the scheduler.
   - Manual and non-active sources remain unscheduled.

7. **Owner preview recovery**
   - Owner configuration now exposes both `MAPPING_REVIEW` and `PREVIEW_READY` runs.
   - A worker that sees an existing preview refreshes its snapshot metadata and source fence version, releases the lease, and returns `PREVIEW_READY` instead of colliding with the idempotency key.
   - Existing mapping-review snapshots receive the same safe refresh behavior.

## TDD evidence

Each behavior was introduced through a focused failing test before implementation. The regression coverage includes:

- changed CSV upload updates the existing Task 7 SKU name and source provenance;
- Google cross-source SKU collision remains fenced;
- row-101 collision performs zero product upserts;
- lost final lease fence rolls back transactional product writes;
- a six-minute import renews its lease and keeps a competing claimant `BUSY`;
- stale Google preview/configuration version cannot confirm or activate;
- complete-row column overflow and sparse row overflow are detected;
- local table validation is owner-fixable/non-retryable;
- `PREVIEW_READY` is owner-visible and worker-resumable;
- the successor migration backfills only active hourly/daily Google sources against PostgreSQL.

## Verification

- Focused changed-area suites: 60 tests passed.
- Full `pnpm test`: 98 files / 422 tests passed.
- Full `pnpm typecheck`: all 8 workspace projects passed.
- `pnpm --filter @autosale/database generate`: Prisma Client generated successfully.
- `pnpm --filter @autosale/database exec prisma validate`: schema valid.
- `git diff --check`: clean after generated whitespace-only output was discarded.
