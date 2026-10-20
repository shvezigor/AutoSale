CREATE TABLE public.marketing_daily_counters (
  day DATE NOT NULL,
  event TEXT NOT NULL,
  locale TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT marketing_daily_counters_pkey PRIMARY KEY (day, event, locale, plan_id),
  CONSTRAINT marketing_daily_counters_event_check CHECK (event IN ('pricing_view', 'registration_arrival', 'plan_interest')),
  CONSTRAINT marketing_daily_counters_locale_check CHECK (locale IN ('uk', 'en')),
  CONSTRAINT marketing_daily_counters_plan_check CHECK (plan_id IN ('none', 'start', 'growth', 'scale')),
  CONSTRAINT marketing_daily_counters_count_check CHECK (count >= 0)
);
CREATE INDEX marketing_daily_counters_day_event_idx ON public.marketing_daily_counters(day, event);

CREATE TABLE public.tenant_plan_interests (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL CHECK (plan_id IN ('start', 'growth', 'scale')),
  day DATE NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tenant_plan_interests_pkey PRIMARY KEY (id),
  CONSTRAINT tenant_plan_interests_tenant_plan_day_key UNIQUE (tenant_id, plan_id, day)
);
CREATE INDEX tenant_plan_interests_created_at_idx ON public.tenant_plan_interests(created_at);
ALTER TABLE public.tenant_plan_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_plan_interests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_plan_interests_isolation ON public.tenant_plan_interests
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE FUNCTION public.api_increment_marketing_counter(p_event text, p_locale text, p_plan_id text)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF p_event NOT IN ('pricing_view', 'registration_arrival', 'plan_interest')
    OR p_locale NOT IN ('uk', 'en')
    OR p_plan_id NOT IN ('none', 'start', 'growth', 'scale')
    OR (p_event = 'plan_interest' AND p_plan_id = 'none')
    OR (p_event <> 'plan_interest' AND p_plan_id <> 'none') THEN
    RAISE EXCEPTION 'INVALID_MARKETING_COUNTER';
  END IF;
  INSERT INTO public.marketing_daily_counters(day, event, locale, plan_id, count)
  VALUES ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, p_event, p_locale, p_plan_id, 1)
  ON CONFLICT (day, event, locale, plan_id)
  DO UPDATE SET count = public.marketing_daily_counters.count + 1;
  RETURN 1;
END
$function$;

REVOKE ALL ON FUNCTION public.api_increment_marketing_counter(text, text, text) FROM PUBLIC;
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
    REVOKE ALL ON TABLE public.marketing_daily_counters FROM autosale_api;
    GRANT EXECUTE ON FUNCTION public.api_increment_marketing_counter(text, text, text) TO autosale_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
    REVOKE ALL ON TABLE public.marketing_daily_counters FROM autosale_worker;
    REVOKE ALL ON FUNCTION public.api_increment_marketing_counter(text, text, text) FROM autosale_worker;
  END IF;
END
$grants$;
