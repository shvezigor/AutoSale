CREATE TABLE "instagram_customer_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "participant_id" TEXT NOT NULL,
    "display_name" TEXT,
    "username" TEXT,
    "avatar_source_url" TEXT,
    "avatar_storage_key" TEXT,
    "avatar_checksum" TEXT,
    "avatar_content_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "refresh_version" INTEGER NOT NULL DEFAULT 1,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refresh_after" TIMESTAMP(3),
    "lease_id" UUID,
    "lease_expires_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "last_refreshed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "instagram_customer_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "instagram_customer_profiles_tenant_id_participant_id_key"
ON "instagram_customer_profiles"("tenant_id", "participant_id");

CREATE UNIQUE INDEX "instagram_customer_profiles_tenant_id_id_key"
ON "instagram_customer_profiles"("tenant_id", "id");

CREATE INDEX "instagram_customer_profiles_status_next_attempt_at_idx"
ON "instagram_customer_profiles"("status", "next_attempt_at");

CREATE INDEX "instagram_customer_profiles_status_refresh_after_idx"
ON "instagram_customer_profiles"("status", "refresh_after");

ALTER TABLE "instagram_customer_profiles"
ADD CONSTRAINT "instagram_customer_profiles_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversations" ADD COLUMN "profile_id" UUID;

INSERT INTO "instagram_customer_profiles" (
    "id", "tenant_id", "participant_id", "display_name", "status",
    "refresh_version", "attempts", "next_attempt_at", "created_at", "updated_at"
)
SELECT gen_random_uuid(), "tenant_id", "participant_id", MAX("display_name"), 'PENDING',
       1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "conversations"
WHERE "channel" = 'INSTAGRAM'
GROUP BY "tenant_id", "participant_id";

UPDATE "conversations" AS conversation
SET "profile_id" = profile."id"
FROM "instagram_customer_profiles" AS profile
WHERE profile."tenant_id" = conversation."tenant_id"
  AND profile."participant_id" = conversation."participant_id"
  AND conversation."channel" = 'INSTAGRAM';

ALTER TABLE "conversations"
ADD CONSTRAINT "conversations_tenant_id_profile_id_fkey"
FOREIGN KEY ("tenant_id", "profile_id")
REFERENCES "instagram_customer_profiles"("tenant_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
