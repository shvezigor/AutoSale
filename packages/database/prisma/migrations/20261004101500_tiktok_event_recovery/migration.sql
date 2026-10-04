DROP FUNCTION public.worker_due_instagram_events(integer);

-- Recover durable social webhook events with the provider-specific worker job.
-- The historical function name is retained to avoid widening worker privileges.
CREATE FUNCTION public.worker_due_instagram_events(p_limit integer)
RETURNS TABLE (tenant_id uuid, event_id uuid, recovery_kind text, job_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  WITH candidates AS (
    SELECT event."tenant_id",
           event."id" AS event_id,
           'RECEIVED'::text AS recovery_kind,
           CASE
             WHEN event."provider" = 'TIKTOK' THEN 'tiktok.normalize'::text
             WHEN event."payload" ->> 'object' = 'page' THEN 'facebook.normalize'::text
             ELSE 'instagram.normalize'::text
           END AS job_name,
           event."received_at" AS due_at,
           0 AS priority
    FROM public."webhook_events" AS event
    WHERE event."provider" IN ('META', 'TIKTOK')
      AND event."status" = 'RECEIVED'

    UNION ALL

    SELECT message."tenant_id",
           message."raw_event_id" AS event_id,
           'ATTACHMENT_BACKFILL'::text,
           'instagram.normalize'::text,
           MIN(message."source_timestamp") AS due_at,
           1 AS priority
    FROM public."messages" AS message
    WHERE message."channel" = 'INSTAGRAM'
      AND message."raw_event_id" IS NOT NULL
      AND (
        (message."text" IS NULL AND NOT EXISTS (
          SELECT 1 FROM public."attachments" AS attachment WHERE attachment."message_id" = message."id"
        ))
        OR EXISTS (
          SELECT 1 FROM public."attachments" AS attachment
          WHERE attachment."message_id" = message."id"
            AND attachment."type" = 'IMAGE'
            AND attachment."copy_status" = 'FAILED'
            AND attachment."failure_summary" IN (
              'Unsupported media type: video/mp4', 'Media exceeds the configured byte ceiling'
            )
        )
      )
    GROUP BY message."tenant_id", message."raw_event_id"
  ), ranked AS (
    SELECT candidates.*,
           ROW_NUMBER() OVER (PARTITION BY candidates."tenant_id", candidates."event_id" ORDER BY priority) AS rank
    FROM candidates
  )
  SELECT ranked."tenant_id", ranked."event_id", ranked."recovery_kind", ranked."job_name"
  FROM ranked
  WHERE ranked.rank = 1
  ORDER BY ranked."due_at", ranked."event_id"
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 100);
$function$;

REVOKE ALL ON FUNCTION public.worker_due_instagram_events(integer) FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
    REVOKE ALL ON FUNCTION public.worker_due_instagram_events(integer) FROM autosale_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
    GRANT EXECUTE ON FUNCTION public.worker_due_instagram_events(integer) TO autosale_worker;
  END IF;
END
$grants$;
