ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;

CREATE POLICY "orders_tenant_isolation" ON "orders"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

CREATE FUNCTION public.platform_order_counts()
RETURNS TABLE (tenant_id uuid, order_count bigint)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  current_tenant_id uuid;
BEGIN
  FOR current_tenant_id IN SELECT id FROM public.tenants LOOP
    PERFORM set_config('app.current_tenant_id', current_tenant_id::text, true);
    RETURN QUERY
      SELECT current_tenant_id, COUNT(*)
      FROM public.orders;
  END LOOP;
END
$function$;

REVOKE ALL ON FUNCTION public.platform_order_counts() FROM PUBLIC;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
    GRANT EXECUTE ON FUNCTION public.platform_order_counts() TO autosale_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
    REVOKE ALL ON FUNCTION public.platform_order_counts() FROM autosale_worker;
  END IF;
END
$grant$;
