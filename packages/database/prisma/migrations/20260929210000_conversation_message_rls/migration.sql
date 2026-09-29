ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;

CREATE POLICY "conversations_tenant_isolation" ON "conversations"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;

CREATE POLICY "messages_tenant_isolation" ON "messages"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- The worker needs a bounded, cross-tenant discovery surface for messages that
-- are ready to send. It receives technical identifiers only; message content
-- and customer data remain protected by RLS and must be loaded in tenant scope.
CREATE FUNCTION public.worker_due_instagram_messages(
  p_now timestamp with time zone,
  p_limit integer
)
RETURNS TABLE (tenant_id uuid, message_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT message."tenant_id", message."id"
  FROM public."messages" AS message
  WHERE message."direction" = 'OUTBOUND'
    AND (
      (
        message."delivery_status" = 'PENDING'
        AND message."next_delivery_attempt_at" <= p_now
      )
      OR (
        message."delivery_status" = 'SENDING'
        AND message."delivery_lease_expires_at" <= p_now
      )
    )
  ORDER BY
    message."next_delivery_attempt_at" ASC NULLS LAST,
    message."created_at" ASC,
    message."id" ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 100);
$function$;

-- Legacy attachment recovery also uses an ID-only discovery surface. The
-- original webhook event is subsequently processed inside its tenant scope.
CREATE FUNCTION public.worker_instagram_attachment_backfill_events(
  p_limit integer
)
RETURNS TABLE (event_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT message."raw_event_id" AS event_id
  FROM public."messages" AS message
  WHERE message."channel" = 'INSTAGRAM'
    AND message."raw_event_id" IS NOT NULL
    AND (
      (
        message."text" IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public."attachments" AS attachment
          WHERE attachment."message_id" = message."id"
        )
      )
      OR EXISTS (
        SELECT 1
        FROM public."attachments" AS attachment
        WHERE attachment."message_id" = message."id"
          AND attachment."type" = 'IMAGE'
          AND attachment."copy_status" = 'FAILED'
          AND attachment."failure_summary" IN (
            'Unsupported media type: video/mp4',
            'Media exceeds the configured byte ceiling'
          )
      )
    )
  GROUP BY message."raw_event_id"
  ORDER BY MIN(message."source_timestamp") ASC, message."raw_event_id" ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 100);
$function$;

REVOKE ALL ON FUNCTION public.worker_due_instagram_messages(timestamp with time zone, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.worker_instagram_attachment_backfill_events(integer) FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
    REVOKE ALL ON FUNCTION public.worker_due_instagram_messages(timestamp with time zone, integer) FROM autosale_api;
    REVOKE ALL ON FUNCTION public.worker_instagram_attachment_backfill_events(integer) FROM autosale_api;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
    GRANT EXECUTE ON FUNCTION public.worker_due_instagram_messages(timestamp with time zone, integer) TO autosale_worker;
    GRANT EXECUTE ON FUNCTION public.worker_instagram_attachment_backfill_events(integer) TO autosale_worker;
  END IF;
END
$grants$;
