# Task 19 — Instagram customer profile and avatar report

## Delivered

- Added a successor-only migration, `20260902090000_instagram_customer_profiles`, without editing any historical migration. A profile is unique by `(tenant_id, participant_id)`, conversations reference it through a composite `(tenant_id, profile_id)` foreign key, and existing Instagram conversations are backfilled.
- Added durable profile state (`PENDING`, `PROCESSING`, `RETRYABLE_FAILURE`, `READY`, `UNAVAILABLE`) with attempts, due times, lease fencing, refresh versions, and last-success/error metadata.
- Incoming messages idempotently create/link one tenant-local profile. A worker reconciler promotes stale successful/unavailable profiles to a new version and redispatches due or expired-lease work with a stable profile/version job key. Message ingestion never waits for Meta.
- Added the official Instagram profile lookup for the messaging participant IGSID. It requests `name,username,profile_pic`, validates the path ID and response shape, and sends the access token only in the `Authorization: Bearer` header.
- Shared the existing AES-256-GCM credential format with the worker so the active tenant Instagram connection can be decrypted without changing stored tokens.
- Sanitized display names with Unicode NFKC normalization, control/format character removal, whitespace collapse, and a 100-code-point limit. Instagram usernames are normalized, validated, and limited to 30 characters.
- Preserved the previous good name/avatar on transient Meta or avatar failures. Non-transient profile unavailability remains refreshable; an unsafe avatar cannot replace a previous good cached avatar or persist its remote URL.
- Copied avatars into existing object storage using tenant/profile/content-addressed keys. Retrieval permits only HTTPS URLs on exact/subdomain Meta CDN allowlists, rejects credentials/custom ports/IP literals, rejects any private/reserved DNS answer, pins the selected public address for the TLS request, does not follow redirects, and enforces HTTP status, MIME allowlist, byte ceiling, and image magic bytes.
- Exposed avatars only through authenticated, manager-authorized, tenant-scoped `/api/media/instagram-profiles/:id/avatar` reads. List/detail responses contain a cache-busted local URL and never expose the Meta URL or storage key.
- Extended shared response contracts and OpenAPI schemas with nullable `participantUsername` and `participantAvatarUrl`. Conversation list/detail prefer the Meta name, then the username in the UI, and use `Клієнт Instagram` only when both are absent. Both surfaces render an accessible cached image or initials fallback.

## Source decisions

- Meta's official Instagram Messaging user-profile documentation and official Meta Postman collection define the lookup as `GET /{IGSID}?fields=name,username,profile_pic`, with the IGSID taken from `messages.sender.id`, and note that `profile_pic` URLs expire. The implementation therefore retains the controlled copy and refreshes profile metadata on a durable schedule.
- Existing local integration documentation requires Instagram Login credentials to remain encrypted and tenant-bound. The worker reads only the active, unexpired connection for the job tenant.

References:

- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile
- https://www.postman.com/meta/instagram/folder/23987686-22b3a5b0-4a51-449a-9299-e3667d69b182
- `docs/integrations/meta-access.md`
- `docs/integrations/meta-instagram-oauth.md`

## TDD evidence

The new contract, Meta client, worker config, shared cipher, profile persistence, avatar copy, enrichment, reconciler, API/media, and UI expectations were introduced as failing tests before their implementations. Observed RED failures included stripped contract fields, missing profile client/service modules, a missing profile table/client delegate, absent API fields/media route, and absent UI avatar/username behavior. Each focused suite was then brought to GREEN.

Coverage includes:

- name/username preference and no-data fallback;
- duplicate webhook/job delivery without duplicate tenant profile or duplicate object operation;
- changed-avatar refresh under a newer profile version;
- previous-good-data preservation after transient Meta failure;
- unsafe URL and mixed public/private DNS rebinding rejection;
- response size/type/signature enforcement;
- same participant ID isolation across tenants;
- tenant-scoped cached-avatar reads and OpenAPI/contract conformance.

## Verification

- `pnpm test` — GREEN: 8 workspace projects, 464 tests total.
- `pnpm typecheck` — GREEN: all 8 workspace projects.
- `pnpm exec prisma validate` — GREEN with Prisma 7.10.0.
- `pnpm generate` — GREEN with Prisma 7.10.0.
- Generated Prisma diff was reduced to semantic registry/relation/model changes plus the new `InstagramCustomerProfile` model; unrelated generated-model whitespace churn was excluded.
- `git diff --check` — GREEN.
- PostgreSQL/Testcontainers integration tests execute the successor migration and validate the profile workflow against PostgreSQL 17.6.

`prisma migrate diff` itself could not execute on this Windows host because Application Control blocks Prisma's checked-in `schema-engine-windows.exe` (`Program ... blocked by an Application Control policy`). Both `--from-empty` and migrations-to-schema attempts fail at the same engine launch boundary. This is an environment-policy limitation, not a schema parse or migration execution failure; Prisma validate/generate and all PostgreSQL migration-backed suites pass.

## Worktree preservation

Pre-existing webhook-reliability changes were preserved. `apps/worker/src/main.ts` is the only overlapping file: Task 19 imports, profile worker routing, its own queue/reconciler polling, startup, and shutdown hunks are staged separately; webhook event reconciliation hunks remain uncommitted. The pre-existing webhook report and event-reconciler files are not part of the Task 19 commit.
