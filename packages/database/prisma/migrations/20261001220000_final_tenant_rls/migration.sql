ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_tenant_isolation" ON "audit_logs"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "inventory_reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_reservations" FORCE ROW LEVEL SECURITY;

CREATE POLICY "inventory_reservations_tenant_isolation" ON "inventory_reservations"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "order_exports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_exports" FORCE ROW LEVEL SECURITY;

CREATE POLICY "order_exports_tenant_isolation" ON "order_exports"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "order_intent_evaluations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_intent_evaluations" FORCE ROW LEVEL SECURITY;

CREATE POLICY "order_intent_evaluations_tenant_isolation" ON "order_intent_evaluations"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE FUNCTION public.worker_due_order_exports(p_limit integer)
RETURNS TABLE (tenant_id uuid, export_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT export."tenant_id", export."id"
  FROM public."order_exports" AS export
  WHERE export."status" = 'PENDING'
  ORDER BY export."created_at", export."id"
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 50);
$function$;

REVOKE ALL ON FUNCTION public.worker_due_order_exports(integer) FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
    REVOKE ALL ON FUNCTION public.worker_due_order_exports(integer) FROM autosale_api;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
    GRANT EXECUTE ON FUNCTION public.worker_due_order_exports(integer) TO autosale_worker;
  END IF;
END
$grants$;
