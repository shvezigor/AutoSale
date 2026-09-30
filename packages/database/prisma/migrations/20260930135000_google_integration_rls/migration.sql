ALTER TABLE "google_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "google_connections" FORCE ROW LEVEL SECURITY;

CREATE POLICY "google_connections_tenant_isolation" ON "google_connections"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

ALTER TABLE "google_oauth_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "google_oauth_attempts" FORCE ROW LEVEL SECURITY;

CREATE POLICY "google_oauth_attempts_tenant_isolation" ON "google_oauth_attempts"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

ALTER TABLE "google_credential_cleanups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "google_credential_cleanups" FORCE ROW LEVEL SECURITY;

CREATE POLICY "google_credential_cleanups_tenant_isolation" ON "google_credential_cleanups"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

ALTER TABLE "google_sheets_destinations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "google_sheets_destinations" FORCE ROW LEVEL SECURITY;

CREATE POLICY "google_sheets_destinations_tenant_isolation" ON "google_sheets_destinations"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- OAuth state is a 256-bit bearer secret. Consumption is atomic and exposes
-- only routing identifiers; user and redirect data remain behind tenant RLS.
CREATE FUNCTION public.api_consume_google_oauth_attempt(
  p_token_hash text,
  p_consumed_at timestamp with time zone
)
RETURNS TABLE (tenant_id uuid, attempt_id uuid)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  UPDATE public."google_oauth_attempts" AS attempt
  SET "used_at" = p_consumed_at
  WHERE attempt."token_hash" = p_token_hash
    AND attempt."used_at" IS NULL
    AND attempt."expires_at" > p_consumed_at
  RETURNING attempt."tenant_id", attempt."id";
$function$;

-- API-owned cleanup recovery gets only tenant and durable cleanup identifiers.
-- Credential material and cleanup state are re-read inside tenant context.
CREATE FUNCTION public.api_due_google_credential_cleanups(p_limit integer)
RETURNS TABLE (tenant_id uuid, cleanup_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT cleanup."tenant_id", cleanup."id"
  FROM public."google_credential_cleanups" AS cleanup
  WHERE cleanup."terminal_at" IS NULL
    AND cleanup."status" IN ('PENDING', 'FAILED')
  ORDER BY cleanup."updated_at", cleanup."id"
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 100);
$function$;

REVOKE ALL ON FUNCTION public.api_consume_google_oauth_attempt(text, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_due_google_credential_cleanups(integer) FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
    GRANT EXECUTE ON FUNCTION public.api_consume_google_oauth_attempt(text, timestamp with time zone) TO autosale_api;
    GRANT EXECUTE ON FUNCTION public.api_due_google_credential_cleanups(integer) TO autosale_api;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
    REVOKE ALL ON FUNCTION public.api_consume_google_oauth_attempt(text, timestamp with time zone) FROM autosale_worker;
    REVOKE ALL ON FUNCTION public.api_due_google_credential_cleanups(integer) FROM autosale_worker;
  END IF;
END
$grants$;
