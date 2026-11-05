-- A proof is issued only after a fresh local-password check and can be consumed
-- only in the future deletion transaction. No destructive route is enabled here.
CREATE TABLE public.account_reauth_proofs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  purpose text NOT NULL DEFAULT 'ACCOUNT_DELETE'
    CONSTRAINT account_reauth_proofs_purpose_check CHECK (purpose = 'ACCOUNT_DELETE'),
  method text NOT NULL
    CONSTRAINT account_reauth_proofs_method_check CHECK (method IN ('LOCAL_PASSWORD', 'GOOGLE')),
  token_hash text NOT NULL UNIQUE,
  credential_fingerprint text,
  expires_at timestamp with time zone NOT NULL,
  used_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT account_reauth_proofs_local_fingerprint_check
    CHECK (method <> 'LOCAL_PASSWORD' OR credential_fingerprint IS NOT NULL)
);
CREATE INDEX account_reauth_proofs_user_session_expires_idx
  ON public.account_reauth_proofs(user_id, session_id, expires_at);
CREATE INDEX account_reauth_proofs_expires_used_idx
  ON public.account_reauth_proofs(expires_at, used_at);

-- Runtime code may mark a proof used once, but may never extend its lifetime,
-- replace its hash, or return it to the unused state.
CREATE FUNCTION public.account_reauth_proof_consume_once()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF (to_jsonb(NEW) - 'used_at') IS DISTINCT FROM (to_jsonb(OLD) - 'used_at')
     OR OLD.used_at IS NOT NULL
     OR NEW.used_at IS NULL
     OR NEW.used_at >= OLD.expires_at
     OR clock_timestamp() >= OLD.expires_at THEN
    RAISE EXCEPTION 'ACCOUNT_REAUTH_PROOF_IMMUTABLE';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER account_reauth_proof_consume_once_trigger
BEFORE UPDATE ON public.account_reauth_proofs
FOR EACH ROW EXECUTE FUNCTION public.account_reauth_proof_consume_once();

ALTER TABLE public.account_reauth_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_reauth_proofs FORCE ROW LEVEL SECURITY;
CREATE POLICY account_reauth_proofs_tenant_isolation ON public.account_reauth_proofs
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
