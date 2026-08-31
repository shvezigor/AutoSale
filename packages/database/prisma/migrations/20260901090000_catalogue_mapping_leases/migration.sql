ALTER TABLE "catalogue_import_runs"
  ADD COLUMN "mapping_lease_id" UUID,
  ADD COLUMN "mapping_lease_expires_at" TIMESTAMPTZ;

CREATE INDEX "catalogue_import_runs_status_mapping_lease_expires_at_idx"
  ON "catalogue_import_runs"("status", "mapping_lease_expires_at");
