CREATE FUNCTION public.platform_conversion_rollup(p_from date, p_to date)
RETURNS TABLE (metric text, locale text, plan_id text, total bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 89 THEN
    RAISE EXCEPTION 'INVALID_CONVERSION_REPORT_RANGE';
  END IF;

  RETURN QUERY
  WITH bounds AS (
    SELECT p_from::timestamp AS start_at, (p_to + 1)::timestamp AS end_at
  ),
  first_real_orders AS (
    SELECT o.tenant_id, MIN(o.approved_at) AS first_at
    FROM public.orders o
    JOIN public.conversations c ON c.id = o.conversation_id AND c.tenant_id = o.tenant_id
    WHERE o.status IN ('APPROVED', 'AUTO_APPROVED') AND o.approved_at IS NOT NULL
      AND c.external_conversation_id NOT LIKE 'demo-client-%'
    GROUP BY o.tenant_id
  ),
  registered_cohort AS (
    SELECT t.id, t.created_at
    FROM public.tenants t, bounds b
    WHERE t.created_at >= b.start_at AND t.created_at < b.end_at
  ),
  first_order_cohort AS (
    SELECT f.tenant_id, f.first_at
    FROM first_real_orders f, bounds b
    WHERE f.first_at >= b.start_at AND f.first_at < b.end_at
  ),
  server_metrics AS (
    SELECT 'account_registered'::text AS metric, COUNT(*) AS total FROM registered_cohort
    UNION ALL SELECT 'demo_intent', COUNT(*) FROM public.demo_leads d, bounds b
      WHERE d.created_at >= b.start_at AND d.created_at < b.end_at
    UNION ALL SELECT 'first_order_confirmed', COUNT(*) FROM first_order_cohort
    UNION ALL SELECT 'registration_cohort_first_order', COUNT(*) FROM registered_cohort r
      JOIN first_real_orders f ON f.tenant_id = r.id
      JOIN bounds b ON true WHERE f.first_at < b.end_at
    UNION ALL SELECT 'first_order_cohort_plan_interest', COUNT(*) FROM first_order_cohort f
      JOIN bounds b ON true
      WHERE EXISTS (SELECT 1 FROM public.tenant_plan_interests i
        WHERE i.tenant_id = f.tenant_id AND i.created_at >= f.first_at AND i.created_at < b.end_at)
    UNION ALL SELECT 'tenant_plan_interest', COUNT(DISTINCT i.tenant_id)
      FROM public.tenant_plan_interests i, bounds b
      WHERE i.created_at >= b.start_at AND i.created_at < b.end_at
  )
  SELECT m.event, m.locale, m.plan_id, SUM(m.count)::bigint
    FROM public.marketing_daily_counters m
    WHERE m.day BETWEEN p_from AND p_to
    GROUP BY m.event, m.locale, m.plan_id
  UNION ALL
  SELECT s.metric, 'all'::text, 'none'::text, s.total FROM server_metrics s;
END
$function$;

REVOKE ALL ON FUNCTION public.platform_conversion_rollup(date, date) FROM PUBLIC;
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
    GRANT EXECUTE ON FUNCTION public.platform_conversion_rollup(date, date) TO autosale_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
    REVOKE ALL ON FUNCTION public.platform_conversion_rollup(date, date) FROM autosale_worker;
  END IF;
END
$grants$;
