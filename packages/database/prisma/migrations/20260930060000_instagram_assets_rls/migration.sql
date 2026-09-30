ALTER TABLE "webhook_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY "webhook_events_tenant_isolation" ON "webhook_events"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

ALTER TABLE "instagram_customer_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "instagram_customer_profiles" FORCE ROW LEVEL SECURITY;

CREATE POLICY "instagram_customer_profiles_tenant_isolation" ON "instagram_customer_profiles"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;

CREATE POLICY "attachments_tenant_isolation" ON "attachments"
  USING (
    EXISTS (
      SELECT 1
      FROM public."messages" AS message
      WHERE message."id" = "attachments"."message_id"
        AND message."tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public."messages" AS message
      WHERE message."id" = "attachments"."message_id"
        AND message."tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  );

-- Recovery needs only routing identifiers. Payloads, messages, and attachment
-- URLs remain behind tenant-scoped RLS when the queued job executes.
CREATE FUNCTION public.worker_due_instagram_events(p_limit integer)
RETURNS TABLE (tenant_id uuid, event_id uuid, recovery_kind text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  WITH candidates AS (
    SELECT event."tenant_id", event."id" AS event_id, 'RECEIVED'::text AS recovery_kind,
           event."received_at" AS due_at, 0 AS priority
    FROM public."webhook_events" AS event
    WHERE event."provider" = 'META'
      AND event."status" = 'RECEIVED'

    UNION ALL

    SELECT message."tenant_id", message."raw_event_id" AS event_id, 'ATTACHMENT_BACKFILL'::text,
           MIN(message."source_timestamp") AS due_at, 1 AS priority
    FROM public."messages" AS message
    WHERE message."channel" = 'INSTAGRAM'
      AND message."raw_event_id" IS NOT NULL
      AND (
        (
          message."text" IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM public."attachments" AS attachment
            WHERE attachment."message_id" = message."id"
          )
        )
        OR EXISTS (
          SELECT 1 FROM public."attachments" AS attachment
          WHERE attachment."message_id" = message."id"
            AND attachment."type" = 'IMAGE'
            AND attachment."copy_status" = 'FAILED'
            AND attachment."failure_summary" IN (
              'Unsupported media type: video/mp4',
              'Media exceeds the configured byte ceiling'
            )
        )
      )
    GROUP BY message."tenant_id", message."raw_event_id"
  ), ranked AS (
    SELECT candidates.*,
           ROW_NUMBER() OVER (PARTITION BY candidates."tenant_id", candidates."event_id" ORDER BY priority) AS rank
    FROM candidates
  )
  SELECT ranked."tenant_id", ranked."event_id", ranked."recovery_kind"
  FROM ranked
  WHERE ranked.rank = 1
  ORDER BY ranked."due_at", ranked."event_id"
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 100);
$function$;

-- Refresh scheduling is deliberately folded into the bounded discovery
-- function so runtime workers never need an unscoped profile query or update.
CREATE FUNCTION public.worker_due_instagram_profiles(
  p_now timestamp with time zone,
  p_limit integer
)
RETURNS TABLE (
  tenant_id uuid,
  profile_id uuid
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  WITH refresh_candidates AS (
    SELECT profile."id"
    FROM public."instagram_customer_profiles" AS profile
    WHERE profile."status" IN ('READY', 'UNAVAILABLE')
      AND profile."refresh_after" <= p_now
    ORDER BY profile."refresh_after", profile."id"
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 100)
    FOR UPDATE SKIP LOCKED
  ), refreshed AS (
    UPDATE public."instagram_customer_profiles" AS profile
    SET "status" = 'PENDING',
        "next_attempt_at" = p_now,
        "refresh_version" = profile."refresh_version" + 1,
        "updated_at" = p_now
    FROM refresh_candidates
    WHERE profile."id" = refresh_candidates."id"
    RETURNING profile."tenant_id", profile."id", profile."next_attempt_at"
  ), due AS (
    SELECT profile."tenant_id", profile."id", profile."next_attempt_at"
    FROM public."instagram_customer_profiles" AS profile
    WHERE (
      profile."status" IN ('PENDING', 'RETRYABLE_FAILURE')
      AND profile."next_attempt_at" <= p_now
    ) OR (
      profile."status" = 'PROCESSING'
      AND profile."lease_expires_at" <= p_now
    )
    ORDER BY profile."next_attempt_at", profile."id"
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 100)
  )
  SELECT candidates."tenant_id", candidates."id"
  FROM (
    SELECT due."tenant_id", due."id", due."next_attempt_at" FROM due
    UNION
    SELECT refreshed."tenant_id", refreshed."id", refreshed."next_attempt_at" FROM refreshed
  ) AS candidates
  ORDER BY candidates."next_attempt_at", candidates."id"
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 100);
$function$;

REVOKE ALL ON FUNCTION public.worker_due_instagram_events(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.worker_due_instagram_profiles(timestamp with time zone, integer) FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
    REVOKE ALL ON FUNCTION public.worker_due_instagram_events(integer) FROM autosale_api;
    REVOKE ALL ON FUNCTION public.worker_due_instagram_profiles(timestamp with time zone, integer) FROM autosale_api;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
    GRANT EXECUTE ON FUNCTION public.worker_due_instagram_events(integer) TO autosale_worker;
    GRANT EXECUTE ON FUNCTION public.worker_due_instagram_profiles(timestamp with time zone, integer) TO autosale_worker;
  END IF;
END
$grants$;
