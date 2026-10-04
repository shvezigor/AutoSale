CREATE FUNCTION public.worker_mark_stale_tiktok_messages_unknown(
  p_now timestamp with time zone,
  p_limit integer
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  changed integer;
BEGIN
  WITH stale AS (
    SELECT message."id"
    FROM public."messages" AS message
    WHERE message."channel" = 'TIKTOK'
      AND message."direction" = 'OUTBOUND'
      AND message."delivery_status" = 'SENDING'
      AND message."delivery_lease_expires_at" <= p_now
    ORDER BY message."delivery_lease_expires_at" ASC, message."id" ASC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 100)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public."messages" AS message
  SET
    "delivery_status" = 'UNKNOWN',
    "delivery_error_code" = 'TIKTOK_DELIVERY_UNKNOWN',
    "delivery_lease_id" = NULL,
    "delivery_lease_expires_at" = NULL,
    "next_delivery_attempt_at" = NULL
  FROM stale
  WHERE message."id" = stale."id";

  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END
$function$;

-- The original discovery function predates multiple outbound social channels.
-- Keep Instagram wake-ups strictly channel-scoped now that TikTok also uses
-- the shared messages table and BullMQ queue.
CREATE OR REPLACE FUNCTION public.worker_due_instagram_messages(
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
  WHERE message."channel" = 'INSTAGRAM'
    AND message."direction" = 'OUTBOUND'
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

CREATE FUNCTION public.worker_due_tiktok_messages(
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
  WHERE message."channel" = 'TIKTOK'
    AND message."direction" = 'OUTBOUND'
    AND message."delivery_status" = 'PENDING'
    AND message."next_delivery_attempt_at" <= p_now
    AND message."delivery_lease_id" IS NULL
  ORDER BY message."next_delivery_attempt_at" ASC, message."created_at" ASC, message."id" ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 100);
$function$;

REVOKE ALL ON FUNCTION public.worker_mark_stale_tiktok_messages_unknown(timestamp with time zone, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.worker_due_tiktok_messages(timestamp with time zone, integer) FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
    REVOKE ALL ON FUNCTION public.worker_mark_stale_tiktok_messages_unknown(timestamp with time zone, integer) FROM autosale_api;
    REVOKE ALL ON FUNCTION public.worker_due_tiktok_messages(timestamp with time zone, integer) FROM autosale_api;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
    GRANT EXECUTE ON FUNCTION public.worker_mark_stale_tiktok_messages_unknown(timestamp with time zone, integer) TO autosale_worker;
    GRANT EXECUTE ON FUNCTION public.worker_due_tiktok_messages(timestamp with time zone, integer) TO autosale_worker;
  END IF;
END
$grants$;
