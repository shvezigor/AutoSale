ALTER TABLE "catalogue_sources"
  ADD COLUMN "next_sync_at" TIMESTAMP(3),
  ADD COLUMN "sync_lease_id" UUID,
  ADD COLUMN "sync_lease_expires_at" TIMESTAMP(3),
  ADD COLUMN "sync_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "catalogue_import_runs"
  ADD COLUMN "source_headers" JSONB,
  ADD COLUMN "snapshot_object_key" TEXT,
  ADD COLUMN "source_sync_version" INTEGER;

CREATE INDEX "catalogue_sources_type_status_next_sync_at_id_idx"
  ON "catalogue_sources"("type", "status", "next_sync_at", "id");
