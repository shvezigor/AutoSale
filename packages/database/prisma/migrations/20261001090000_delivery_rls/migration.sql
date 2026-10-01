ALTER TABLE "delivery_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "delivery_connections" FORCE ROW LEVEL SECURITY;

CREATE POLICY "delivery_connections_tenant_isolation" ON "delivery_connections"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

ALTER TABLE "delivery_sender_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "delivery_sender_profiles" FORCE ROW LEVEL SECURITY;

CREATE POLICY "delivery_sender_profiles_tenant_isolation" ON "delivery_sender_profiles"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

ALTER TABLE "shipments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shipments" FORCE ROW LEVEL SECURITY;

CREATE POLICY "shipments_tenant_isolation" ON "shipments"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

ALTER TABLE "shipment_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shipment_attempts" FORCE ROW LEVEL SECURITY;

CREATE POLICY "shipment_attempts_tenant_isolation" ON "shipment_attempts"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

ALTER TABLE "shipment_status_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shipment_status_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY "shipment_status_events_tenant_isolation" ON "shipment_status_events"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- Delivery jobs contain opaque shipment IDs only. This bounded function lets the
-- worker derive tenant authority from the database before opening an RLS-scoped
-- transaction; no customer, credential or parcel data crosses this boundary.
CREATE FUNCTION public.worker_delivery_tenants_for_shipments(p_shipment_ids uuid[])
RETURNS TABLE (tenant_id uuid, shipment_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF p_shipment_ids IS NULL
     OR cardinality(p_shipment_ids) < 1
     OR cardinality(p_shipment_ids) > 50 THEN
    RAISE EXCEPTION 'shipment id batch must contain between 1 and 50 entries'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT shipment."tenant_id", shipment."id"
  FROM public."shipments" AS shipment
  JOIN (
    SELECT DISTINCT requested_id
    FROM unnest(p_shipment_ids) AS requested(requested_id)
  ) AS requested ON requested.requested_id = shipment."id"
  ORDER BY shipment."id";
END
$function$;

-- Cross-tenant reconciliation receives only durable routing IDs and versions.
CREATE FUNCTION public.worker_due_shipment_attempts(
  p_now timestamp with time zone,
  p_operation text,
  p_limit integer
)
RETURNS TABLE (tenant_id uuid, shipment_id uuid, version integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT attempt."tenant_id", attempt."shipment_id", attempt."version"
  FROM public."shipment_attempts" AS attempt
  JOIN public."shipments" AS shipment
    ON shipment."tenant_id" = attempt."tenant_id"
   AND shipment."id" = attempt."shipment_id"
  WHERE p_operation IN ('CREATE', 'CANCEL')
    AND attempt."operation"::text = p_operation
    AND (
      (
        attempt."status"::text IN ('PENDING', 'RETRYABLE')
        OR (p_operation = 'CREATE' AND attempt."status"::text = 'UNKNOWN')
      )
      AND attempt."next_attempt_at" <= p_now
      OR (
        attempt."status"::text = 'PROCESSING'
        AND attempt."lease_expires_at" <= p_now
      )
    )
    AND (p_operation <> 'CREATE' OR shipment."status"::text = 'CREATING')
  ORDER BY attempt."next_attempt_at", attempt."created_at", attempt."id"
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 50);
$function$;

CREATE FUNCTION public.worker_due_shipment_statuses(
  p_now timestamp with time zone,
  p_provider_group text,
  p_limit integer
)
RETURNS TABLE (tenant_id uuid, shipment_id uuid, version integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT shipment."tenant_id", shipment."id", shipment."version"
  FROM public."shipments" AS shipment
  WHERE p_provider_group IN ('STANDARD', 'UKRPOSHTA')
    AND shipment."status"::text IN ('CREATED', 'ACCEPTED', 'IN_TRANSIT', 'RETURNING')
    AND shipment."tracking_number" IS NOT NULL
    AND shipment."next_status_check_at" <= p_now
    AND (
      (p_provider_group = 'UKRPOSHTA' AND shipment."provider"::text = 'UKRPOSHTA')
      OR (p_provider_group = 'STANDARD' AND shipment."provider"::text <> 'UKRPOSHTA')
    )
  ORDER BY shipment."next_status_check_at", shipment."id"
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 250);
$function$;

REVOKE ALL ON FUNCTION public.worker_delivery_tenants_for_shipments(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.worker_due_shipment_attempts(timestamp with time zone, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.worker_due_shipment_statuses(timestamp with time zone, text, integer) FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
    GRANT EXECUTE ON FUNCTION public.worker_delivery_tenants_for_shipments(uuid[]) TO autosale_worker;
    GRANT EXECUTE ON FUNCTION public.worker_due_shipment_attempts(timestamp with time zone, text, integer) TO autosale_worker;
    GRANT EXECUTE ON FUNCTION public.worker_due_shipment_statuses(timestamp with time zone, text, integer) TO autosale_worker;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
    REVOKE ALL ON FUNCTION public.worker_delivery_tenants_for_shipments(uuid[]) FROM autosale_api;
    REVOKE ALL ON FUNCTION public.worker_due_shipment_attempts(timestamp with time zone, text, integer) FROM autosale_api;
    REVOKE ALL ON FUNCTION public.worker_due_shipment_statuses(timestamp with time zone, text, integer) FROM autosale_api;
  END IF;
END
$grants$;
