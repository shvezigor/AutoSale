# ADR 0002: Shared-schema tenant isolation and database defense in depth

- **Status:** Accepted; relation guards, runtime role separation and incremental RLS rollout in place
- **Date:** 2026-09-28
- **Decision owner:** Sales AITO

## Context

Sales AITO is a multi-tenant SaaS. Customer conversations, orders, catalogues, payments, delivery records and integration state live in shared PostgreSQL tables with a required `tenant_id`. The authenticated session or verified provider binding determines the tenant; ordinary API input must never choose it.

A database per customer would increase provisioning, migration, backup and support cost without being required by GDPR. A shared schema is acceptable only when isolation is enforced consistently and independently tested. Application predicates alone are insufficient defense against a future service bug, unsafe SQL or compromised runtime credential.

## Decision

Keep one shared PostgreSQL schema for the current product stage and enforce these invariants:

1. Tenant identity comes from the authenticated principal or verified external-provider binding, never from an ordinary request body, query or header.
2. Every tenant-owned service query includes the tenant identifier.
3. Every relationship between tenant-owned records is database-enforced as belonging to the same tenant. Required references use composite `(tenant_id, id)` foreign keys. Nullable historical references that must retain `ON DELETE SET NULL` behavior use database tenant guards.
4. Object keys remain tenant-prefixed and object downloads require a tenant-scoped database lookup. A key prefix is organizational defense, not an authorization boundary.
5. Queue producers attach tenant authority only after an authenticated session or verified provider binding establishes it. Queue consumers treat that authority as routing input and re-read the durable record inside the matching tenant transaction before provider or persistence actions.
6. Cross-tenant corruption tests run against real PostgreSQL migrations.
7. Runtime database identities will be separated before RLS is enabled:
   - owner/migrator role for schema migrations only;
   - non-owner, `NOBYPASSRLS` API role;
   - non-owner worker role with only the operations it needs;
   - restricted backup/restore operator.
8. RLS must fail closed when tenant context is absent. Platform administration must use explicit aggregate functions/views instead of silently bypassing tenant policy.

## Available controls

- Sessions bind a user, tenant and role and revalidate active user, tenant and membership state.
- Tenant-facing controllers pass the session-bound tenant to services.
- Provider webhooks derive tenant ownership from verified connection state.
- Composite tenant relations already protect delivery, inventory and several catalogue/payment paths.
- Migration `20260928224500_tenant_relation_guards` extends database protection to messages, orders, legal entities/accounts, commercial terms, Sheets exports and order audit logs.
- `tenant-relations.postgres.spec.ts` proves representative cross-tenant writes fail with PostgreSQL foreign-key violations.
- Deployments provision separate `autosale_api` and `autosale_worker` login roles after migrations. Both are non-owner, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION` and `NOBYPASSRLS`; neither can create or alter schema objects.
- The owner connection remains available only to the one-shot migration and role-provisioning jobs. Application containers receive role-specific URLs and refuse to start when their distinct secrets are absent.
- `withTenantTransaction` provides the transaction-local `app.current_tenant_id` context required by future policies. The context is validated as a UUID, parameterized, scoped with `set_config(..., true)` and automatically cleared when the transaction ends. PostgreSQL tests prove an absent context reads no rows, a valid context sees only its tenant, and cross-tenant writes fail.
- Forced RLS protects `tenant_settings`, `tenant_legal_entities`, `tenant_bank_accounts`, `conversations`, `messages`, `webhook_events`, `instagram_customer_profiles`, `attachments`, `instagram_connections`, `instagram_oauth_states`, `instagram_credential_cleanups`, `instagram_avatar_cleanups`, `orders`, `order_items`, `order_commercial_terms` and `order_payments`. Every production read/write of these tables, including webhook retention/replay, provider binding, OAuth state consumption, credential cleanup, profile/avatar maintenance, media authorization, inbox reads, manual replies, webhook normalization, order creation/replay, dashboard aggregation, commercial-term selection, payment validation and nested order summaries, executes inside `withTenantTransaction`; absent context sees no rows and mismatched writes are rejected. Attachment ownership is derived through its protected parent message rather than duplicated on the attachment row.
- The commercial and order-financial slices demonstrate that a rollout must include indirect relation loads and raw reporting/filter queries, not only direct model calls. Order list/detail queries that hydrate legal entities, accounts, commercial terms or payments, plus payment-status filtering, are tenant-scoped transactions as well.
- The order-item slice also scopes procurement decisions, supplier dispatch/finalization, delivery preparation and Google Sheets exports. Cross-tenant procurement reconciliation first enumerates active tenant authorities, then performs a bounded query inside a separate tenant transaction for each authority; it never discovers protected order lines through an unscoped query.
- Platform administration receives order totals only through the explicit `platform_order_counts()` aggregate function. The function is security-invoker, returns tenant identifiers and counts but no order/customer fields, is executable only by the API runtime role, and establishes a transaction-local tenant context for each count. The worker role and `PUBLIC` have no access.
- Cross-tenant Instagram outbox, webhook recovery and profile refresh discovery use dedicated `worker_due_instagram_messages(...)`, `worker_due_instagram_events(...)` and `worker_due_instagram_profiles(...)` security-definer functions. Their inputs are bounded, their `search_path` is fixed, and their output is limited to tenant and durable record identifiers plus a technical event-recovery kind. `PUBLIC` and the API role cannot execute them. The worker must use the returned tenant authority to re-read protected content inside `withTenantTransaction`; the functions never return webhook payloads, customer messages, participant IDs, profile names, avatar URLs or attachment URLs. The older attachment-backfill function remains temporarily available for deployment compatibility but is no longer used by current workers.
- Instagram provider callbacks that do not yet know a tenant use API-only `api_instagram_tenant_for_account(...)` and `api_consume_instagram_oauth_state(...)` functions. Exact account lookup returns only `tenant_id`; OAuth consumption atomically marks a high-entropy state and returns only tenant/state IDs. User, redirect and credential fields are then read under that tenant context. The worker-only `worker_due_instagram_avatar_cleanups(...)` function returns a bounded set of tenant/cleanup IDs; object keys and cleanup state remain behind RLS. Opposite runtime roles and `PUBLIC` have no execute privilege on these authority surfaces.

## RLS rollout gate

RLS is enabled incrementally, table by table, only after all production call sites and relation loads for that table are routed through the tenant transaction primitive. The remaining gate is converting every other tenant-owned HTTP and background operation, followed by explicit bootstrap/discovery and platform-administration paths. Enabling all remaining policies before those call sites are converted would break legitimate work or encourage unsafe bypasses.

The rollout is complete only when role/grant migrations, request/worker tenant transaction context, platform-admin access paths, background reconciliation, backup/restore and integration tests are all proven together. Production data must be audited for tenant consistency before policies are forced.

## Performance strategy

Shared tables remain suitable while access paths start with `tenant_id` and use measured composite indexes. Cursor pagination is preferred for growing event/message histories; existing offset pagination for orders/catalogue must be replaced when measurements show deep-page degradation. Partitioning or tenant sharding is a later operational decision, triggered by measured table/index size, vacuum pressure, query latency or tenant-specific residency requirements—not by row count alone.

## Consequences

Benefits:

- migrations, backups and analytics remain operationally simple;
- database constraints contain cross-tenant damage from application defects;
- a later RLS layer can be added without changing the product data model;
- GDPR obligations can be fulfilled without database-per-customer infrastructure.

Trade-offs:

- a compromised API or worker credential can still reach unconverted tenant tables until their RLS slice is deployed, but protected tables fail closed and the runtime role cannot bypass RLS, own schema objects or perform DDL;
- full backups contain every tenant and require particularly strong encryption/access controls;
- tenant export and deletion need deliberate workflows across PostgreSQL, object storage, providers and backup expiry.

## References

- [`../operations/data-protection-and-retention.md`](../operations/data-protection-and-retention.md)
- [`../research/2026-09-28-eu-data-protection-retention-research.md`](../research/2026-09-28-eu-data-protection-retention-research.md)
- [`../superpowers/specs/2026-08-27-self-hosted-auth-design.md`](../superpowers/specs/2026-08-27-self-hosted-auth-design.md)

