-- Do not infer ownership from an unrelated source or mapping. Existing invalid
-- references require an operator to choose the correct tenant-local record (or
-- clear optional provenance) before this migration can enforce the boundary.
DO $$
DECLARE
  invalid_product_sources INTEGER;
  invalid_mapping_sources INTEGER;
  invalid_import_sources INTEGER;
  invalid_import_mappings INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_product_sources
  FROM "products" product
  WHERE product."source_id" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "catalogue_sources" source
      WHERE source."id" = product."source_id"
        AND source."tenant_id" = product."tenant_id"
    );

  SELECT COUNT(*) INTO invalid_mapping_sources
  FROM "catalogue_mappings" mapping
  WHERE NOT EXISTS (
    SELECT 1 FROM "catalogue_sources" source
    WHERE source."id" = mapping."source_id"
      AND source."tenant_id" = mapping."tenant_id"
  );

  SELECT COUNT(*) INTO invalid_import_sources
  FROM "catalogue_import_runs" import_run
  WHERE NOT EXISTS (
    SELECT 1 FROM "catalogue_sources" source
    WHERE source."id" = import_run."source_id"
      AND source."tenant_id" = import_run."tenant_id"
  );

  SELECT COUNT(*) INTO invalid_import_mappings
  FROM "catalogue_import_runs" import_run
  WHERE import_run."mapping_id" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "catalogue_mappings" mapping
      WHERE mapping."id" = import_run."mapping_id"
        AND mapping."tenant_id" = import_run."tenant_id"
    );

  IF invalid_product_sources > 0
    OR invalid_mapping_sources > 0
    OR invalid_import_sources > 0
    OR invalid_import_mappings > 0 THEN
    RAISE EXCEPTION 'Catalogue tenant relation remediation required before migration'
      USING DETAIL = format(
        'product_sources=%s, mapping_sources=%s, import_sources=%s, import_mappings=%s',
        invalid_product_sources,
        invalid_mapping_sources,
        invalid_import_sources,
        invalid_import_mappings
      ),
      HINT = 'Set product source_id to NULL or a same-tenant source; correct or retire invalid mappings/import sources after tenant review; clear optional import mapping_id or assign a same-tenant mapping, then retry.';
  END IF;
END $$;

ALTER TABLE "catalogue_mappings"
  DROP CONSTRAINT "catalogue_mappings_source_id_fkey";

ALTER TABLE "catalogue_import_runs"
  DROP CONSTRAINT "catalogue_import_runs_source_id_fkey",
  DROP CONSTRAINT "catalogue_import_runs_mapping_id_fkey";

ALTER TABLE "products"
  DROP CONSTRAINT "products_source_id_fkey";

ALTER TABLE "catalogue_sources"
  ADD CONSTRAINT "catalogue_sources_tenant_id_id_key" UNIQUE ("tenant_id", "id");

ALTER TABLE "catalogue_mappings"
  ADD CONSTRAINT "catalogue_mappings_tenant_id_id_key" UNIQUE ("tenant_id", "id");

ALTER TABLE "catalogue_mappings"
  ADD CONSTRAINT "catalogue_mappings_tenant_id_source_id_fkey"
  FOREIGN KEY ("tenant_id", "source_id") REFERENCES "catalogue_sources"("tenant_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "catalogue_import_runs"
  ADD CONSTRAINT "catalogue_import_runs_tenant_id_source_id_fkey"
  FOREIGN KEY ("tenant_id", "source_id") REFERENCES "catalogue_sources"("tenant_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "catalogue_import_runs_tenant_id_mapping_id_fkey"
  FOREIGN KEY ("tenant_id", "mapping_id") REFERENCES "catalogue_mappings"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "products"
  ADD CONSTRAINT "products_tenant_id_source_id_fkey"
  FOREIGN KEY ("tenant_id", "source_id") REFERENCES "catalogue_sources"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
