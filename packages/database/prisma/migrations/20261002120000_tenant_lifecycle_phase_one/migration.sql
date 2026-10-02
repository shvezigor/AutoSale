CREATE TABLE "tenant_lifecycle_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED',
  "reason_code" TEXT NOT NULL,
  "requested_by_user_id" UUID NOT NULL,
  "idempotency_key" UUID NOT NULL,
  "request_hash" TEXT NOT NULL,
  "ingestion_frozen_at" TIMESTAMPTZ,
  "export_object_key" TEXT,
  "export_sha256" TEXT,
  "export_size_bytes" BIGINT,
  "export_manifest_version" INTEGER,
  "export_ready_at" TIMESTAMPTZ,
  "export_expires_at" TIMESTAMPTZ,
  "lease_id" UUID,
  "lease_expires_at" TIMESTAMPTZ,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_error_code" TEXT,
  "cancelled_at" TIMESTAMPTZ,
  "cancelled_by_user_id" UUID,
  "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "tenant_lifecycle_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_lifecycle_requests_kind_check" CHECK ("kind" IN ('EXPORT', 'DELETE')),
  CONSTRAINT "tenant_lifecycle_requests_status_check" CHECK ("status" IN ('REQUESTED', 'EXPORTING', 'EXPORT_READY', 'FAILED', 'CANCELLED')),
  CONSTRAINT "tenant_lifecycle_requests_reason_check" CHECK ("reason_code" IN ('CONTROLLER_REQUEST', 'CONTRACT_TERMINATION', 'ADMINISTRATIVE_TEST')),
  CONSTRAINT "tenant_lifecycle_requests_export_sha_check" CHECK ("export_sha256" IS NULL OR "export_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "tenant_lifecycle_requests_export_size_check" CHECK ("export_size_bytes" IS NULL OR "export_size_bytes" >= 0),
  CONSTRAINT "tenant_lifecycle_requests_manifest_version_check" CHECK ("export_manifest_version" IS NULL OR "export_manifest_version" > 0),
  CONSTRAINT "tenant_lifecycle_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "tenant_lifecycle_requests_tenant_id_idempotency_key_key"
  ON "tenant_lifecycle_requests"("tenant_id", "idempotency_key");
CREATE UNIQUE INDEX "tenant_lifecycle_requests_one_active_delete_idx"
  ON "tenant_lifecycle_requests"("tenant_id")
  WHERE "kind" = 'DELETE' AND "status" IN ('REQUESTED', 'EXPORTING', 'EXPORT_READY', 'FAILED');
CREATE INDEX "tenant_lifecycle_requests_status_next_attempt_at_idx"
  ON "tenant_lifecycle_requests"("status", "next_attempt_at");
CREATE INDEX "tenant_lifecycle_requests_export_expires_at_idx"
  ON "tenant_lifecycle_requests"("export_expires_at");

CREATE TABLE "tenant_retention_dry_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED',
  "requested_by_user_id" UUID NOT NULL,
  "idempotency_key" UUID NOT NULL,
  "request_hash" TEXT NOT NULL,
  "summary" JSONB,
  "lease_id" UUID,
  "lease_expires_at" TIMESTAMPTZ,
  "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_error_code" TEXT,
  "completed_at" TIMESTAMPTZ,
  "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "tenant_retention_dry_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_retention_dry_runs_status_check" CHECK ("status" IN ('REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED')),
  CONSTRAINT "tenant_retention_dry_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "tenant_retention_dry_runs_tenant_id_idempotency_key_key"
  ON "tenant_retention_dry_runs"("tenant_id", "idempotency_key");
CREATE INDEX "tenant_retention_dry_runs_status_next_attempt_at_idx"
  ON "tenant_retention_dry_runs"("status", "next_attempt_at");

ALTER TABLE "tenant_lifecycle_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_lifecycle_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_lifecycle_requests_tenant_isolation" ON "tenant_lifecycle_requests"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "tenant_retention_dry_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_retention_dry_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_retention_dry_runs_tenant_isolation" ON "tenant_retention_dry_runs"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE FUNCTION public.is_active_platform_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.users AS app_user
    WHERE app_user.id = p_user_id
      AND app_user.platform_role::text = 'PLATFORM_ADMIN'
      AND app_user.status::text = 'ACTIVE'
  );
$function$;

REVOKE ALL ON FUNCTION public.is_active_platform_admin(uuid) FROM PUBLIC;

CREATE FUNCTION public.api_platform_create_tenant_lifecycle_request(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_kind text,
  p_reason_code text,
  p_idempotency_key uuid,
  p_request_hash text,
  p_now timestamp with time zone
)
RETURNS TABLE (
  request_id uuid,
  tenant_id uuid,
  kind text,
  status text,
  reason_code text,
  ingestion_frozen_at timestamp with time zone,
  requested_at timestamp with time zone,
  replayed boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  existing public.tenant_lifecycle_requests%ROWTYPE;
  created public.tenant_lifecycle_requests%ROWTYPE;
BEGIN
  IF NOT public.is_active_platform_admin(p_actor_user_id) THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN
    RETURN;
  END IF;
  IF p_kind NOT IN ('EXPORT', 'DELETE')
    OR p_reason_code NOT IN ('CONTROLLER_REQUEST', 'CONTRACT_TERMINATION', 'ADMINISTRATIVE_TEST')
    OR length(p_request_hash) < 1 THEN
    RAISE EXCEPTION 'INVALID_TENANT_LIFECYCLE_REQUEST' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO existing
  FROM public.tenant_lifecycle_requests
  WHERE tenant_lifecycle_requests.tenant_id = p_tenant_id
    AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF existing.request_hash <> p_request_hash
      OR existing.kind <> p_kind
      OR existing.reason_code <> p_reason_code THEN
      RAISE EXCEPTION 'LIFECYCLE_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT existing.id, existing.tenant_id, existing.kind, existing.status,
      existing.reason_code, existing.ingestion_frozen_at, existing.requested_at, true;
    RETURN;
  END IF;

  INSERT INTO public.tenant_lifecycle_requests (
    tenant_id, kind, status, reason_code, requested_by_user_id,
    idempotency_key, request_hash, ingestion_frozen_at,
    next_attempt_at, requested_at, updated_at
  ) VALUES (
    p_tenant_id, p_kind, 'REQUESTED', p_reason_code, p_actor_user_id,
    p_idempotency_key, p_request_hash,
    CASE WHEN p_kind = 'DELETE' THEN p_now ELSE NULL END,
    p_now, p_now, p_now
  ) RETURNING * INTO created;

  RETURN QUERY SELECT created.id, created.tenant_id, created.kind, created.status,
    created.reason_code, created.ingestion_frozen_at, created.requested_at, false;
END
$function$;

CREATE FUNCTION public.api_platform_tenant_lifecycle_requests(p_actor_user_id uuid)
RETURNS TABLE (
  request_id uuid, tenant_id uuid, kind text, status text, reason_code text,
  ingestion_frozen_at timestamp with time zone, export_sha256 text,
  export_size_bytes bigint, export_manifest_version integer,
  export_ready_at timestamp with time zone, export_expires_at timestamp with time zone,
  last_error_code text, cancelled_at timestamp with time zone, requested_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT request.id, request.tenant_id, request.kind, request.status, request.reason_code,
    request.ingestion_frozen_at, request.export_sha256, request.export_size_bytes,
    request.export_manifest_version, request.export_ready_at, request.export_expires_at,
    request.last_error_code, request.cancelled_at, request.requested_at
  FROM public.tenant_lifecycle_requests AS request
  WHERE public.is_active_platform_admin(p_actor_user_id)
  ORDER BY request.requested_at DESC, request.id DESC;
$function$;

CREATE FUNCTION public.api_platform_tenant_lifecycle_request(p_actor_user_id uuid, p_request_id uuid)
RETURNS TABLE (
  request_id uuid, tenant_id uuid, kind text, status text, reason_code text,
  ingestion_frozen_at timestamp with time zone, export_object_key text, export_sha256 text,
  export_size_bytes bigint, export_manifest_version integer,
  export_ready_at timestamp with time zone, export_expires_at timestamp with time zone,
  last_error_code text, cancelled_at timestamp with time zone, requested_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT request.id, request.tenant_id, request.kind, request.status, request.reason_code,
    request.ingestion_frozen_at, request.export_object_key, request.export_sha256,
    request.export_size_bytes, request.export_manifest_version, request.export_ready_at,
    request.export_expires_at, request.last_error_code, request.cancelled_at, request.requested_at
  FROM public.tenant_lifecycle_requests AS request
  WHERE request.id = p_request_id AND public.is_active_platform_admin(p_actor_user_id);
$function$;

CREATE FUNCTION public.api_platform_cancel_tenant_lifecycle_request(
  p_actor_user_id uuid, p_request_id uuid, p_now timestamp with time zone
)
RETURNS TABLE (request_id uuid, tenant_id uuid, status text)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  UPDATE public.tenant_lifecycle_requests AS request
  SET status = 'CANCELLED', cancelled_at = p_now, cancelled_by_user_id = p_actor_user_id,
      ingestion_frozen_at = NULL, lease_id = NULL, lease_expires_at = NULL, updated_at = p_now
  WHERE request.id = p_request_id
    AND request.status IN ('REQUESTED', 'FAILED', 'EXPORT_READY')
    AND public.is_active_platform_admin(p_actor_user_id)
  RETURNING request.id, request.tenant_id, request.status;
$function$;

CREATE FUNCTION public.api_platform_retry_tenant_lifecycle_request(
  p_actor_user_id uuid, p_request_id uuid, p_now timestamp with time zone
)
RETURNS TABLE (request_id uuid, tenant_id uuid, status text)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  UPDATE public.tenant_lifecycle_requests AS request
  SET status = 'REQUESTED', next_attempt_at = p_now, last_error_code = NULL,
      lease_id = NULL, lease_expires_at = NULL, updated_at = p_now
  WHERE request.id = p_request_id
    AND request.status = 'FAILED'
    AND public.is_active_platform_admin(p_actor_user_id)
  RETURNING request.id, request.tenant_id, request.status;
$function$;

CREATE FUNCTION public.api_platform_create_retention_dry_run(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_idempotency_key uuid,
  p_request_hash text,
  p_now timestamp with time zone
)
RETURNS TABLE (run_id uuid, tenant_id uuid, status text, requested_at timestamp with time zone, replayed boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  existing public.tenant_retention_dry_runs%ROWTYPE;
  created public.tenant_retention_dry_runs%ROWTYPE;
BEGIN
  IF NOT public.is_active_platform_admin(p_actor_user_id)
    OR NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN
    RETURN;
  END IF;

  SELECT * INTO existing
  FROM public.tenant_retention_dry_runs
  WHERE tenant_retention_dry_runs.tenant_id = p_tenant_id
    AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF existing.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'RETENTION_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT existing.id, existing.tenant_id, existing.status, existing.requested_at, true;
    RETURN;
  END IF;

  INSERT INTO public.tenant_retention_dry_runs (
    tenant_id, status, requested_by_user_id, idempotency_key,
    request_hash, next_attempt_at, requested_at, updated_at
  ) VALUES (
    p_tenant_id, 'REQUESTED', p_actor_user_id, p_idempotency_key,
    p_request_hash, p_now, p_now, p_now
  ) RETURNING * INTO created;
  RETURN QUERY SELECT created.id, created.tenant_id, created.status, created.requested_at, false;
END
$function$;

CREATE FUNCTION public.api_platform_retention_dry_runs(p_actor_user_id uuid, p_tenant_id uuid)
RETURNS TABLE (
  run_id uuid, tenant_id uuid, status text, summary jsonb,
  last_error_code text, completed_at timestamp with time zone, requested_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT run.id, run.tenant_id, run.status, run.summary, run.last_error_code, run.completed_at, run.requested_at
  FROM public.tenant_retention_dry_runs AS run
  WHERE run.tenant_id = p_tenant_id AND public.is_active_platform_admin(p_actor_user_id)
  ORDER BY run.requested_at DESC, run.id DESC;
$function$;

CREATE FUNCTION public.worker_due_tenant_lifecycle_requests(p_now timestamp with time zone, p_limit integer)
RETURNS TABLE (tenant_id uuid, request_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT request.tenant_id, request.id
  FROM public.tenant_lifecycle_requests AS request
  WHERE (
      request.status IN ('REQUESTED', 'FAILED') AND request.next_attempt_at <= p_now
    ) OR (
      request.status = 'EXPORTING' AND request.lease_expires_at <= p_now
    )
  ORDER BY request.next_attempt_at, request.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 50);
$function$;

CREATE FUNCTION public.worker_due_tenant_lifecycle_artifact_cleanups(p_now timestamp with time zone, p_limit integer)
RETURNS TABLE (tenant_id uuid, request_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT request.tenant_id, request.id
  FROM public.tenant_lifecycle_requests AS request
  WHERE request.status = 'EXPORT_READY'
    AND request.export_object_key IS NOT NULL
    AND request.export_expires_at <= p_now
  ORDER BY request.export_expires_at, request.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 50);
$function$;

CREATE FUNCTION public.worker_due_retention_dry_runs(p_now timestamp with time zone, p_limit integer)
RETURNS TABLE (tenant_id uuid, run_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT run.tenant_id, run.id
  FROM public.tenant_retention_dry_runs AS run
  WHERE (
      run.status IN ('REQUESTED', 'FAILED') AND run.next_attempt_at <= p_now
    ) OR (
      run.status = 'PROCESSING' AND run.lease_expires_at <= p_now
    )
  ORDER BY run.next_attempt_at, run.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 50);
$function$;

REVOKE ALL ON FUNCTION public.api_platform_create_tenant_lifecycle_request(uuid, uuid, text, text, uuid, text, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_platform_tenant_lifecycle_requests(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_platform_tenant_lifecycle_request(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_platform_cancel_tenant_lifecycle_request(uuid, uuid, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_platform_retry_tenant_lifecycle_request(uuid, uuid, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_platform_create_retention_dry_run(uuid, uuid, uuid, text, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_platform_retention_dry_runs(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.worker_due_tenant_lifecycle_requests(timestamp with time zone, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.worker_due_tenant_lifecycle_artifact_cleanups(timestamp with time zone, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.worker_due_retention_dry_runs(timestamp with time zone, integer) FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
    GRANT EXECUTE ON FUNCTION public.api_platform_create_tenant_lifecycle_request(uuid, uuid, text, text, uuid, text, timestamp with time zone) TO autosale_api;
    GRANT EXECUTE ON FUNCTION public.api_platform_tenant_lifecycle_requests(uuid) TO autosale_api;
    GRANT EXECUTE ON FUNCTION public.api_platform_tenant_lifecycle_request(uuid, uuid) TO autosale_api;
    GRANT EXECUTE ON FUNCTION public.api_platform_cancel_tenant_lifecycle_request(uuid, uuid, timestamp with time zone) TO autosale_api;
    GRANT EXECUTE ON FUNCTION public.api_platform_retry_tenant_lifecycle_request(uuid, uuid, timestamp with time zone) TO autosale_api;
    GRANT EXECUTE ON FUNCTION public.api_platform_create_retention_dry_run(uuid, uuid, uuid, text, timestamp with time zone) TO autosale_api;
    GRANT EXECUTE ON FUNCTION public.api_platform_retention_dry_runs(uuid, uuid) TO autosale_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
    GRANT EXECUTE ON FUNCTION public.worker_due_tenant_lifecycle_requests(timestamp with time zone, integer) TO autosale_worker;
    GRANT EXECUTE ON FUNCTION public.worker_due_tenant_lifecycle_artifact_cleanups(timestamp with time zone, integer) TO autosale_worker;
    GRANT EXECUTE ON FUNCTION public.worker_due_retention_dry_runs(timestamp with time zone, integer) TO autosale_worker;
  END IF;
END
$grants$;
