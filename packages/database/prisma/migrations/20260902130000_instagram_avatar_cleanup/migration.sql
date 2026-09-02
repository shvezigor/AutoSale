CREATE TABLE "instagram_avatar_cleanups" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_id" UUID,
    "lease_expires_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "instagram_avatar_cleanups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "instagram_avatar_cleanups_storage_key_key"
ON "instagram_avatar_cleanups"("storage_key");

CREATE INDEX "instagram_avatar_cleanups_status_next_attempt_at_idx"
ON "instagram_avatar_cleanups"("status", "next_attempt_at");

CREATE FUNCTION enqueue_instagram_avatar_cleanup()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.avatar_storage_key IS NOT NULL
     AND (TG_OP = 'DELETE' OR OLD.avatar_storage_key IS DISTINCT FROM NEW.avatar_storage_key) THEN
    INSERT INTO "instagram_avatar_cleanups" (
      "id", "tenant_id", "storage_key", "status", "attempts", "next_attempt_at", "created_at", "updated_at"
    ) VALUES (
      gen_random_uuid(), OLD.tenant_id, OLD.avatar_storage_key, 'PENDING', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("storage_key") DO UPDATE SET
      "tenant_id" = EXCLUDED."tenant_id",
      "status" = 'PENDING',
      "attempts" = 0,
      "next_attempt_at" = CURRENT_TIMESTAMP,
      "lease_id" = NULL,
      "lease_expires_at" = NULL,
      "last_error_code" = NULL,
      "updated_at" = CURRENT_TIMESTAMP;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER instagram_customer_profile_avatar_cleanup
AFTER UPDATE OF "avatar_storage_key" OR DELETE ON "instagram_customer_profiles"
FOR EACH ROW EXECUTE FUNCTION enqueue_instagram_avatar_cleanup();

CREATE FUNCTION clear_instagram_avatars_on_disconnect()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'DISCONNECTED' AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE "instagram_customer_profiles"
    SET "avatar_source_url" = NULL,
        "avatar_storage_key" = NULL,
        "avatar_checksum" = NULL,
        "avatar_content_type" = NULL,
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "tenant_id" = NEW.tenant_id
      AND "avatar_storage_key" IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER instagram_connection_avatar_cleanup
AFTER UPDATE OF "status" ON "instagram_connections"
FOR EACH ROW EXECUTE FUNCTION clear_instagram_avatars_on_disconnect();
