-- Orphan discovery returns only the directory needed for tenant-scoped repair.
-- Frozen tenants are intentionally included: already-dispatched cost evidence must converge.
CREATE FUNCTION public.worker_due_ai_provider_usage_attempts(p_now timestamptz, p_limit integer)
RETURNS TABLE (tenant_id uuid, attempt_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT attempt.tenant_id, attempt.id
  FROM public.ai_provider_usage_attempts AS attempt
  WHERE attempt.outcome = 'STARTED'
    AND attempt.started_at < p_now - INTERVAL '15 minutes'
  ORDER BY attempt.started_at, attempt.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 100);
$function$;

CREATE INDEX ai_provider_usage_attempts_terminal_finalized_at_id_idx
  ON public.ai_provider_usage_attempts(finalized_at, id) WHERE outcome <> 'STARTED';

-- Retention begins at finalization, so repairing an ancient STARTED attempt can
-- never make it immediately eligible for deletion. Caller opt-in is separately default-OFF.
CREATE FUNCTION public.worker_purge_ai_provider_usage_attempts(p_now timestamptz, p_limit integer)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  WITH candidates AS (
    SELECT attempt.id
    FROM public.ai_provider_usage_attempts AS attempt
    WHERE attempt.outcome <> 'STARTED'
      AND attempt.finalized_at < p_now - INTERVAL '90 days'
    ORDER BY attempt.finalized_at, attempt.id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 100)
    FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public.ai_provider_usage_attempts AS attempt
    USING candidates
    WHERE attempt.id = candidates.id
    RETURNING 1
  )
  SELECT count(*)::integer FROM deleted;
$function$;

REVOKE ALL ON FUNCTION public.worker_due_ai_provider_usage_attempts(timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.worker_purge_ai_provider_usage_attempts(timestamptz, integer) FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
    REVOKE ALL ON FUNCTION public.worker_due_ai_provider_usage_attempts(timestamptz, integer) FROM autosale_api;
    REVOKE ALL ON FUNCTION public.worker_purge_ai_provider_usage_attempts(timestamptz, integer) FROM autosale_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_backup') THEN
    REVOKE ALL ON FUNCTION public.worker_due_ai_provider_usage_attempts(timestamptz, integer) FROM autosale_backup;
    REVOKE ALL ON FUNCTION public.worker_purge_ai_provider_usage_attempts(timestamptz, integer) FROM autosale_backup;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
    GRANT EXECUTE ON FUNCTION public.worker_due_ai_provider_usage_attempts(timestamptz, integer) TO autosale_worker;
    GRANT EXECUTE ON FUNCTION public.worker_purge_ai_provider_usage_attempts(timestamptz, integer) TO autosale_worker;
  END IF;
END
$grants$;
