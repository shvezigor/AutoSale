# Task 6 Fix Round 3 Report

## Scope

This patch resolves the remaining catalogue import lease-locking finding at `a4cf3d8`. It changes no database schema and adds no migration.

## Root cause

The catalogue import engine renewed `CatalogueSource.syncLeaseExpiresAt` at the beginning of its serializable product transaction and checked it again at the end. PostgreSQL retained the row lock from the first update until the whole product transaction committed. The worker/API heartbeat used another connection, so it could not renew that same source row during a real import lasting longer than the five-minute lease. The final expiry check then rejected and rolled back the otherwise valid import.

## Fix architecture

1. **Heartbeat-safe long transaction**
   - The product transaction performs no `CatalogueSource` write while product work is in progress.
   - Its initial ownership check is a read-only token/version/expiry preflight, so an already-lost lease fails before the first product upsert without blocking heartbeat renewal.

2. **Atomic product import and SKU ownership**
   - Every product upsert remains in one transaction, preserving all-or-nothing visibility and rollback.
   - A tenant-scoped PostgreSQL transaction advisory lock serializes catalogue writers before the complete cross-source SKU ownership check and remains held through commit.
   - This replaces the product-writer serialization previously supplied by serializable isolation without locking the renewable source row.

3. **Current-state commit fence**
   - The transaction uses `READ COMMITTED`, allowing the final fence to observe heartbeat renewals committed after the long transaction began.
   - Immediately before commit, it conditionally performs a no-op update of the unchanged lease token while requiring the same tenant/source, Google source type, lease token, source sync version, and an unexpired deadline.
   - That update locks `CatalogueSource` only for the short final commit window. A claimant that wins first changes the token/version and forces all product writes to roll back; a claimant that arrives after the fence waits until the valid owner commits.

4. **Snapshot and completion safety retained**
   - Google import runs continue carrying `sourceSyncVersion` from the claimed snapshot.
   - Worker and owner-confirmation completion transactions still fence source activation and run completion by token/version, so a stale snapshot cannot become active.

## TDD evidence

The first regression test was written and run against the old implementation before production changes. It starts PostgreSQL 17 through Testcontainers, holds an actual product write inside a trigger on an advisory lock, and attempts a heartbeat from a separate connection with a one-second `statement_timeout`. The old source-row update caused the expected timeout failure.

After the redesign, the same real concurrency test proves the heartbeat update completes while the atomic product transaction remains open. A second PostgreSQL test replaces the lease token/version during the blocked import and proves the importer raises `CatalogueImportLeaseLostError` and commits zero products.

A second red/green cycle added an already-expired lease case. It failed before the read-only preflight existed, then passed once the engine rejected the lease before attempting a product upsert.

## Verification

- Focused database lease/import suites: 2 files / 9 tests passed, including both PostgreSQL concurrency tests.
- Focused worker catalogue suites: 2 files / 14 tests passed.
- Focused API catalogue suites: 2 files / 21 tests passed.
- Full `pnpm test`: 99 files / 425 tests passed.
- Full `pnpm typecheck`: all 8 workspace projects passed.
- `pnpm --filter @autosale/database generate`: Prisma Client generated successfully.
- `pnpm --filter @autosale/database exec prisma validate`: schema valid.
- Generated whitespace-only churn was removed; no generated client or schema change is part of this patch.
- `git diff --check`: clean.
