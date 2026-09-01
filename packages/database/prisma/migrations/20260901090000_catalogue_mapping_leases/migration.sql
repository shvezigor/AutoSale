ALTER TABLE "catalogue_import_runs"
  ADD COLUMN "mapping_lease_id" UUID,
  ADD COLUMN "mapping_lease_expires_at" TIMESTAMPTZ;

-- A pre-lease worker can still be running when this migration is deployed.
-- Fence its unowned MAPPING rows into the already-safe manual review path so
-- neither it nor a new token claimant can complete an ambiguous assignment.
UPDATE "catalogue_import_runs"
SET
  "status" = 'MAPPING_REVIEW',
  "mapping_id" = NULL,
  "mapping_lease_id" = NULL,
  "mapping_lease_expires_at" = NULL,
  "row_errors" = '[{"errors":["MAPPING_UPGRADE_RECOVERY"]}]'::jsonb,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "status" = 'MAPPING'
  AND "mapping_lease_id" IS NULL;

CREATE INDEX "catalogue_import_runs_status_mapping_lease_expires_at_idx"
  ON "catalogue_import_runs"("status", "mapping_lease_expires_at");
