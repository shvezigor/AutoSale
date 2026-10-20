CREATE FUNCTION public.worker_purge_conversion_data(p_now timestamp with time zone, p_limit integer)
RETURNS TABLE (interests_deleted integer, counters_deleted integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF p_now IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'INVALID_CONVERSION_PURGE_INPUT';
  END IF;

  WITH candidates AS (
    SELECT id FROM public.tenant_plan_interests
    WHERE created_at < p_now - INTERVAL '90 days'
    ORDER BY created_at, id LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public.tenant_plan_interests i USING candidates c
    WHERE i.id = c.id RETURNING i.id
  ) SELECT COUNT(*)::integer INTO interests_deleted FROM deleted;

  WITH candidates AS (
    SELECT day, event, locale, plan_id FROM public.marketing_daily_counters
    WHERE day < (p_now AT TIME ZONE 'UTC')::date - INTERVAL '13 months'
    ORDER BY day, event, locale, plan_id LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public.marketing_daily_counters m USING candidates c
    WHERE m.day = c.day AND m.event = c.event AND m.locale = c.locale AND m.plan_id = c.plan_id
    RETURNING m.day
  ) SELECT COUNT(*)::integer INTO counters_deleted FROM deleted;

  RETURN NEXT;
END
$function$;

REVOKE ALL ON FUNCTION public.worker_purge_conversion_data(timestamp with time zone, integer) FROM PUBLIC;
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
    GRANT EXECUTE ON FUNCTION public.worker_purge_conversion_data(timestamp with time zone, integer) TO autosale_worker;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
    REVOKE ALL ON FUNCTION public.worker_purge_conversion_data(timestamp with time zone, integer) FROM autosale_api;
  END IF;
END
$grants$;
