CREATE TYPE "GoogleCredentialCleanupStatus" AS ENUM ('PENDING', 'FAILED', 'SUCCEEDED');

CREATE TABLE "google_credential_cleanups" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "credential_generation_id" UUID NOT NULL,
  "encrypted_refresh_token" TEXT NOT NULL,
  "status" "GoogleCredentialCleanupStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error_code" TEXT,
  "terminal_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "google_credential_cleanups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "google_credential_cleanups_credential_generation_id_key" ON "google_credential_cleanups"("credential_generation_id");
CREATE INDEX "google_credential_cleanups_tenant_id_terminal_at_idx" ON "google_credential_cleanups"("tenant_id", "terminal_at");
CREATE INDEX "google_credential_cleanups_status_updated_at_idx" ON "google_credential_cleanups"("status", "updated_at");
ALTER TABLE "google_credential_cleanups" ADD CONSTRAINT "google_credential_cleanups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
