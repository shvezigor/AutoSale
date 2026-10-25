# AI usage ledger and private cost report acceptance

Date: 2026-10-25. Status: **In progress; local pre-release verification only**. No production deployment, collection activation, privacy/accounting approval, real invoice reconciliation or measured cost-per-order result is claimed. The [canonical design](../superpowers/specs/2026-10-24-ai-provider-usage-ledger-design.md), [report runbook](../operations/ai-usage-cost-report.md) and [retention policy](../operations/data-protection-and-retention.md#ai-usage-measurement-approval-and-maintenance) own behavior and operation.

## Commit, image and environment record

- Verified implementation: `4fa109fb9ec7f800935d91f7a612bc3c618d9e14` (`fix: guard every catalogue AI dispatch against freeze and lease loss`), branch `codex/ai-usage-ledger`. This refresh supersedes the initial `1590097` preflight recorded by documentation commit `b61e493`.
- Local `master` observed before preflight: `d921447dfe6f7001d7e444ff498acc43dcdc96b4`. This is a local reference, not a freshly verified remote or deployed SHA. Recheck current master before release.
- Environment: isolated Windows checkout, fictional PostgreSQL Testcontainers fixtures and temporary private report files. No production connection, secrets, customer records or provider invocation was used for this preflight.
- `pnpm build` compiled all eight workspace packages, including the Next.js application. It did not build a release Docker image. Running production image digests, candidate image IDs, backup ID and migration deployment state were not inspected; the release operator must record them before changing live state.
- Source defaults independently leave `AI_USAGE_COLLECTION_ENABLED=false` and `AI_USAGE_RETENTION_ENABLED=false` in worker configuration, Compose and the example environment. Actual deployed flags were not inspected or changed.

## Automated preflight evidence

All commands ran against the implementation SHA above on 2026-10-25. Documentation added by this preflight does not change runtime behavior.

| Gate | Evidence |
| --- | --- |
| `pnpm build` | Passed, exit 0; all eight workspace packages. |
| `pnpm typecheck` | Passed, exit 0; all eight workspace packages. |
| `pnpm test` | Passed, exit 0; 390 files / 2,351 tests passed, 3 files / 6 tests skipped. Web 519, config 48, contracts 126, observability 7, database 188, integrations 202, API 731 and worker 530 passing tests. API has 4 skipped tests; worker has 2 skipped tests. |
| `pnpm --filter @autosale/database exec vitest run src/ai-provider-usage.postgres.spec.ts` | Passed, exit 0; 1 file / 7 tests, 16.43s. Actual PostgreSQL 17.6 with full migrations and restricted runtime roles. |
| `pnpm --filter @autosale/worker exec vitest run src/ai-usage src/catalogue/catalogue-dispatch-guards.spec.ts src/tenant-lifecycle/tenant-export-datasets.spec.ts src/tenant-lifecycle/tenant-export-writer.spec.ts src/orders/triggered-order.processor.spec.ts` | Passed, exit 0; 10 files / 145 tests, 16.53s. Includes real PostgreSQL report reading/private-file acceptance, metering adapters, maintenance, export, recognition freeze and catalogue dispatch guards. |
| `pnpm audit --audit-level moderate` | Passed, exit 0; no known vulnerabilities found. |
| `pnpm audit --prod --audit-level high` | Passed, exit 0; no known vulnerabilities found. |
| `git diff --check`, `git diff --cached --check`, staged whitespace/path/content audit | Passed; exactly five scoped documentation paths, no secret/runtime/build/private-report paths or credential signatures. Manual content review found no customer data, tenant totals or invoice inputs. Relative file links in all five documents resolve. |

The ledger test proves empty/cross-tenant context isolation, denied API writes/direct runtime deletion, explicit zero versus partial/missing evidence, immutable terminal rows, in-flight finalization after freeze, repeated runtime-role bootstrap and maintenance bounds. Focused worker coverage also proves exact integer-string token totals and rejection of sub-millisecond operator timestamps, private-file/ACL/path protections, test-cohort separation, zero-order handling, setup spend and provisional/missing-input behavior. No focused tests were skipped. The default worker suite leaves its opt-in catalogue benchmark and full-container demo-notification restart acceptance skipped; the API run also reports four skipped tests and is not claimed to exercise those cases. API tests emitted PostgreSQL concurrent-query deprecation and simulated provider/queue-failure warnings without test failures. These are fictional automated results, not measured production charges. Windows ACL checks ran on Windows; POSIX permission enforcement still requires a supported POSIX-host acceptance check.

Post-review dispatch evidence in `catalogue-dispatch-guards.spec.ts` adds 36 cases across ordinary mapping, hybrid uploaded-source mapping and hybrid Google pre-import. With collection OFF and ON, a freeze during source read blocks the first provider call/usage start; a freeze or revoked/expired lease between stages or later 50-column/100-row batches blocks further dispatch without retry. Existing dispatched calls can finalize normally, and ownership loss does not create a mapping from stale results. Processors supply a fresh tenant-lifecycle/current lease/expiry guard to all three catalogue adapters immediately before the metered boundary. These fictional race regressions do not close the deployed browser/freeze/lease acceptance gate.

## Migration and grant review

- [x] Read `20261024_ai_provider_usage_attempts/migration.sql`: new enums/table/indexes, forced tenant RLS, token/outcome constraints and a terminal-update rejection trigger. API has tenant-scoped SELECT; worker has SELECT/INSERT/UPDATE; both runtime roles are denied direct DELETE.
- [x] Read `20261025_ai_provider_usage_maintenance/migration.sql`: additive functions and terminal index; no existing business-table rewrite or historical usage backfill. Discovery and purge each hard-cap at 100. Orphans are strictly older than 15 minutes; terminal retention is strictly more than 90 days after finalization. STARTED and freshly repaired ancient attempts are preserved.
- [x] Read `packages/database/src/runtime-database-roles.ts`: repeated bootstrap reapplies ledger restrictions; maintenance functions use fixed `pg_catalog, public` search paths and worker-only execution, with PUBLIC/API/backup execution revoked. The PostgreSQL tests exercise the upgrade with roles already present and repeated bootstrap.
- [ ] On the target, record approved release SHA and old/candidate image IDs/digests; take and verify a fresh backup before migration, then verify actual migrated schema/RLS/function grants and separate runtime roles. Follow [deployment](../operations/deployment.md) and [backup/restore](../operations/backup-restore.md). No live migration was performed in this preflight.

## Pending production, browser and recovery gates

- [ ] Record a controlled privacy/accounting decision with approvers, date, purpose/lawful basis, 90-day terminal retention, backup treatment, invoice evidence and authorized scope. Feature-design approval is not activation approval. Keep collection and deletion independently OFF until the applicable approvals and rollout gates pass; a disabled release is schema/code-only acceptance.
- [ ] Manually release the approved additive migration and API/worker images after backup verification; record exact SHA, images, time and rollback reference. Verify API/worker readiness, queue health and bounded content-free metering/maintenance signals. Do not infer deployed flags from source defaults.
- [ ] With an explicitly authorized fictional/test tenant and approved collection activation, use a real browser for ordinary catalogue mapping and hybrid Google pre-import mapping, order recognition/intent and AI draft generation. Verify each visible result, relevant validation/provider failure state, downstream catalogue/order/conversation screen and persistence after reload. Capture final screenshots where visual behavior matters. No live browser step was run here.
- [ ] Through private tenant-scoped tooling, correlate that authorized flow to one ledger row per actual model invocation, including each catalogue batch, ignored intent, invalid parsed response and explicit retry. Verify timeout/missing usage remain unknown, deterministic fallback produces no attempt, tenant separation holds and no tenant/operation/content data enters logs or metric labels. The ledger itself is private and has no customer UI.
- [ ] Verify freeze blocks new calls and preserves already-dispatched finalization in the target environment, including freezes during catalogue source reads/between batches and revoked/expired mapping or Google source leases; exercise orphan recovery without provider replay and approved retention cutoffs in an isolated acceptance environment. Do not induce production deletion/freeze or provider outages without separate authorization.
- [ ] Complete lifecycle export/download acceptance for the fictional tenant: the private deterministic export includes only that tenant's ledger rows, with count/checksum verification and no cross-tenant data. Automated export checks do not close deployed browser/download acceptance.
- [ ] Complete an isolated backup/restore drill that includes the new table, runtime grants, immutable evidence and tenant isolation. Verify deletion-ledger replay, approved retention reapplication before normal access and the documented backup expiry; do not restore over production for this check. Existing generic restore evidence does not prove this ledger's restore acceptance.
- [ ] On the intended Linux/POSIX operator host, verify private-directory ownership, rejection of broad permissions, exclusive 0600 output and redacted failure behavior. Keep actual inputs/reports outside Git and logs and dispose of them under the approved policy.

No customer reply, shipment, real-customer test or uncontrolled provider side effect is authorized by this checklist. Required live test inputs and any provider charges need explicit authorized test scope.

## Pending invoice and pricing gates

- [ ] Obtain the actual effective tariff versions/rates and provider invoice in the provider currency; verify the Sales AITO-only account/project boundary and exact month/authorized tenant set, including test tenants. Review credits/taxes separately from the pre-credit/pre-tax subtotal and explain every variance.
- [ ] Record full-period collection completeness, activation/failure/retention/restore evidence and explicit historical gaps. Default-OFF collection and an empty ledger never prove zero charges. Reconcile private output, not product-table token metadata.
- [ ] Obtain actual infrastructure evidence and approve the attributable included-cohort amount for shared technical/test workloads. Preserve separate currencies and leave the blended ratio null when currencies differ.
- [ ] Confirm real-report labels for test-cohort exclusion, setup spend, zero canonical orders, unknown/missing usage, lower-bound known costs and PROVISIONAL coverage. Record only approved aggregate conclusions; never commit invoice inputs, tenant totals or private output.

There is no measured cost-per-order figure and no evidence that the 30%-of-revenue pricing hypothesis is satisfied. Subscriptions, entitlements, billing, longer-lived tenant-linked summaries and the broader AI draft pilot remain outside this slice.

## Integration handoff

- [ ] After approval and the relevant live gates, the controller owns integration into current `master`, push/remote-SHA verification and removal of the merged branch/worktree only after proving no unique tracked or untracked work remains. This preflight does not merge, push or clean the worktree. Preserve `artifacts/`.
