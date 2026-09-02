# Task 19 review fixes — round 1

## Findings resolved

### 1. Retry dispatch survives retained BullMQ jobs

The profile reconciler job ID now includes the durable attempt count and due timestamp in addition to the profile ID and refresh version. Repeated reconciliation of the same durable state remains idempotent, while a transient failure or expired processing lease receives a new attempt identity after the database state advances. The database claim fence remains the authority that prevents concurrent duplicate profile work.

Regression coverage executes the reported sequence against PostgreSQL: the first Meta lookup fails transiently, BullMQ's immediate retry is skipped before `nextAttemptAt`, the five-minute reconciler creates a distinct retained job, and that job successfully claims and refreshes the same profile version.

### 2. Cached avatars have a durable object lifecycle

Successor migration `20260902130000_instagram_avatar_cleanup` adds a durable avatar-cleanup table and database triggers. An old object key is inserted only by the committed profile-key replacement/removal, so rollback cannot delete the currently referenced object. The cleanup table deliberately has no tenant foreign key: cleanup work must survive a tenant cascade. Disconnect transitions clear cached avatar references and enqueue their old keys.

The worker's leased cleanup reconciler:

- rechecks all current profile references before deletion;
- marks a re-referenced key complete without deleting it;
- retries storage failures after five minutes;
- fences state updates by cleanup row and lease;
- treats successful cleanup as terminal, preventing replay.

When a copied avatar loses the final profile-write fence, the enrichment transaction records that never-referenced object as cleanup work. Tests cover replacement, removed `profile_pic`, transient delete failure and later retry, successful replay, key reuse, disconnect, tenant deletion with a linked conversation, and the lost-fence orphan path.

### 3. Current Meta identity outranks legacy backfill

List and detail responses use the current profile name when present. When the current profile has only a username, the legacy conversation display name is suppressed so the UI renders `@username`. The legacy name is used only when there is no profile or the current profile has neither a name nor a username. API integration coverage exercises both list and detail; the web contract test covers the username display path.

## TDD evidence

- Retry job-key test failed with the retained `instagram-profile:<id>:v<version>` ID before the due-attempt identity was implemented.
- List/detail integration tests failed by returning `Застаріле ім’я` before the profile-aware fallback was implemented.
- Avatar cleanup suite initially failed because the durable reconciler did not exist, then exercised the successor migration and real PostgreSQL state transitions.

## Verification

- Focused worker/API/web suites: 7 files, 29 tests passed.
- `pnpm test`: all 8 workspace project test commands passed.
- `pnpm typecheck`: all 8 workspace project type checks passed.
- `pnpm --filter @autosale/database exec prisma validate`: schema valid with Prisma 7.10.0.
- `pnpm --filter @autosale/database generate`: client generated with Prisma 7.10.0.
- Generated output was reduced to the new model and the semantic client registry/type-map changes.
- `git diff --check`: passed.

## Worktree preservation

The pre-existing webhook-reliability changes remain uncommitted. `apps/worker/src/main.ts` overlaps both workstreams; only the avatar cleanup import, construction, polling, and metric hunks belong to this fix commit. The webhook event reconciler import, queue, timer, startup, and shutdown hunks remain outside the commit.
