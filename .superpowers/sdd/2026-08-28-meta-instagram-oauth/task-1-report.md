# Task 1 Report: Persist OAuth State and Encrypted Connection Metadata

## Status

DONE

## Changed files

- `packages/database/prisma/schema.prisma`
  - Added `InstagramConnectionStatus` with `LEGACY`, `ACTIVE`, `REAUTH_REQUIRED`, `ERROR`, and `DISCONNECTED`.
  - Added `InstagramOAuthState`, its token/expiry index, and inverse `Tenant`/`User` relations.
  - Extended `InstagramConnection` with nullable encrypted-token and operational metadata, the nullable connecting-user relation, and `LEGACY` as its default status.
  - Preserved the unique `externalAccountId` used by webhook routing.
- `packages/database/prisma/migrations/20260828_meta_instagram_oauth/migration.sql`
  - Added the enum, OAuth state table, indexes, and foreign keys.
  - Added nullable connection metadata columns.
  - Adds a new status column, maps every pre-existing connection to `LEGACY`, then replaces the old `AccessStatus`-backed status column. No connection rows or external account IDs are deleted.
- `packages/database/src/generated/prisma/**`
  - Regenerated Prisma Client, including the `InstagramOAuthState` model and new connection metadata/types.

## Decisions

- `grantedScopes` is a nullable text field so it follows the requirement that every OAuth metadata field remain nullable; the later OAuth orchestration can serialize the provider's granted-scope representation without inventing a non-null default for legacy records.
- `connectedByUserId` has a nullable relation with `ON DELETE SET NULL`, keeping an existing connection/audit-relevant record usable if its connecting user is removed.
- Tokens are represented only by `encryptedAccessToken`; this task neither stores raw tokens nor performs encryption/decryption.

## Migration generation

Attempted the required Prisma generation command:

```powershell
$env:PATH = 'C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
pnpm --filter @autosale/database exec prisma migrate dev --name meta_instagram_oauth --create-only
```

Result: failed before connecting because `DATABASE_URL` is not configured in this worktree (`PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL`). Per the task instruction, the migration was created manually from the schema diff. A Docker PostgreSQL container was running but is isolated on the Compose internal network and not safely available to the local Prisma command; no shared running database was changed.

## Verification

All commands below used the required Node runtime PATH. `DATABASE_URL=postgresql://autosale:autosale@127.0.0.1:5432/autosale` was supplied only for schema-only Prisma validation/generation; Prisma did not connect to that address.

| Command | Result |
| --- | --- |
| `pnpm --filter @autosale/database exec prisma validate` | PASS: schema valid |
| `pnpm --filter @autosale/database generate` | PASS: Prisma Client 7.10.0 regenerated |
| `pnpm --filter @autosale/database typecheck` | PASS |
| `pnpm --filter @autosale/database test` | PASS: no database test files, exits successfully with `--passWithNoTests` |
| `git diff --check -- packages/database/prisma` | PASS: no whitespace errors in handwritten schema/migration files |

## Self-review

- Confirmed generated client exposes `InstagramOAuthState`, `InstagramConnectionStatus`, and every required nullable connection field.
- Confirmed the unique external-account ID and existing tenant connection relation remain in place for webhook routing.
- Confirmed migration preserves old rows and assigns their new status to `LEGACY` before dropping the old status column.
- Confirmed OAuth state has a unique hash, cascading tenant/user foreign keys, safe default return path, and the required `(expiresAt, usedAt)` index.
- Confirmed no authorization code, access token plaintext, decrypted credential, or Meta secret appears in the schema or migration.

## Commit

`e9783d5dcdd40ffe0503c3aa37d4665dd0a36df4` — `feat: persist Instagram OAuth credentials`

## Concerns

- None. The manual migration has now been executed and verified against an isolated PostgreSQL 17.6 database containing the full prior schema and a legacy Instagram connection row.

## Fix round 1

An isolated disposable PostgreSQL 17.6 container named `autosale-oauth-migration-check` was started on `127.0.0.1:55432`, then stopped and automatically removed after verification. No shared development or production database was changed.

### Migration execution

```powershell
docker run --detach --rm --name autosale-oauth-migration-check --env POSTGRES_DB=autosale_check --env POSTGRES_USER=autosale_check --env POSTGRES_PASSWORD=autosale_check --publish 127.0.0.1:55432:5432 postgres:17.6-alpine

# Applied every migration before 20260828_meta_instagram_oauth in lexical order.
Get-ChildItem packages/database/prisma/migrations -Directory |
  Where-Object { $_.Name -lt '20260828_meta_instagram_oauth' } |
  Sort-Object Name |
  ForEach-Object { Get-Content -Raw "$($_.FullName)/migration.sql" | docker exec -i autosale-oauth-migration-check psql -q -v ON_ERROR_STOP=1 -U autosale_check -d autosale_check }

# Inserted one tenant, one user, and one pre-OAuth Instagram connection with
# external_account_id 17841400000000000 and AccessStatus ACTIVE.
Get-Content -Raw packages/database/prisma/migrations/20260828_meta_instagram_oauth/migration.sql |
  docker exec -i autosale-oauth-migration-check psql -v ON_ERROR_STOP=1 -U autosale_check -d autosale_check
```

Result: PASS. The migration completed with `UPDATE 1`, proving that it mapped the seeded legacy row before replacing its old status column.

### Post-migration assertions

```text
id                                    external_account_id   status  all seven new metadata columns
33333333-3333-4333-8333-333333333333  17841400000000000    LEGACY  NULL
```

The inserted OAuth state received `return_path = /settings` and `used_at = NULL`. A duplicate `token_hash` was rejected by `instagram_oauth_states_token_hash_key`; an OAuth state with a nonexistent tenant was rejected by `instagram_oauth_states_tenant_id_fkey`.

### Repeated validation

With `DATABASE_URL=postgresql://autosale_check:autosale_check@127.0.0.1:55432/autosale_check` and the required Node runtime PATH:

| Command | Result |
| --- | --- |
| `pnpm --filter @autosale/database exec prisma validate` | PASS |
| `pnpm --filter @autosale/database generate` | PASS |
| `pnpm --filter @autosale/database typecheck` | PASS |
| `pnpm --filter @autosale/database test` | PASS (no test files; `--passWithNoTests`) |
