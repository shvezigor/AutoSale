CREATE TABLE "platform_feature_flags" (
  "key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "updated_by_user_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_feature_flags_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "platform_feature_flags_key_check"
    CHECK ("key" IN ('FACEBOOK_MESSENGER', 'TIKTOK_BUSINESS_MESSAGING')),
  CONSTRAINT "platform_feature_flags_updated_by_user_id_fkey"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.platform_feature_flags TO autosale_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
      ON TABLE public.platform_feature_flags FROM autosale_worker;
    GRANT SELECT ON TABLE public.platform_feature_flags TO autosale_worker;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_backup') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
      ON TABLE public.platform_feature_flags FROM autosale_backup;
    GRANT SELECT ON TABLE public.platform_feature_flags TO autosale_backup;
  END IF;
END
$roles$;
