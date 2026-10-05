CREATE TYPE "AiReplyDraftStatus" AS ENUM ('QUEUED', 'PROCESSING', 'READY', 'USED', 'STALE', 'BLOCKED', 'FAILED');
CREATE TYPE "AiReplyDraftOutcome" AS ENUM ('ANSWER', 'CLARIFY', 'HANDOFF');

CREATE TABLE "tenant_reply_styles" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "company_name" TEXT NOT NULL DEFAULT '',
  "tone" TEXT NOT NULL DEFAULT 'NEUTRAL',
  "address_form" TEXT NOT NULL DEFAULT 'FORMAL_YOU',
  "guidance" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "tenant_reply_styles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_reply_styles_tone_check" CHECK ("tone" IN ('FRIENDLY', 'NEUTRAL', 'FORMAL')),
  CONSTRAINT "tenant_reply_styles_address_form_check" CHECK ("address_form" IN ('FORMAL_YOU', 'INFORMAL_YOU')),
  CONSTRAINT "tenant_reply_styles_guidance_length_check" CHECK (char_length("guidance") <= 500),
  CONSTRAINT "tenant_reply_styles_enabled_name_check" CHECK (NOT "enabled" OR length(trim("company_name")) > 0)
);

CREATE UNIQUE INDEX "tenant_reply_styles_tenant_id_key" ON "tenant_reply_styles"("tenant_id");
ALTER TABLE "tenant_reply_styles" ADD CONSTRAINT "tenant_reply_styles_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ai_reply_drafts" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "anchor_message_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "idempotency_key" UUID NOT NULL,
  "status" "AiReplyDraftStatus" NOT NULL DEFAULT 'QUEUED',
  "outcome" "AiReplyDraftOutcome",
  "generated_text" TEXT,
  "final_text" TEXT,
  "source_snapshot" JSONB,
  "prompt_version" TEXT,
  "schema_version" TEXT,
  "model_version" TEXT,
  "provider_latency_ms" INTEGER,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "lease_id" UUID,
  "lease_expires_at" TIMESTAMPTZ,
  "model_request_started_at" TIMESTAMPTZ,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "error_code" TEXT,
  "outbound_message_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "used_at" TIMESTAMPTZ,
  CONSTRAINT "ai_reply_drafts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_reply_drafts_attempts_check" CHECK ("attempts" BETWEEN 0 AND 3)
);

CREATE UNIQUE INDEX "ai_reply_drafts_tenant_id_id_key" ON "ai_reply_drafts"("tenant_id", "id");
CREATE UNIQUE INDEX "ai_reply_drafts_tenant_id_outbound_message_id_key" ON "ai_reply_drafts"("tenant_id", "outbound_message_id");
CREATE UNIQUE INDEX "ai_reply_drafts_tenant_id_conversation_id_anchor_message_id_idempotency_key_key"
  ON "ai_reply_drafts"("tenant_id", "conversation_id", "anchor_message_id", "idempotency_key");
CREATE UNIQUE INDEX "ai_reply_drafts_one_active_anchor_key" ON "ai_reply_drafts"("tenant_id", "conversation_id", "anchor_message_id")
  WHERE "status" IN ('QUEUED', 'PROCESSING');
CREATE INDEX "ai_reply_drafts_status_lease_expires_at_idx" ON "ai_reply_drafts"("status", "lease_expires_at");
CREATE INDEX "ai_reply_drafts_tenant_id_conversation_id_created_at_idx"
  ON "ai_reply_drafts"("tenant_id", "conversation_id", "created_at" DESC);

ALTER TABLE "ai_reply_drafts"
  ADD CONSTRAINT "ai_reply_drafts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_reply_drafts_tenant_id_conversation_id_fkey" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "conversations"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_reply_drafts_tenant_id_anchor_message_id_fkey" FOREIGN KEY ("tenant_id", "anchor_message_id") REFERENCES "messages"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_reply_drafts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_reply_drafts_tenant_id_outbound_message_id_fkey" FOREIGN KEY ("tenant_id", "outbound_message_id") REFERENCES "messages"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tenant_reply_styles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_reply_styles" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_reply_styles_tenant_isolation" ON "tenant_reply_styles"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "ai_reply_drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_reply_drafts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ai_reply_drafts_tenant_isolation" ON "ai_reply_drafts"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE FUNCTION public.worker_due_ai_reply_drafts(p_now timestamp with time zone, p_limit integer)
RETURNS TABLE (tenant_id uuid, draft_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT draft."tenant_id", draft."id"
  FROM public."ai_reply_drafts" AS draft
  JOIN public."tenant_reply_styles" AS style ON style."tenant_id" = draft."tenant_id" AND style."enabled" = TRUE
  WHERE (
    (draft."status" = 'QUEUED' AND draft."attempts" < 3)
    OR (draft."status" = 'PROCESSING' AND draft."lease_expires_at" <= p_now
      AND draft."model_request_started_at" IS NULL AND draft."attempts" < 3)
  )
  AND NOT EXISTS (
    SELECT 1 FROM public."tenant_lifecycle_requests" AS lifecycle
    WHERE lifecycle."tenant_id" = draft."tenant_id"
      AND lifecycle."kind" = 'DELETE'
      AND lifecycle."ingestion_frozen_at" IS NOT NULL
      AND lifecycle."status" IN ('REQUESTED', 'EXPORTING', 'EXPORT_READY', 'FAILED')
  )
  ORDER BY draft."created_at", draft."id"
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 100);
$function$;

REVOKE ALL ON FUNCTION public.worker_due_ai_reply_drafts(timestamp with time zone, integer) FROM PUBLIC;

CREATE FUNCTION public.worker_fail_expired_ai_reply_drafts(p_now timestamp with time zone, p_limit integer)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE changed integer;
BEGIN
  WITH expired AS (
    SELECT draft."id"
    FROM public."ai_reply_drafts" AS draft
    WHERE (draft."status" = 'PROCESSING' AND draft."lease_expires_at" <= p_now
      AND (draft."model_request_started_at" IS NOT NULL OR draft."attempts" >= 3))
      OR (draft."status" = 'QUEUED' AND draft."attempts" >= 3)
    ORDER BY draft."lease_expires_at", draft."id"
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 100)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public."ai_reply_drafts" AS draft
  SET "status" = 'FAILED', "error_code" = 'PROVIDER_UNAVAILABLE',
      "lease_id" = NULL, "lease_expires_at" = NULL, "updated_at" = p_now
  FROM expired WHERE draft."id" = expired."id";
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END
$function$;

REVOKE ALL ON FUNCTION public.worker_fail_expired_ai_reply_drafts(timestamp with time zone, integer) FROM PUBLIC;
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
    REVOKE ALL ON FUNCTION public.worker_due_ai_reply_drafts(timestamp with time zone, integer) FROM autosale_api;
    REVOKE ALL ON FUNCTION public.worker_fail_expired_ai_reply_drafts(timestamp with time zone, integer) FROM autosale_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
    GRANT EXECUTE ON FUNCTION public.worker_due_ai_reply_drafts(timestamp with time zone, integer) TO autosale_worker;
    GRANT EXECUTE ON FUNCTION public.worker_fail_expired_ai_reply_drafts(timestamp with time zone, integer) TO autosale_worker;
  END IF;
END
$grants$;
