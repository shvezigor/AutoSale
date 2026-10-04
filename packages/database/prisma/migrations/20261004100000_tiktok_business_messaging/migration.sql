CREATE TYPE "TikTokConnectionStatus" AS ENUM ('ACTIVE', 'INBOUND_ONLY', 'REAUTH_REQUIRED', 'ERROR', 'DISCONNECTED');
CREATE TYPE "TikTokCredentialCleanupOperationStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "TikTokCredentialCleanupState" AS ENUM ('ARMED', 'REQUIRED', 'COMPLETED', 'CANCELLED', 'DEAD_LETTER');

CREATE TABLE "tiktok_connections" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "external_account_id" TEXT NOT NULL,
  "display_name" TEXT,
  "status" "TikTokConnectionStatus" NOT NULL DEFAULT 'ERROR',
  "capabilities" JSONB,
  "encrypted_access_token" TEXT,
  "encrypted_refresh_token" TEXT,
  "credential_generation_id" UUID,
  "token_expires_at" TIMESTAMPTZ,
  "refresh_token_expires_at" TIMESTAMPTZ,
  "granted_scopes" TEXT,
  "connected_by_user_id" UUID,
  "last_verified_at" TIMESTAMPTZ,
  "last_error_code" TEXT,
  "refresh_lease_id" UUID,
  "refresh_lease_expires_at" TIMESTAMPTZ,
  "disconnected_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "tiktok_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tiktok_oauth_attempts" (
  "id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "return_path" TEXT NOT NULL DEFAULT '/settings?tab=social',
  "expires_at" TIMESTAMPTZ NOT NULL,
  "used_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "tiktok_oauth_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tiktok_credential_cleanups" (
  "id" UUID NOT NULL,
  "credential_generation_id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "external_account_id" TEXT NOT NULL,
  "encrypted_access_token" TEXT NOT NULL,
  "encrypted_refresh_token" TEXT,
  "source" TEXT NOT NULL DEFAULT 'DISCONNECT',
  "state" "TikTokCredentialCleanupState" NOT NULL DEFAULT 'ARMED',
  "callback_resolved_at" TIMESTAMPTZ,
  "revoke_status" "TikTokCredentialCleanupOperationStatus" NOT NULL DEFAULT 'PENDING',
  "revoke_attempted_at" TIMESTAMPTZ,
  "revoke_succeeded_at" TIMESTAMPTZ,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lease_id" UUID,
  "lease_expires_at" TIMESTAMPTZ,
  "version" INTEGER NOT NULL DEFAULT 0,
  "last_error_code" TEXT,
  "permanent_failure_at" TIMESTAMPTZ,
  "dead_lettered_at" TIMESTAMPTZ,
  "dead_lettered_by_user_id" UUID,
  "terminal_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "tiktok_credential_cleanups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tiktok_connections_tenant_id_key" ON "tiktok_connections"("tenant_id");
CREATE UNIQUE INDEX "tiktok_connections_external_account_id_key" ON "tiktok_connections"("external_account_id");
CREATE UNIQUE INDEX "tiktok_connections_credential_generation_id_key" ON "tiktok_connections"("credential_generation_id");
CREATE INDEX "tiktok_connections_status_idx" ON "tiktok_connections"("status");
CREATE INDEX "tiktok_connections_refresh_lease_expires_at_idx" ON "tiktok_connections"("refresh_lease_expires_at");
CREATE UNIQUE INDEX "tiktok_oauth_attempts_token_hash_key" ON "tiktok_oauth_attempts"("token_hash");
CREATE INDEX "tiktok_oauth_attempts_tenant_id_used_at_idx" ON "tiktok_oauth_attempts"("tenant_id", "used_at");
CREATE INDEX "tiktok_oauth_attempts_expires_at_used_at_idx" ON "tiktok_oauth_attempts"("expires_at", "used_at");
CREATE UNIQUE INDEX "tiktok_credential_cleanups_credential_generation_id_key" ON "tiktok_credential_cleanups"("credential_generation_id");
CREATE INDEX "tiktok_credential_cleanups_tenant_id_terminal_at_idx" ON "tiktok_credential_cleanups"("tenant_id", "terminal_at");
CREATE INDEX "tiktok_credential_cleanups_lease_expires_at_idx" ON "tiktok_credential_cleanups"("lease_expires_at");

ALTER TABLE "tiktok_connections"
  ADD CONSTRAINT "tiktok_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "tiktok_connections_connected_by_user_id_fkey" FOREIGN KEY ("connected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tiktok_oauth_attempts"
  ADD CONSTRAINT "tiktok_oauth_attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "tiktok_oauth_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "tiktok_oauth_attempts_user_id_tenant_id_fkey" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "tenant_memberships"("user_id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tiktok_credential_cleanups"
  ADD CONSTRAINT "tiktok_credential_cleanups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "tiktok_credential_cleanups_dead_lettered_by_user_id_fkey" FOREIGN KEY ("dead_lettered_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tiktok_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tiktok_connections" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tiktok_connections_tenant_isolation" ON "tiktok_connections"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "tiktok_oauth_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tiktok_oauth_attempts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tiktok_oauth_attempts_tenant_isolation" ON "tiktok_oauth_attempts"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "tiktok_credential_cleanups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tiktok_credential_cleanups" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tiktok_credential_cleanups_tenant_isolation" ON "tiktok_credential_cleanups"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE FUNCTION public.api_tiktok_tenant_for_account(p_external_account_id text)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT connection."tenant_id"
  FROM public."tiktok_connections" AS connection
  WHERE connection."external_account_id" = p_external_account_id
    AND connection."status" IN ('ACTIVE', 'INBOUND_ONLY')
  LIMIT 1;
$function$;

CREATE FUNCTION public.api_consume_tiktok_oauth_attempt(
  p_token_hash text,
  p_consumed_at timestamp with time zone
)
RETURNS TABLE (tenant_id uuid, attempt_id uuid)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  UPDATE public."tiktok_oauth_attempts" AS attempt
  SET "used_at" = p_consumed_at,
      "updated_at" = p_consumed_at
  WHERE attempt."token_hash" = p_token_hash
    AND attempt."used_at" IS NULL
    AND attempt."expires_at" > p_consumed_at
  RETURNING attempt."tenant_id", attempt."id";
$function$;

REVOKE ALL ON FUNCTION public.api_tiktok_tenant_for_account(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_consume_tiktok_oauth_attempt(text, timestamp with time zone) FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
    GRANT EXECUTE ON FUNCTION public.api_tiktok_tenant_for_account(text) TO autosale_api;
    GRANT EXECUTE ON FUNCTION public.api_consume_tiktok_oauth_attempt(text, timestamp with time zone) TO autosale_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
    REVOKE ALL ON FUNCTION public.api_tiktok_tenant_for_account(text) FROM autosale_worker;
    REVOKE ALL ON FUNCTION public.api_consume_tiktok_oauth_attempt(text, timestamp with time zone) FROM autosale_worker;
  END IF;
END
$grants$;
