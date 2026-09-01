# Task 5 Fix Round 3 Report — Catalogue Mapping Lease Rollout Safety

## Delivered

- Updated `20260901090000_catalogue_mapping_leases` to fence every pre-lease `MAPPING` row whose lease token is null into `MAPPING_REVIEW`. The migration clears `mapping_id` and lease fields and records the manual-recovery marker `MAPPING_UPGRADE_RECOVERY`.
- Added a Testcontainers/Postgres migration integration test that starts from the pre-lease schema, inserts a legacy mapped run, applies the migration, verifies the fenced state, and confirms a new mapping processor cannot claim or call the mapper.
- Made both mapping claims and durable reconciliation require `mappingLeaseId: { not: null }` for expired `MAPPING` rows. Null-lease rows are never reclaimed or enqueued by new code.
- Strengthened the processor heartbeat regression to hold a mapping open for six minutes (beyond the five-minute lease), run the reconciler and a competing claimant, and verify that the active mapper remains the sole claimant.
- Updated the API catalogue-import integration fixture to apply the lease migration, keeping its Prisma-backed test schema aligned with the generated client.
- Retained no generated Prisma diff: `prisma generate` produced only line-ending/whitespace changes relative to the committed generated client.

## RED / GREEN Evidence

RED assertions for the null-token guard failed as expected: 3 tests failed because the processor and reconciler stale predicates did not yet require `mappingLeaseId: { not: null }`.

GREEN focused verification:

```text
catalogue-mapping.processor.spec.ts + catalogue-mapping-reconciler.spec.ts + catalogue-mapping-lease-migration.spec.ts
Test Files  3 passed (3)
Tests  11 passed (11)
```

## Final Verification

```text
pnpm --filter @autosale/worker test -- src/catalogue
Test Files  14 passed (14)
Tests  43 passed (43)

pnpm --filter @autosale/api test
Test Files  43 passed (43)
Tests  202 passed (202)

pnpm --filter @autosale/web test
Test Files  25 passed (25)
Tests  58 passed (58)

pnpm typecheck
All 8 workspace projects completed successfully

pnpm --filter @autosale/database generate
Generated Prisma Client (7.10.0)

pnpm --filter @autosale/database exec prisma validate --schema prisma/schema.prisma
The schema at prisma\\schema.prisma is valid

git diff --check
PASS
```

## Files

- `packages/database/prisma/migrations/20260901090000_catalogue_mapping_leases/migration.sql`
- `apps/worker/src/catalogue/catalogue-mapping-lease-migration.spec.ts`
- `apps/worker/src/catalogue/catalogue-mapping.processor.ts`
- `apps/worker/src/catalogue/catalogue-mapping.processor.spec.ts`
- `apps/worker/src/catalogue/catalogue-mapping-reconciler.ts`
- `apps/worker/src/catalogue/catalogue-mapping-reconciler.spec.ts`
- `apps/api/src/catalogue-import/catalogue-import.service.spec.ts`

## Remaining Concerns

None for this ruling. Legacy in-flight mapping suggestions during rollout are intentionally discarded and require owner/manual remapping; this is the accepted safety tradeoff for preventing an old worker from winning after lease columns are introduced.
