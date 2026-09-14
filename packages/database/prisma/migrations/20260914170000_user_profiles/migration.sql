ALTER TABLE "users"
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'uk',
  ADD COLUMN "avatar_storage_key" TEXT,
  ADD COLUMN "avatar_checksum" TEXT,
  ADD COLUMN "avatar_content_type" TEXT,
  ADD COLUMN "last_login_at" TIMESTAMP(3),
  ADD CONSTRAINT "users_locale_check" CHECK ("locale" IN ('uk', 'en')),
  ADD CONSTRAINT "users_phone_check" CHECK ("phone" IS NULL OR "phone" ~ '^[+][1-9][0-9]{7,14}$');

CREATE TABLE "user_avatar_cleanups" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "storage_key" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_until" TIMESTAMP(3),
  "last_error_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_avatar_cleanups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_avatar_cleanups_attempts_check" CHECK ("attempts" >= 0)
);

CREATE UNIQUE INDEX "user_avatar_cleanups_storage_key_key"
  ON "user_avatar_cleanups"("storage_key");
CREATE INDEX "user_avatar_cleanups_status_next_attempt_at_idx"
  ON "user_avatar_cleanups"("status", "next_attempt_at");

ALTER TABLE "user_avatar_cleanups" ADD CONSTRAINT "user_avatar_cleanups_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
