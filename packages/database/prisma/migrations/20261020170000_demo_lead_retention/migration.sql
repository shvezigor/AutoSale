CREATE FUNCTION public.worker_purge_expired_demo_leads(p_now timestamp with time zone, p_limit integer)
RETURNS TABLE (purged integer, busy integer)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  candidate record;
  purged_count integer := 0;
  busy_count integer := 0;
  utc_now timestamp := p_now AT TIME ZONE 'UTC';
BEGIN
  FOR candidate IN
    SELECT lead.id, lead.notification_lease_id, lead.notification_lease_expires_at
    FROM public.demo_leads AS lead
    WHERE LEAST(
      COALESCE(lead.last_operator_action_at, lead.created_at) + INTERVAL '180 days',
      lead.created_at + INTERVAL '365 days'
    ) <= utc_now
    ORDER BY lead.created_at, lead.id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 100)
    FOR UPDATE SKIP LOCKED
  LOOP
    IF candidate.notification_lease_id IS NOT NULL
      AND (candidate.notification_lease_expires_at IS NULL OR candidate.notification_lease_expires_at > utc_now) THEN
      busy_count := busy_count + 1;
      CONTINUE;
    END IF;

    DELETE FROM public.demo_leads WHERE id = candidate.id;
    INSERT INTO public.security_audit_logs (user_id, tenant_id, actor, action, result, metadata)
    VALUES (NULL, NULL, 'SYSTEM', 'DEMO_LEAD_RETENTION_PURGED', 'SUCCESS',
      jsonb_build_object('leadId', candidate.id, 'reason', 'RETENTION'));
    purged_count := purged_count + 1;
  END LOOP;
  RETURN QUERY SELECT purged_count, busy_count;
END
$function$;

REVOKE ALL ON FUNCTION public.worker_purge_expired_demo_leads(timestamp with time zone, integer) FROM PUBLIC;
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
    REVOKE ALL ON FUNCTION public.worker_purge_expired_demo_leads(timestamp with time zone, integer) FROM autosale_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
    GRANT EXECUTE ON FUNCTION public.worker_purge_expired_demo_leads(timestamp with time zone, integer) TO autosale_worker;
  END IF;
END
$grants$;
