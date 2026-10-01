ALTER TABLE "user_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_notifications" FORCE ROW LEVEL SECURITY;

CREATE POLICY "user_notifications_tenant_isolation" ON "user_notifications"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "security_audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "security_audit_logs" FORCE ROW LEVEL SECURITY;

CREATE POLICY "security_audit_logs_tenant_isolation" ON "security_audit_logs"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE FUNCTION public.worker_expired_user_notifications(
  p_cutoff timestamp with time zone,
  p_limit integer
)
RETURNS TABLE (tenant_id uuid, notification_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT notification."tenant_id", notification."id"
  FROM public."user_notifications" AS notification
  WHERE notification."created_at" < p_cutoff
  ORDER BY notification."created_at", notification."id"
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 1000);
$function$;

CREATE FUNCTION public.api_append_platform_security_audit_log(
  p_user_id uuid,
  p_actor text,
  p_action text,
  p_result text,
  p_metadata jsonb
)
RETURNS TABLE (audit_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public."users" AS app_user
    WHERE app_user."id" = p_user_id
      AND app_user."status"::text = 'ACTIVE'
      AND app_user."platform_role"::text = 'PLATFORM_ADMIN'
  ) OR p_actor NOT IN ('USER', 'SYSTEM')
    OR p_result NOT IN ('SUCCESS', 'FAILURE')
    OR p_action !~ '^[A-Z][A-Z0-9_]{0,127}$'
    OR jsonb_typeof(COALESCE(p_metadata, '{}'::jsonb)) <> 'object'
  THEN
    RETURN;
  END IF;

  RETURN QUERY
  INSERT INTO public."security_audit_logs" (
    "user_id", "tenant_id", "actor", "action", "result", "metadata"
  ) VALUES (
    p_user_id, NULL, p_actor, p_action, p_result, COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING "id";
END
$function$;

REVOKE ALL ON FUNCTION public.worker_expired_user_notifications(timestamp with time zone, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_append_platform_security_audit_log(uuid, text, text, text, jsonb) FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
    REVOKE ALL ON FUNCTION public.worker_expired_user_notifications(timestamp with time zone, integer) FROM autosale_api;
    GRANT EXECUTE ON FUNCTION public.api_append_platform_security_audit_log(uuid, text, text, text, jsonb) TO autosale_api;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
    GRANT EXECUTE ON FUNCTION public.worker_expired_user_notifications(timestamp with time zone, integer) TO autosale_worker;
    REVOKE ALL ON FUNCTION public.api_append_platform_security_audit_log(uuid, text, text, text, jsonb) FROM autosale_worker;
  END IF;
END
$grants$;
