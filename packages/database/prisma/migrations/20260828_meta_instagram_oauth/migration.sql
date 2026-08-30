-- CreateEnum
CREATE TYPE "InstagramConnectionStatus" AS ENUM ('LEGACY', 'ACTIVE', 'REAUTH_REQUIRED', 'ERROR', 'DISCONNECTED');

-- CreateTable
CREATE TABLE "instagram_oauth_states" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "return_path" TEXT NOT NULL DEFAULT '/settings',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instagram_oauth_states_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "instagram_connections"
    ADD COLUMN "encrypted_access_token" TEXT,
    ADD COLUMN "token_expires_at" TIMESTAMP(3),
    ADD COLUMN "granted_scopes" TEXT,
    ADD COLUMN "last_verified_at" TIMESTAMP(3),
    ADD COLUMN "last_error_code" TEXT,
    ADD COLUMN "connected_by_user_id" UUID,
    ADD COLUMN "disconnected_at" TIMESTAMP(3),
    ADD COLUMN "status_next" "InstagramConnectionStatus" NOT NULL DEFAULT 'LEGACY';

-- Existing connections were configured without OAuth credentials. Preserve their
-- account IDs for webhook routing, but make their legacy state explicit before
-- removing the prior AccessStatus-backed column.
UPDATE "instagram_connections" SET "status_next" = 'LEGACY';

ALTER TABLE "instagram_connections" DROP COLUMN "status";
ALTER TABLE "instagram_connections" RENAME COLUMN "status_next" TO "status";

-- CreateIndex
CREATE UNIQUE INDEX "instagram_oauth_states_token_hash_key" ON "instagram_oauth_states"("token_hash");
CREATE INDEX "instagram_oauth_states_expires_at_used_at_idx" ON "instagram_oauth_states"("expires_at", "used_at");
CREATE INDEX "instagram_connections_status_idx" ON "instagram_connections"("status");

-- AddForeignKey
ALTER TABLE "instagram_oauth_states" ADD CONSTRAINT "instagram_oauth_states_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "instagram_oauth_states" ADD CONSTRAINT "instagram_oauth_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "instagram_connections" ADD CONSTRAINT "instagram_connections_connected_by_user_id_fkey" FOREIGN KEY ("connected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
