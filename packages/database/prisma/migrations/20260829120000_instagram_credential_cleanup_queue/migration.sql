CREATE TYPE "InstagramCredentialCleanupOperationStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "InstagramCredentialCleanupState" AS ENUM ('ARMED', 'REQUIRED', 'COMPLETED', 'CANCELLED', 'DEAD_LETTER');

ALTER TABLE "instagram_connections"
  ADD COLUMN "credential_generation_id" UUID;

UPDATE "instagram_connections"
SET "credential_generation_id" = gen_random_uuid()
WHERE "encrypted_access_token" IS NOT NULL;

CREATE UNIQUE INDEX "instagram_connections_credential_generation_id_key"
  ON "instagram_connections"("credential_generation_id");

CREATE TABLE "instagram_credential_cleanups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "credential_generation_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "encrypted_access_token" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'DISCONNECT',
    "state" "InstagramCredentialCleanupState" NOT NULL DEFAULT 'ARMED',
    "callback_resolved_at" TIMESTAMP(3),
    "unsubscribe_status" "InstagramCredentialCleanupOperationStatus" NOT NULL DEFAULT 'PENDING',
    "unsubscribe_attempted_at" TIMESTAMP(3),
    "unsubscribe_succeeded_at" TIMESTAMP(3),
    "revoke_status" "InstagramCredentialCleanupOperationStatus" NOT NULL DEFAULT 'PENDING',
    "revoke_attempted_at" TIMESTAMP(3),
    "revoke_succeeded_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_id" UUID,
    "lease_expires_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" TEXT,
    "permanent_failure_at" TIMESTAMP(3),
    "dead_lettered_at" TIMESTAMP(3),
    "dead_lettered_by_user_id" UUID,
    "terminal_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instagram_credential_cleanups_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "instagram_credential_cleanups_tenant_id_terminal_at_idx"
  ON "instagram_credential_cleanups"("tenant_id", "terminal_at");
CREATE INDEX "instagram_credential_cleanups_lease_expires_at_idx"
  ON "instagram_credential_cleanups"("lease_expires_at");
CREATE UNIQUE INDEX "instagram_credential_cleanups_credential_generation_id_key"
  ON "instagram_credential_cleanups"("credential_generation_id");

ALTER TABLE "instagram_credential_cleanups"
  ADD CONSTRAINT "instagram_credential_cleanups_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "instagram_credential_cleanups"
  ADD CONSTRAINT "instagram_credential_cleanups_dead_lettered_by_user_id_fkey"
  FOREIGN KEY ("dead_lettered_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "instagram_credential_cleanups" (
  "credential_generation_id",
  "tenant_id",
  "external_account_id",
  "encrypted_access_token",
  "source",
  "state",
  "callback_resolved_at",
  "unsubscribe_status",
  "revoke_status",
  "last_error_code"
)
SELECT
  "credential_generation_id",
  "tenant_id",
  "external_account_id",
  "encrypted_access_token",
  'MIGRATION_DISCONNECT',
  'REQUIRED'::"InstagramCredentialCleanupState",
  CURRENT_TIMESTAMP,
  'PENDING'::"InstagramCredentialCleanupOperationStatus",
  'PENDING'::"InstagramCredentialCleanupOperationStatus",
  CASE
    WHEN "last_error_code" = 'META_DISCONNECT_CLEANUP_FAILED'
      THEN 'META_DISCONNECT_CLEANUP_FAILED'
    ELSE NULL
  END
FROM "instagram_connections"
WHERE "status" = 'DISCONNECTED'
  AND "encrypted_access_token" IS NOT NULL;

UPDATE "instagram_connections"
SET
  "encrypted_access_token" = NULL,
  "token_expires_at" = NULL,
  "granted_scopes" = NULL,
  "last_error_code" = CASE
    WHEN "last_error_code" = 'META_DISCONNECT_CLEANUP_FAILED' THEN NULL
    ELSE "last_error_code"
  END
WHERE "status" = 'DISCONNECTED'
  AND "encrypted_access_token" IS NOT NULL;

-- A previously-cleared credential has no queue row to complete. Remove the
-- legacy failure marker in that case as well; it must not keep surfacing as a
-- current cleanup failure after this migration.
UPDATE "instagram_connections"
SET "last_error_code" = NULL
WHERE "status" = 'DISCONNECTED'
  AND "encrypted_access_token" IS NULL
  AND "last_error_code" = 'META_DISCONNECT_CLEANUP_FAILED';
