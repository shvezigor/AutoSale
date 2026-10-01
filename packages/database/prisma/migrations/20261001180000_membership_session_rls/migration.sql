ALTER TABLE "tenant_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_memberships" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_memberships_tenant_isolation" ON "tenant_memberships"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "tenant_invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_invitations" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_invitations_tenant_isolation" ON "tenant_invitations"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "sessions_tenant_isolation" ON "sessions"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE FUNCTION public.api_active_membership_for_user(p_user_id uuid)
RETURNS TABLE (tenant_id uuid, membership_role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT membership."tenant_id", membership."role"::text
  FROM public."tenant_memberships" AS membership
  JOIN public."tenants" AS tenant ON tenant."id" = membership."tenant_id"
  WHERE membership."user_id" = p_user_id
    AND membership."status"::text = 'ACTIVE'
    AND tenant."status"::text = 'ACTIVE'
  ORDER BY membership."created_at", membership."id"
  LIMIT 1;
$function$;

CREATE FUNCTION public.api_invitation_authority(p_token_hash text, p_now timestamp with time zone)
RETURNS TABLE (tenant_id uuid, invitation_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT invitation."tenant_id", invitation."id"
  FROM public."tenant_invitations" AS invitation
  JOIN public."tenants" AS tenant ON tenant."id" = invitation."tenant_id"
  WHERE invitation."token_hash" = p_token_hash
    AND invitation."used_at" IS NULL
    AND invitation."revoked_at" IS NULL
    AND invitation."expires_at" > p_now
    AND tenant."status"::text = 'ACTIVE';
$function$;

CREATE FUNCTION public.api_activate_owner_memberships(p_user_id uuid)
RETURNS TABLE (activated_count integer)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  WITH activated AS (
    UPDATE public."tenant_memberships"
    SET "status" = 'ACTIVE'
    WHERE "user_id" = p_user_id
      AND "role"::text = 'OWNER'
      AND "status"::text = 'PENDING'
    RETURNING 1
  )
  SELECT count(*)::integer FROM activated;
$function$;

CREATE FUNCTION public.api_issue_session(
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

CREATE FUNCTION public.api_resolve_session(p_token_hash text, p_now timestamp with time zone)
RETURNS TABLE (
  session_id uuid,
  user_id uuid,
  tenant_id uuid,
  email text,
  display_name text,
  platform_role text,
  membership_role text,
  locale text,
  avatar_storage_key text,
  avatar_checksum text
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  WITH authorized AS (
    SELECT
      session."id" AS session_id,
      session."user_id",
      session."tenant_id",
      app_user."email",
      app_user."name" AS display_name,
      app_user."platform_role"::text AS platform_role,
      membership."role"::text AS membership_role,
      app_user."locale",
      app_user."avatar_storage_key",
      app_user."avatar_checksum",
      session."last_seen_at"
    FROM public."sessions" AS session
    JOIN public."users" AS app_user ON app_user."id" = session."user_id"
    LEFT JOIN public."tenants" AS tenant ON tenant."id" = session."tenant_id"
    LEFT JOIN public."tenant_memberships" AS membership
      ON membership."tenant_id" = session."tenant_id"
      AND membership."user_id" = session."user_id"
    WHERE session."token_hash" = p_token_hash
      AND session."revoked_at" IS NULL
      AND session."expires_at" > p_now
      AND app_user."status"::text = 'ACTIVE'
      AND (
        (session."tenant_id" IS NULL AND app_user."platform_role"::text = 'PLATFORM_ADMIN')
        OR (
          tenant."status"::text = 'ACTIVE'
          AND membership."status"::text = 'ACTIVE'
        )
      )
  ), touched AS (
    UPDATE public."sessions" AS session
    SET "last_seen_at" = CASE
      WHEN authorized."last_seen_at" <= p_now - interval '15 minutes' THEN p_now
      ELSE authorized."last_seen_at"
    END
    FROM authorized
    WHERE session."id" = authorized.session_id
    RETURNING session."id"
  )
  SELECT
    authorized.session_id,
    authorized."user_id",
    authorized."tenant_id",
    authorized."email",
    authorized.display_name,
    authorized.platform_role,
    authorized.membership_role,
    authorized."locale",
    authorized."avatar_storage_key",
    authorized."avatar_checksum"
  FROM authorized
  JOIN touched ON touched."id" = authorized.session_id;
$function$;

CREATE FUNCTION public.api_revoke_session(p_session_id uuid, p_revoked_at timestamp with time zone)
RETURNS TABLE (revoked_count integer)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  WITH revoked AS (
    UPDATE public."sessions"
    SET "revoked_at" = p_revoked_at
    WHERE "id" = p_session_id AND "revoked_at" IS NULL
    RETURNING 1
  )
  SELECT count(*)::integer FROM revoked;
$function$;

CREATE FUNCTION public.api_revoke_sessions(
  p_user_id uuid,
  p_except_session_id uuid,
  p_tenant_id uuid,
  p_revoked_at timestamp with time zone
)
RETURNS TABLE (revoked_count integer)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  WITH revoked AS (
    UPDATE public."sessions"
    SET "revoked_at" = p_revoked_at
    WHERE (p_user_id IS NOT NULL OR p_tenant_id IS NOT NULL)
      AND (p_user_id IS NULL OR "user_id" = p_user_id)
      AND (p_except_session_id IS NULL OR "id" <> p_except_session_id)
      AND (p_tenant_id IS NULL OR "tenant_id" = p_tenant_id)
      AND "revoked_at" IS NULL
    RETURNING 1
  )
  SELECT count(*)::integer FROM revoked;
$function$;

CREATE FUNCTION public.platform_tenant_directory()
RETURNS TABLE (
  tenant_id uuid,
  tenant_name text,
  tenant_status text,
  owner_email text,
  user_count bigint,
  created_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    tenant."id",
    tenant."name",
    tenant."status"::text,
    min(app_user."email") FILTER (WHERE membership."role"::text = 'OWNER'),
    count(membership."id"),
    tenant."created_at"
  FROM public."tenants" AS tenant
  LEFT JOIN public."tenant_memberships" AS membership ON membership."tenant_id" = tenant."id"
  LEFT JOIN public."users" AS app_user ON app_user."id" = membership."user_id"
  GROUP BY tenant."id", tenant."name", tenant."status", tenant."created_at";
$function$;

REVOKE ALL ON FUNCTION public.api_active_membership_for_user(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_invitation_authority(text, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_activate_owner_memberships(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_issue_session(uuid, uuid, uuid, text, timestamp with time zone, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_resolve_session(text, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_revoke_session(uuid, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_revoke_sessions(uuid, uuid, uuid, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_tenant_directory() FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
    GRANT EXECUTE ON FUNCTION public.api_active_membership_for_user(uuid) TO autosale_api;
    GRANT EXECUTE ON FUNCTION public.api_invitation_authority(text, timestamp with time zone) TO autosale_api;
    GRANT EXECUTE ON FUNCTION public.api_activate_owner_memberships(uuid) TO autosale_api;
    GRANT EXECUTE ON FUNCTION public.api_issue_session(uuid, uuid, uuid, text, timestamp with time zone, text, text) TO autosale_api;
    GRANT EXECUTE ON FUNCTION public.api_resolve_session(text, timestamp with time zone) TO autosale_api;
    GRANT EXECUTE ON FUNCTION public.api_revoke_session(uuid, timestamp with time zone) TO autosale_api;
    GRANT EXECUTE ON FUNCTION public.api_revoke_sessions(uuid, uuid, uuid, timestamp with time zone) TO autosale_api;
    GRANT EXECUTE ON FUNCTION public.platform_tenant_directory() TO autosale_api;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
    REVOKE ALL ON FUNCTION public.api_active_membership_for_user(uuid) FROM autosale_worker;
    REVOKE ALL ON FUNCTION public.api_invitation_authority(text, timestamp with time zone) FROM autosale_worker;
    REVOKE ALL ON FUNCTION public.api_activate_owner_memberships(uuid) FROM autosale_worker;
    REVOKE ALL ON FUNCTION public.api_issue_session(uuid, uuid, uuid, text, timestamp with time zone, text, text) FROM autosale_worker;
    REVOKE ALL ON FUNCTION public.api_resolve_session(text, timestamp with time zone) FROM autosale_worker;
    REVOKE ALL ON FUNCTION public.api_revoke_session(uuid, timestamp with time zone) FROM autosale_worker;
    REVOKE ALL ON FUNCTION public.api_revoke_sessions(uuid, uuid, uuid, timestamp with time zone) FROM autosale_worker;
    REVOKE ALL ON FUNCTION public.platform_tenant_directory() FROM autosale_worker;
  END IF;
END
$grants$;
