# ADR 0002: Shared-schema tenant isolation and database defense in depth

- **Status:** Accepted; current tenant-owned tables are protected, lifecycle automation remains in progress
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
   - restricted read-only backup role with cross-tenant visibility;
   - owner/migrator credential only for explicitly confirmed one-shot restore.
8. RLS must fail closed when tenant context is absent. Platform administration must use explicit aggregate functions/views instead of silently bypassing tenant policy.

## Available controls

- Sessions bind a user, tenant and role and revalidate active user, tenant and membership state.
- Tenant-facing controllers pass the session-bound tenant to services.
- Provider webhooks derive tenant ownership from verified connection state.
- Composite tenant relations already protect delivery, inventory and several catalogue/payment paths.
- Migration `20260928224500_tenant_relation_guards` extends database protection to messages, orders, legal entities/accounts, commercial terms, Sheets exports and order audit logs.
- `tenant-relations.postgres.spec.ts` proves representative cross-tenant writes fail with PostgreSQL foreign-key violations.
- Deployments provision separate `autosale_api` and `autosale_worker` login roles after migrations. Both are non-owner, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION` and `NOBYPASSRLS`; neither can create or alter schema objects.
- Deployments also provision `autosale_backup`: a non-owner, read-only login with `BYPASSRLS`, required so a logical disaster-recovery dump includes every tenant. It has only database connect, schema usage and table/sequence read access; it cannot mutate data, perform DDL, execute application authority functions, assume runtime roles or use temporary objects. Its distinct credential is mounted only into the ephemeral backup tools container. Restore remains an explicitly confirmed, one-shot owner operation while runtime services are stopped.
- The owner connection remains available only to the one-shot migration and role-provisioning jobs. Application containers receive role-specific URLs and refuse to start when their distinct secrets are absent.
- `withTenantTransaction` provides the transaction-local `app.current_tenant_id` context required by future policies. The context is validated as a UUID, parameterized, scoped with `set_config(..., true)` and automatically cleared when the transaction ends. PostgreSQL tests prove an absent context reads no rows, a valid context sees only its tenant, and cross-tenant writes fail.
- Forced RLS protects every current public table that stores a `tenant_id`, including `audit_logs`, `inventory_reservations`, `order_exports` and `order_intent_evaluations`. Every production read/write of tenant-owned state, including team management, catalogue work, order intent evaluation, procurement reservations, order audit, delivery, Telegram, notifications and Sheets export, executes inside `withTenantTransaction`; absent context sees no rows and mismatched writes are rejected. Attachment ownership is derived through its protected parent message rather than duplicated on the attachment row.
- The commercial and order-financial slices demonstrate that a rollout must include indirect relation loads and raw reporting/filter queries, not only direct model calls. Order list/detail queries that hydrate legal entities, accounts, commercial terms or payments, plus payment-status filtering, are tenant-scoped transactions as well.
- The order-item slice also scopes procurement decisions, supplier dispatch/finalization, delivery preparation and Google Sheets exports. Cross-tenant procurement reconciliation first enumerates active tenant authorities, then performs a bounded query inside a separate tenant transaction for each authority; it never discovers protected order lines through an unscoped query.
- Platform administration receives order totals only through the explicit `platform_order_counts()` aggregate function. The function is security-invoker, returns tenant identifiers and counts but no order/customer fields, is executable only by the API runtime role, and establishes a transaction-local tenant context for each count. The worker role and `PUBLIC` have no access.
- Cross-tenant Instagram outbox, webhook recovery and profile refresh discovery use dedicated `worker_due_instagram_messages(...)`, `worker_due_instagram_events(...)` and `worker_due_instagram_profiles(...)` security-definer functions. Their inputs are bounded, their `search_path` is fixed, and their output is limited to tenant and durable record identifiers plus a technical event-recovery kind. `PUBLIC` and the API role cannot execute them. The worker must use the returned tenant authority to re-read protected content inside `withTenantTransaction`; the functions never return webhook payloads, customer messages, participant IDs, profile names, avatar URLs or attachment URLs. The older attachment-backfill function remains temporarily available for deployment compatibility but is no longer used by current workers.
- Instagram provider callbacks that do not yet know a tenant use API-only `api_instagram_tenant_for_account(...)` and `api_consume_instagram_oauth_state(...)` functions. Exact account lookup returns only `tenant_id`; OAuth consumption atomically marks a high-entropy state and returns only tenant/state IDs. User, redirect and credential fields are then read under that tenant context. The worker-only `worker_due_instagram_avatar_cleanups(...)` function returns a bounded set of tenant/cleanup IDs; object keys and cleanup state remain behind RLS. Opposite runtime roles and `PUBLIC` have no execute privilege on these authority surfaces.
- Google OAuth callbacks consume high-entropy state through API-only `api_consume_google_oauth_attempt(...)`, which atomically returns only tenant/attempt IDs before the bound user and redirect are read under RLS. API cleanup recovery uses bounded `api_due_google_credential_cleanups(...)` routing IDs and re-reads encrypted credential state under the returned tenant context. The worker role and `PUBLIC` cannot execute either function; ordinary Google worker jobs already carry authenticated tenant authority and do not receive cross-tenant discovery access.
- Scheduled catalogue synchronization and abandoned mapping recovery discover work only through worker-only `worker_due_catalogue_sources(...)` and `worker_due_catalogue_mapping_runs(...)`. Both functions have bounded inputs and fixed `search_path`, return only tenant and durable routing identifiers plus scheduling metadata, and expose neither catalogue rows nor customer/provider credentials. The worker re-reads every selected source or run inside the returned tenant context; the API role and `PUBLIC` cannot execute these functions.
- Delivery jobs remain limited to opaque shipment IDs. The worker-only `worker_delivery_tenants_for_shipments(...)` function resolves at most 50 IDs to tenant authority, while `worker_due_shipment_attempts(...)` and `worker_due_shipment_statuses(...)` expose only bounded tenant/shipment/version routing rows for reconciliation. All have fixed `search_path`; the API role and `PUBLIC` cannot execute them. The worker then re-reads connections, credentials, parcel snapshots, attempts and history inside the returned tenant context, and Ukrposhta batches are rejected when they span tenants.
- Telegram start callbacks atomically consume a purpose-bound high-entropy token through API-only `api_consume_telegram_link_attempt(...)`. Business callbacks use API-only exact authority lookup by active Telegram user or enabled business connection and fail closed when more than one tenant matches. The worker-only `worker_telegram_tenants_for_deliveries(...)` and `worker_due_telegram_deliveries(...)` functions return at most 50 tenant/delivery/purpose routing rows. Opposite runtime roles and `PUBLIC` cannot execute these functions; profile fields, rights, chat identifiers, destinations and message text stay behind tenant RLS.
- Authentication bootstraps tenant authority through API-only functions rather than bypassing RLS. `api_active_membership_for_user(...)` selects one deterministic active workspace; `api_invitation_authority(...)` reveals only tenant/invitation routing for a valid high-entropy token; and `api_resolve_session(...)` returns the minimum authenticated principal for an exact session hash while refreshing `last_seen_at`. Session issue/revocation and pending-owner activation are bounded mutations. The unscoped revocation shape changes no rows, worker and `PUBLIC` have no execute access, platform administration reads membership summaries only through `platform_tenant_directory()`, and full membership, invitation and session records remain tenant-protected.
- Notification retention discovers at most 1,000 expired opaque notification IDs through worker-only `worker_expired_user_notifications(...)`, groups them by returned tenant authority, and deletes each group inside its own tenant transaction. The API role and `PUBLIC` cannot execute the discovery function. Tenantless security events are accepted only through API-only `api_append_platform_security_audit_log(...)`, which verifies an active platform administrator and constrained actor/result/action/JSON metadata; tenant audit rows remain ordinary RLS-protected writes. Tenantless audit rows are never visible to either runtime role through direct table access.
- Google Sheets export polling discovers at most 50 pending opaque exports through worker-only `worker_due_order_exports(...)`. It returns only tenant and export IDs; the worker claims the row and reloads the order, destination and product snapshot inside that tenant transaction before contacting Google. The API role and `PUBLIC` cannot execute the directory function.

## RLS rollout gate

RLS was enabled incrementally, table by table, only after all production call sites and relation loads for that table were routed through the tenant transaction primitive. Every current public table with a `tenant_id` now has forced RLS. Any future tenant-owned table must ship its policy, tenant-scoped call paths and PostgreSQL isolation tests in the same change.

The database isolation rollout is complete for the current schema: role/grant migrations, request/worker tenant transaction context, explicit authority functions, a restricted backup identity and PostgreSQL integration tests are present. EU launch readiness still requires tenant export/deletion and retention automation, encrypted off-host backup storage and recurring production-like restore exercises.

## Performance strategy

Shared tables remain suitable while access paths start with `tenant_id` and use measured composite indexes. Cursor pagination is preferred for growing event/message histories; existing offset pagination for orders/catalogue must be replaced when measurements show deep-page degradation. Partitioning or tenant sharding is a later operational decision, triggered by measured table/index size, vacuum pressure, query latency or tenant-specific residency requirements—not by row count alone.

## Consequences

Benefits:

- migrations, backups and analytics remain operationally simple;
- database constraints contain cross-tenant damage from application defects;
- a later RLS layer can be added without changing the product data model;
- GDPR obligations can be fulfilled without database-per-customer infrastructure.

Trade-offs:

- a compromised API or worker credential remains constrained by forced RLS on current tenant-owned tables, but authority functions and future migrations still require careful least-privilege review;
- full backups contain every tenant and require particularly strong encryption/access controls;
- tenant export and deletion need deliberate workflows across PostgreSQL, object storage, providers and backup expiry.

## References

- [`../operations/data-protection-and-retention.md`](../operations/data-protection-and-retention.md)
- [`../research/2026-09-28-eu-data-protection-retention-research.md`](../research/2026-09-28-eu-data-protection-retention-research.md)
- [`../superpowers/specs/2026-08-27-self-hosted-auth-design.md`](../superpowers/specs/2026-08-27-self-hosted-auth-design.md)

