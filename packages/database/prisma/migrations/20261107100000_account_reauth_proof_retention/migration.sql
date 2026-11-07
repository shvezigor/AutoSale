-- Proofs are short-lived and contain credential-derived fingerprints. The
-- worker can purge only records that have expired by the database clock.
CREATE FUNCTION public.worker_purge_expired_account_reauth_proofs(p_limit integer)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE purged integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'INVALID_ACCOUNT_REAUTH_PURGE_LIMIT';
  END IF;

  WITH candidates AS (
    SELECT id FROM public.account_reauth_proofs
    WHERE expires_at <= clock_timestamp()
    ORDER BY expires_at, id
    LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public.account_reauth_proofs p USING candidates c
    WHERE p.id = c.id RETURNING p.id
  ) SELECT COUNT(*)::integer INTO purged FROM deleted;
  RETURN purged;
END
$function$;

REVOKE ALL ON FUNCTION public.worker_purge_expired_account_reauth_proofs(integer) FROM PUBLIC;
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
    GRANT EXECUTE ON FUNCTION public.worker_purge_expired_account_reauth_proofs(integer) TO autosale_worker;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
    REVOKE ALL ON FUNCTION public.worker_purge_expired_account_reauth_proofs(integer) FROM autosale_api;
  END IF;
END
$grants$;
