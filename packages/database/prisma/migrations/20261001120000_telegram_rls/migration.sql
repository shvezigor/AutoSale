ALTER TABLE "telegram_link_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_link_attempts" FORCE ROW LEVEL SECURITY;

CREATE POLICY "telegram_link_attempts_tenant_isolation" ON "telegram_link_attempts"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "telegram_user_bindings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_user_bindings" FORCE ROW LEVEL SECURITY;

CREATE POLICY "telegram_user_bindings_tenant_isolation" ON "telegram_user_bindings"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "telegram_business_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_business_connections" FORCE ROW LEVEL SECURITY;

CREATE POLICY "telegram_business_connections_tenant_isolation" ON "telegram_business_connections"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "telegram_chats" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_chats" FORCE ROW LEVEL SECURITY;

CREATE POLICY "telegram_chats_tenant_isolation" ON "telegram_chats"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "telegram_supplier_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_supplier_settings" FORCE ROW LEVEL SECURITY;

CREATE POLICY "telegram_supplier_settings_tenant_isolation" ON "telegram_supplier_settings"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "telegram_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_deliveries" FORCE ROW LEVEL SECURITY;

CREATE POLICY "telegram_deliveries_tenant_isolation" ON "telegram_deliveries"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "telegram_delivery_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_delivery_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY "telegram_delivery_items_tenant_isolation" ON "telegram_delivery_items"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "telegram_notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_notification_preferences" FORCE ROW LEVEL SECURITY;

CREATE POLICY "telegram_notification_preferences_tenant_isolation" ON "telegram_notification_preferences"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- A Telegram start token is a high-entropy bearer secret. Consumption is
-- atomic, purpose-bound, and reveals only the tenant and attempt identifiers.
CREATE FUNCTION public.api_consume_telegram_link_attempt(
  p_token_hash text,
  p_expected_purpose text,
  p_consumed_at timestamp with time zone
)
RETURNS TABLE (tenant_id uuid, attempt_id uuid)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  UPDATE public."telegram_link_attempts" AS attempt
  SET "used_at" = p_consumed_at
  WHERE p_expected_purpose IN ('PERSONAL', 'SUPPLIER_GROUP')
    AND attempt."token_hash" = p_token_hash
    AND attempt."purpose"::text = p_expected_purpose
    AND attempt."used_at" IS NULL
    AND attempt."expires_at" > p_consumed_at
  RETURNING attempt."tenant_id", attempt."id";
$function$;

-- Business connection callbacks identify the Telegram user before a tenant is
-- known. Ambiguous bindings fail closed and expose no profile or chat data.
CREATE FUNCTION public.api_telegram_tenant_for_user(p_telegram_user_id text)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT max(binding."tenant_id"::text)::uuid AS tenant_id
  FROM public."telegram_user_bindings" AS binding
  WHERE binding."telegram_user_id" = p_telegram_user_id
    AND binding."revoked_at" IS NULL
  HAVING count(*) = 1;
$function$;

-- Business messages carry only the provider connection identifier. Resolve it
-- to one enabled tenant or fail closed when the identifier is ambiguous.
CREATE FUNCTION public.api_telegram_tenant_for_business_connection(p_external_connection_id text)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT max(connection."tenant_id"::text)::uuid AS tenant_id
  FROM public."telegram_business_connections" AS connection
  WHERE connection."external_connection_id" = p_external_connection_id
    AND connection."enabled" = true
  HAVING count(*) = 1;
$function$;

-- Queue jobs contain opaque delivery IDs. The worker receives only routing
-- authority and purpose; Telegram destination and message content remain RLS protected.
CREATE FUNCTION public.worker_telegram_tenants_for_deliveries(p_delivery_ids uuid[])
RETURNS TABLE (tenant_id uuid, delivery_id uuid, purpose text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF p_delivery_ids IS NULL
     OR cardinality(p_delivery_ids) < 1
     OR cardinality(p_delivery_ids) > 50 THEN
    RAISE EXCEPTION 'delivery id batch must contain between 1 and 50 entries'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT delivery."tenant_id", delivery."id", delivery."purpose"::text
  FROM public."telegram_deliveries" AS delivery
  JOIN (
    SELECT DISTINCT requested_id
    FROM unnest(p_delivery_ids) AS requested(requested_id)
  ) AS requested ON requested.requested_id = delivery."id"
  ORDER BY delivery."id";
END
$function$;

-- Reconciliation discovers only bounded durable routing identifiers.
CREATE FUNCTION public.worker_due_telegram_deliveries(
  p_now timestamp with time zone,
  p_limit integer
)
RETURNS TABLE (tenant_id uuid, delivery_id uuid, purpose text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT delivery."tenant_id", delivery."id", delivery."purpose"::text
  FROM public."telegram_deliveries" AS delivery
  WHERE (
    delivery."status"::text IN ('PENDING', 'RETRYABLE')
    AND delivery."next_attempt_at" <= p_now
  ) OR (
    delivery."status"::text = 'PROCESSING'
    AND delivery."lease_expires_at" <= p_now
  )
  ORDER BY delivery."next_attempt_at", delivery."created_at", delivery."id"
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 50);
$function$;

REVOKE ALL ON FUNCTION public.api_consume_telegram_link_attempt(text, text, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_telegram_tenant_for_user(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_telegram_tenant_for_business_connection(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.worker_telegram_tenants_for_deliveries(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.worker_due_telegram_deliveries(timestamp with time zone, integer) FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
    GRANT EXECUTE ON FUNCTION public.api_consume_telegram_link_attempt(text, text, timestamp with time zone) TO autosale_api;
    GRANT EXECUTE ON FUNCTION public.api_telegram_tenant_for_user(text) TO autosale_api;
    GRANT EXECUTE ON FUNCTION public.api_telegram_tenant_for_business_connection(text) TO autosale_api;
    REVOKE ALL ON FUNCTION public.worker_telegram_tenants_for_deliveries(uuid[]) FROM autosale_api;
    REVOKE ALL ON FUNCTION public.worker_due_telegram_deliveries(timestamp with time zone, integer) FROM autosale_api;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
    REVOKE ALL ON FUNCTION public.api_consume_telegram_link_attempt(text, text, timestamp with time zone) FROM autosale_worker;
    REVOKE ALL ON FUNCTION public.api_telegram_tenant_for_user(text) FROM autosale_worker;
    REVOKE ALL ON FUNCTION public.api_telegram_tenant_for_business_connection(text) FROM autosale_worker;
    GRANT EXECUTE ON FUNCTION public.worker_telegram_tenants_for_deliveries(uuid[]) TO autosale_worker;
    GRANT EXECUTE ON FUNCTION public.worker_due_telegram_deliveries(timestamp with time zone, integer) TO autosale_worker;
  END IF;
END
$grants$;
