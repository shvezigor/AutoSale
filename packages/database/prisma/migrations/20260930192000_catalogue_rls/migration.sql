ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;

CREATE POLICY "products_tenant_isolation" ON "products"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

ALTER TABLE "catalogue_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalogue_sources" FORCE ROW LEVEL SECURITY;

CREATE POLICY "catalogue_sources_tenant_isolation" ON "catalogue_sources"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

ALTER TABLE "catalogue_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalogue_mappings" FORCE ROW LEVEL SECURITY;

CREATE POLICY "catalogue_mappings_tenant_isolation" ON "catalogue_mappings"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

ALTER TABLE "catalogue_import_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalogue_import_runs" FORCE ROW LEVEL SECURITY;

CREATE POLICY "catalogue_import_runs_tenant_isolation" ON "catalogue_import_runs"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- Cross-tenant scheduling receives routing IDs and technical cadence only.
-- Product values, source configuration and import payloads remain behind RLS.
CREATE FUNCTION public.worker_due_catalogue_sources(
  p_now timestamp with time zone,
  p_after_id uuid,
  p_limit integer
)
RETURNS TABLE (tenant_id uuid, source_id uuid, sync_schedule text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT source."tenant_id", source."id", source."sync_schedule"
  FROM public."catalogue_sources" AS source
  WHERE source."type" = 'GOOGLE_SHEETS'
    AND source."status" = 'ACTIVE'
    AND source."sync_schedule" IN ('HOURLY', 'DAILY')
    AND source."next_sync_at" <= p_now
    AND (p_after_id IS NULL OR source."id" > p_after_id)
  ORDER BY source."id"
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 100);
$function$;

-- Mapping reconciliation receives only authority and durable routing IDs.
CREATE FUNCTION public.worker_due_catalogue_mapping_runs(
  p_now timestamp with time zone,
  p_limit integer
)
RETURNS TABLE (tenant_id uuid, run_id uuid, updated_at timestamp with time zone)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT run."tenant_id", run."id", run."updated_at"
  FROM public."catalogue_import_runs" AS run
  WHERE run."status" = 'UPLOADED'
    OR (
      run."status" = 'MAPPING'
      AND run."mapping_lease_id" IS NOT NULL
      AND run."mapping_lease_expires_at" < p_now
    )
  ORDER BY run."updated_at", run."id"
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 100);
$function$;

REVOKE ALL ON FUNCTION public.worker_due_catalogue_sources(timestamp with time zone, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.worker_due_catalogue_mapping_runs(timestamp with time zone, integer) FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
    GRANT EXECUTE ON FUNCTION public.worker_due_catalogue_sources(timestamp with time zone, uuid, integer) TO autosale_worker;
    GRANT EXECUTE ON FUNCTION public.worker_due_catalogue_mapping_runs(timestamp with time zone, integer) TO autosale_worker;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
    REVOKE ALL ON FUNCTION public.worker_due_catalogue_sources(timestamp with time zone, uuid, integer) FROM autosale_api;
    REVOKE ALL ON FUNCTION public.worker_due_catalogue_mapping_runs(timestamp with time zone, integer) FROM autosale_api;
  END IF;
END
$grants$;
