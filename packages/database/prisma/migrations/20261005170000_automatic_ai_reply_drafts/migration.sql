CREATE TYPE "AiReplyDraftTriggerSource" AS ENUM ('MANUAL', 'AUTOMATIC');

ALTER TABLE "ai_reply_drafts"
  ALTER COLUMN "created_by_user_id" DROP NOT NULL,
  ADD COLUMN "trigger_source" "AiReplyDraftTriggerSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "ai_reply_drafts_status_available_at_idx"
  ON "ai_reply_drafts"("status", "available_at");

DROP FUNCTION public.worker_due_ai_reply_drafts(timestamp with time zone, integer);

CREATE FUNCTION public.worker_due_ai_reply_drafts(p_now timestamp with time zone, p_limit integer)
RETURNS TABLE (tenant_id uuid, draft_id uuid, available_at timestamp with time zone)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT draft."tenant_id", draft."id", draft."available_at"
  FROM public."ai_reply_drafts" AS draft
  JOIN public."tenant_reply_styles" AS style ON style."tenant_id" = draft."tenant_id" AND style."enabled" = TRUE
  WHERE (
    (draft."status" = 'QUEUED' AND draft."available_at" <= p_now AND draft."attempts" < 3)
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
  ORDER BY draft."available_at", draft."created_at", draft."id"
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 100);
$function$;

REVOKE ALL ON FUNCTION public.worker_due_ai_reply_drafts(timestamp with time zone, integer) FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
    REVOKE ALL ON FUNCTION public.worker_due_ai_reply_drafts(timestamp with time zone, integer) FROM autosale_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
    GRANT EXECUTE ON FUNCTION public.worker_due_ai_reply_drafts(timestamp with time zone, integer) TO autosale_worker;
  END IF;
END
$grants$;
