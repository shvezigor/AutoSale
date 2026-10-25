CREATE TYPE "AiProviderUsagePurpose" AS ENUM (
  'ORDER_RECOGNITION', 'ORDER_INTENT', 'REPLY_DRAFT', 'CATALOGUE_STRUCTURE',
  'CATALOGUE_COLUMN_MAPPING', 'CATALOGUE_ROW_CLASSIFICATION'
);
CREATE TYPE "AiProviderUsageProvider" AS ENUM ('OPENAI');
CREATE TYPE "AiProviderUsageOutcome" AS ENUM ('STARTED', 'REPORTED', 'USAGE_MISSING', 'CHARGE_UNKNOWN', 'NOT_SENT');
CREATE TYPE "AiProviderUsageErrorCategory" AS ENUM ('TRANSPORT_ERROR', 'TIMEOUT', 'PRE_DISPATCH_FAILURE', 'ORPHANED');

CREATE TABLE ai_provider_usage_attempts (
  id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  purpose "AiProviderUsagePurpose" NOT NULL,
  operation_id UUID NOT NULL,
  provider "AiProviderUsageProvider" NOT NULL DEFAULT 'OPENAI',
  requested_model TEXT NOT NULL,
  returned_model TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  finalized_at TIMESTAMPTZ,
  outcome "AiProviderUsageOutcome" NOT NULL DEFAULT 'STARTED',
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_input_tokens INTEGER,
  error_category "AiProviderUsageErrorCategory",
  CONSTRAINT ai_provider_usage_attempts_pkey PRIMARY KEY (id),
  CONSTRAINT ai_provider_usage_attempts_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ai_provider_usage_nonnegative CHECK (
    (input_tokens IS NULL OR input_tokens >= 0)
    AND (output_tokens IS NULL OR output_tokens >= 0)
    AND (cached_input_tokens IS NULL OR cached_input_tokens >= 0)
  ),
  CONSTRAINT ai_provider_usage_cached_subset CHECK (
    cached_input_tokens IS NULL OR (input_tokens IS NOT NULL AND cached_input_tokens <= input_tokens)
  ),
  CONSTRAINT ai_provider_usage_finalized CHECK (
    (outcome = 'STARTED' AND finalized_at IS NULL AND returned_model IS NULL AND error_category IS NULL)
    OR (outcome <> 'STARTED' AND finalized_at IS NOT NULL AND finalized_at >= started_at)
  ),
  CONSTRAINT ai_provider_usage_counts CHECK (
    (outcome = 'REPORTED' AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL)
    OR (outcome = 'USAGE_MISSING' AND (input_tokens IS NULL OR output_tokens IS NULL))
    OR (outcome IN ('STARTED', 'CHARGE_UNKNOWN', 'NOT_SENT')
      AND input_tokens IS NULL AND output_tokens IS NULL AND cached_input_tokens IS NULL)
  )
);

CREATE INDEX ai_provider_usage_attempts_tenant_id_started_at_id_idx
  ON ai_provider_usage_attempts(tenant_id, started_at, id);
CREATE INDEX ai_provider_usage_attempts_outcome_started_at_id_idx
  ON ai_provider_usage_attempts(outcome, started_at, id);

ALTER TABLE ai_provider_usage_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_provider_usage_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_provider_usage_tenant ON ai_provider_usage_attempts
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE FUNCTION public.ai_provider_usage_reject_terminal_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF OLD.outcome <> 'STARTED' THEN
    RAISE EXCEPTION 'AI provider usage terminal rows are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER ai_provider_usage_terminal_immutable
  BEFORE UPDATE ON ai_provider_usage_attempts
  FOR EACH ROW EXECUTE FUNCTION public.ai_provider_usage_reject_terminal_update();
REVOKE ALL ON FUNCTION public.ai_provider_usage_reject_terminal_update() FROM PUBLIC;

-- Roles may not exist in an empty migration-test database. Bootstrap repeats these restrictions.
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
    GRANT SELECT ON ai_provider_usage_attempts TO autosale_api;
    REVOKE INSERT, UPDATE, DELETE ON ai_provider_usage_attempts FROM autosale_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
    GRANT SELECT, INSERT, UPDATE ON ai_provider_usage_attempts TO autosale_worker;
    REVOKE DELETE ON ai_provider_usage_attempts FROM autosale_worker;
  END IF;
END
$grants$;
