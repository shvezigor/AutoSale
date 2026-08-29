CREATE TYPE "InstagramCredentialCleanupOperationStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "instagram_credential_cleanups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "encrypted_access_token" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'DISCONNECT',
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
    "terminal_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instagram_credential_cleanups_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "instagram_credential_cleanups_tenant_id_terminal_at_idx"
  ON "instagram_credential_cleanups"("tenant_id", "terminal_at");
CREATE INDEX "instagram_credential_cleanups_lease_expires_at_idx"
  ON "instagram_credential_cleanups"("lease_expires_at");

ALTER TABLE "instagram_credential_cleanups"
  ADD CONSTRAINT "instagram_credential_cleanups_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "instagram_credential_cleanups" (
  "tenant_id",
  "external_account_id",
  "encrypted_access_token",
  "source",
  "unsubscribe_status",
  "revoke_status",
  "last_error_code"
)
SELECT
  "tenant_id",
  "external_account_id",
  "encrypted_access_token",
  'DISCONNECT',
  CASE
    WHEN "last_error_code" = 'META_DISCONNECT_CLEANUP_FAILED'
      THEN 'FAILED'::"InstagramCredentialCleanupOperationStatus"
    ELSE 'PENDING'::"InstagramCredentialCleanupOperationStatus"
  END,
  CASE
    WHEN "last_error_code" = 'META_DISCONNECT_CLEANUP_FAILED'
      THEN 'FAILED'::"InstagramCredentialCleanupOperationStatus"
    ELSE 'PENDING'::"InstagramCredentialCleanupOperationStatus"
  END,
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
  "granted_scopes" = NULL
WHERE "status" = 'DISCONNECTED'
  AND "encrypted_access_token" IS NOT NULL;
