ALTER TABLE "instagram_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "instagram_connections" FORCE ROW LEVEL SECURITY;

CREATE POLICY "instagram_connections_tenant_isolation" ON "instagram_connections"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

ALTER TABLE "instagram_oauth_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "instagram_oauth_states" FORCE ROW LEVEL SECURITY;

CREATE POLICY "instagram_oauth_states_tenant_isolation" ON "instagram_oauth_states"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

ALTER TABLE "instagram_credential_cleanups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "instagram_credential_cleanups" FORCE ROW LEVEL SECURITY;

CREATE POLICY "instagram_credential_cleanups_tenant_isolation" ON "instagram_credential_cleanups"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

ALTER TABLE "instagram_avatar_cleanups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "instagram_avatar_cleanups" FORCE ROW LEVEL SECURITY;

CREATE POLICY "instagram_avatar_cleanups_tenant_isolation" ON "instagram_avatar_cleanups"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- Provider callbacks know only the exact Instagram account identifier. This
-- function reveals its tenant authority and no credential or customer data.
CREATE FUNCTION public.api_instagram_tenant_for_account(p_external_account_id text)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT connection."tenant_id"
  FROM public."instagram_connections" AS connection
  WHERE connection."external_account_id" = p_external_account_id
  LIMIT 1;
$function$;

-- OAuth state is a 256-bit bearer secret. Consumption is atomic and returns
-- only the tenant and durable state identifiers; user and redirect data stay
-- behind tenant-scoped RLS.
CREATE FUNCTION public.api_consume_instagram_oauth_state(
  p_token_hash text,
  p_consumed_at timestamp with time zone
)
RETURNS TABLE (tenant_id uuid, state_id uuid)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  UPDATE public."instagram_oauth_states" AS state
  SET "used_at" = p_consumed_at
  WHERE state."token_hash" = p_token_hash
    AND state."used_at" IS NULL
    AND state."expires_at" > p_consumed_at
  RETURNING state."tenant_id", state."id";
$function$;

-- Cross-tenant cleanup discovery returns routing identifiers only. The worker
-- must claim and re-read the cleanup row inside the matching tenant context.
CREATE FUNCTION public.worker_due_instagram_avatar_cleanups(
  p_now timestamp with time zone,
  p_limit integer
)
RETURNS TABLE (tenant_id uuid, cleanup_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT cleanup."tenant_id", cleanup."id"
  FROM public."instagram_avatar_cleanups" AS cleanup
  WHERE (
    cleanup."status" IN ('PENDING', 'RETRYABLE_FAILURE')
    AND cleanup."next_attempt_at" <= p_now
  ) OR (
    cleanup."status" = 'PROCESSING'
    AND cleanup."lease_expires_at" <= p_now
  )
  ORDER BY cleanup."next_attempt_at", cleanup."id"
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 100);
$function$;

REVOKE ALL ON FUNCTION public.api_instagram_tenant_for_account(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_consume_instagram_oauth_state(text, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.worker_due_instagram_avatar_cleanups(timestamp with time zone, integer) FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
    GRANT EXECUTE ON FUNCTION public.api_instagram_tenant_for_account(text) TO autosale_api;
    GRANT EXECUTE ON FUNCTION public.api_consume_instagram_oauth_state(text, timestamp with time zone) TO autosale_api;
    REVOKE ALL ON FUNCTION public.worker_due_instagram_avatar_cleanups(timestamp with time zone, integer) FROM autosale_api;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
    REVOKE ALL ON FUNCTION public.api_instagram_tenant_for_account(text) FROM autosale_worker;
    REVOKE ALL ON FUNCTION public.api_consume_instagram_oauth_state(text, timestamp with time zone) FROM autosale_worker;
    GRANT EXECUTE ON FUNCTION public.worker_due_instagram_avatar_cleanups(timestamp with time zone, integer) TO autosale_worker;
  END IF;
END
$grants$;
