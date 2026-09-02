CREATE TYPE "GoogleConnectionStatus" AS ENUM ('ACTIVE', 'REAUTHORIZATION_REQUIRED', 'DISCONNECTING', 'ERROR', 'DISCONNECTED');

CREATE TABLE "google_connections" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "google_subject" TEXT NOT NULL,
  "account_email" TEXT,
  "status" "GoogleConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
  "encrypted_refresh_token" TEXT,
  "credential_generation_id" UUID,
  "granted_scopes" TEXT,
  "connected_by_user_id" UUID,
  "last_verified_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "disconnected_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "google_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "google_oauth_attempts" (
  "id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "return_path" TEXT NOT NULL DEFAULT '/settings',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "google_oauth_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "google_connections_tenant_id_key" ON "google_connections"("tenant_id");
CREATE UNIQUE INDEX "google_connections_credential_generation_id_key" ON "google_connections"("credential_generation_id");
CREATE INDEX "google_connections_status_idx" ON "google_connections"("status");
CREATE INDEX "google_connections_google_subject_idx" ON "google_connections"("google_subject");
CREATE UNIQUE INDEX "google_oauth_attempts_token_hash_key" ON "google_oauth_attempts"("token_hash");
CREATE INDEX "google_oauth_attempts_tenant_id_used_at_idx" ON "google_oauth_attempts"("tenant_id", "used_at");
CREATE INDEX "google_oauth_attempts_expires_at_used_at_idx" ON "google_oauth_attempts"("expires_at", "used_at");

ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_connected_by_user_id_fkey" FOREIGN KEY ("connected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "google_oauth_attempts" ADD CONSTRAINT "google_oauth_attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "google_oauth_attempts" ADD CONSTRAINT "google_oauth_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
