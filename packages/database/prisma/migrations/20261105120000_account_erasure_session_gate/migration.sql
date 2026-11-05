-- This state is deliberately not reachable through an HTTP route yet. A future
-- erasure executor must first persist the independent deletion intent.
ALTER TYPE public."AccessStatus" ADD VALUE IF NOT EXISTS 'DELETING';

-- Session issuance and a future ACTIVE -> DELETING transition must serialize on
-- the same user row. If issuance wins, the deletion transaction revokes it; if
-- deletion wins, this function observes DELETING and refuses a new session.
CREATE OR REPLACE FUNCTION public.api_issue_session(
  p_session_id uuid,
  p_user_id uuid,
  p_tenant_id uuid,
  p_token_hash text,
  p_expires_at timestamp with time zone,
  p_ip_prefix text,
  p_user_agent text
)
RETURNS TABLE (session_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  -- Keep this lock through the INSERT (and through a caller's transaction).
  -- A separate status read without this lock can race with account erasure.
  PERFORM 1 FROM public."users" AS app_user
  WHERE app_user."id" = p_user_id
  FOR UPDATE OF app_user;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public."users" AS app_user
    WHERE app_user."id" = p_user_id
      AND app_user."status"::text = 'ACTIVE'
      AND (
        (p_tenant_id IS NULL AND app_user."platform_role"::text = 'PLATFORM_ADMIN')
        OR EXISTS (
          SELECT 1
          FROM public."tenant_memberships" AS membership
          JOIN public."tenants" AS tenant ON tenant."id" = membership."tenant_id"
          WHERE membership."user_id" = p_user_id
            AND membership."tenant_id" = p_tenant_id
            AND membership."status"::text = 'ACTIVE'
            AND tenant."status"::text = 'ACTIVE'
        )
      )
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public."sessions" (
    "id", "user_id", "tenant_id", "token_hash", "expires_at",
    "ip_prefix", "user_agent", "last_seen_at", "created_at"
  ) VALUES (
    p_session_id, p_user_id, p_tenant_id, p_token_hash, p_expires_at,
    left(p_ip_prefix, 64), left(p_user_agent, 256), clock_timestamp(), clock_timestamp()
  );
  RETURN QUERY SELECT p_session_id;
END
$function$;

REVOKE ALL ON FUNCTION public.api_issue_session(uuid, uuid, uuid, text, timestamp with time zone, text, text) FROM PUBLIC;
