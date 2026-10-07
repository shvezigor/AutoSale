import pg from 'pg';

export interface RuntimeDatabaseRolePasswords {
  apiPassword: string;
  workerPassword: string;
  backupPassword: string;
}

export interface RuntimeDatabaseRoleConfig {
  connectionString: string;
  passwords: RuntimeDatabaseRolePasswords;
}

export function runtimeDatabaseRoleConfigFromEnv(
  environment: Record<string, string | undefined>,
): RuntimeDatabaseRoleConfig {
  const connectionString = requiredEnvironmentValue(environment, 'DATABASE_URL');
  const apiPassword = requiredEnvironmentValue(environment, 'POSTGRES_API_PASSWORD');
  const workerPassword = requiredEnvironmentValue(environment, 'POSTGRES_WORKER_PASSWORD');
  const backupPassword = requiredEnvironmentValue(environment, 'POSTGRES_BACKUP_PASSWORD');

  return { connectionString, passwords: { apiPassword, workerPassword, backupPassword } };
}

export async function configureRuntimeDatabaseRoles(
  connectionString: string,
  passwords: RuntimeDatabaseRolePasswords,
): Promise<void> {
  const configuredPasswords = [passwords.apiPassword, passwords.workerPassword, passwords.backupPassword];
  if (configuredPasswords.some((password) => password.length < 32)) {
    throw new Error('Database role passwords must contain at least 32 characters');
  }
  if (configuredPasswords.some((password) => !/^[A-Za-z0-9_-]+$/.test(password))) {
    throw new Error('Database role passwords must use URL-safe letters, digits, underscore, or hyphen');
  }
  if (new Set(configuredPasswords).size !== configuredPasswords.length) {
    throw new Error('API, worker, and backup database passwords must be different');
  }
  const ownerPassword = decodeURIComponent(new URL(connectionString).password);
  if (ownerPassword && configuredPasswords.includes(ownerPassword)) {
    throw new Error('Database role passwords must be different from the owner password');
  }

  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('autosale.bootstrap.api_password', $1, true)", [passwords.apiPassword]);
    await client.query("SELECT set_config('autosale.bootstrap.worker_password', $1, true)", [passwords.workerPassword]);
    await client.query("SELECT set_config('autosale.bootstrap.backup_password', $1, true)", [passwords.backupPassword]);
    await client.query(`
      DO $roles$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
          CREATE ROLE autosale_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
          CREATE ROLE autosale_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_backup') THEN
          CREATE ROLE autosale_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
        END IF;

        EXECUTE format(
          'ALTER ROLE autosale_api WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
          current_setting('autosale.bootstrap.api_password')
        );
        EXECUTE format(
          'ALTER ROLE autosale_worker WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
          current_setting('autosale.bootstrap.worker_password')
        );
        EXECUTE format(
          'ALTER ROLE autosale_backup WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS PASSWORD %L',
          current_setting('autosale.bootstrap.backup_password')
        );
        EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
        EXECUTE format('GRANT CONNECT ON DATABASE %I TO autosale_api, autosale_worker, autosale_backup', current_database());
        EXECUTE format('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM autosale_api, autosale_worker, autosale_backup', current_database());
      END
      $roles$;

      REVOKE CREATE ON SCHEMA public FROM PUBLIC, autosale_api, autosale_worker, autosale_backup;
      GRANT USAGE ON SCHEMA public TO autosale_api, autosale_worker, autosale_backup;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO autosale_api, autosale_worker;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO autosale_backup;
      GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO autosale_api, autosale_worker;
      GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO autosale_backup;
      REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM autosale_backup;
      REVOKE USAGE, UPDATE ON ALL SEQUENCES IN SCHEMA public FROM autosale_backup;
      REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
      REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM autosale_backup;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO autosale_api, autosale_worker;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT ON TABLES TO autosale_backup;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO autosale_api, autosale_worker;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT ON SEQUENCES TO autosale_backup;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
      DO $platform_flags$
      BEGIN
        IF to_regclass('public.platform_feature_flags') IS NOT NULL THEN
          REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
            ON TABLE public.platform_feature_flags FROM autosale_worker, autosale_backup;
          GRANT SELECT ON TABLE public.platform_feature_flags TO autosale_worker, autosale_backup;
          GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.platform_feature_flags TO autosale_api;
        END IF;
      END
      $platform_flags$;
      DO $functions$
      BEGIN
        IF to_regprocedure('public.autosale_order_prefix(text)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.autosale_order_prefix(text) TO autosale_api, autosale_worker;
          REVOKE ALL ON FUNCTION public.autosale_order_prefix(text) FROM autosale_backup;
        END IF;
        IF to_regprocedure('public.api_platform_create_tenant_lifecycle_request(uuid,uuid,text,text,uuid,text,timestamp with time zone)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_platform_create_tenant_lifecycle_request(uuid, uuid, text, text, uuid, text, timestamp with time zone) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_platform_create_tenant_lifecycle_request(uuid, uuid, text, text, uuid, text, timestamp with time zone) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.api_platform_tenant_lifecycle_requests(uuid)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_platform_tenant_lifecycle_requests(uuid) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_platform_tenant_lifecycle_requests(uuid) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.api_platform_tenant_lifecycle_request(uuid,uuid)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_platform_tenant_lifecycle_request(uuid, uuid) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_platform_tenant_lifecycle_request(uuid, uuid) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.api_platform_cancel_tenant_lifecycle_request(uuid,uuid,timestamp with time zone)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_platform_cancel_tenant_lifecycle_request(uuid, uuid, timestamp with time zone) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_platform_cancel_tenant_lifecycle_request(uuid, uuid, timestamp with time zone) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.api_platform_retry_tenant_lifecycle_request(uuid,uuid,timestamp with time zone)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_platform_retry_tenant_lifecycle_request(uuid, uuid, timestamp with time zone) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_platform_retry_tenant_lifecycle_request(uuid, uuid, timestamp with time zone) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.api_platform_create_retention_dry_run(uuid,uuid,uuid,text,timestamp with time zone)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_platform_create_retention_dry_run(uuid, uuid, uuid, text, timestamp with time zone) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_platform_create_retention_dry_run(uuid, uuid, uuid, text, timestamp with time zone) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.api_platform_retention_dry_runs(uuid,uuid)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_platform_retention_dry_runs(uuid, uuid) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_platform_retention_dry_runs(uuid, uuid) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.worker_due_tenant_lifecycle_requests(timestamp with time zone,integer)') IS NOT NULL THEN
          REVOKE ALL ON FUNCTION public.worker_due_tenant_lifecycle_requests(timestamp with time zone, integer) FROM autosale_api;
          GRANT EXECUTE ON FUNCTION public.worker_due_tenant_lifecycle_requests(timestamp with time zone, integer) TO autosale_worker;
        END IF;
        IF to_regprocedure('public.worker_due_tenant_lifecycle_artifact_cleanups(timestamp with time zone,integer)') IS NOT NULL THEN
          REVOKE ALL ON FUNCTION public.worker_due_tenant_lifecycle_artifact_cleanups(timestamp with time zone, integer) FROM autosale_api;
          GRANT EXECUTE ON FUNCTION public.worker_due_tenant_lifecycle_artifact_cleanups(timestamp with time zone, integer) TO autosale_worker;
        END IF;
        IF to_regprocedure('public.worker_due_retention_dry_runs(timestamp with time zone,integer)') IS NOT NULL THEN
          REVOKE ALL ON FUNCTION public.worker_due_retention_dry_runs(timestamp with time zone, integer) FROM autosale_api;
          GRANT EXECUTE ON FUNCTION public.worker_due_retention_dry_runs(timestamp with time zone, integer) TO autosale_worker;
        END IF;
        IF to_regprocedure('public.platform_order_counts()') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.platform_order_counts() TO autosale_api;
          REVOKE ALL ON FUNCTION public.platform_order_counts() FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.worker_due_instagram_messages(timestamp with time zone,integer)') IS NOT NULL THEN
          REVOKE ALL ON FUNCTION public.worker_due_instagram_messages(timestamp with time zone, integer) FROM autosale_api;
          GRANT EXECUTE ON FUNCTION public.worker_due_instagram_messages(timestamp with time zone, integer) TO autosale_worker;
        END IF;
        IF to_regprocedure('public.worker_due_ai_reply_drafts(timestamp with time zone,integer)') IS NOT NULL THEN
          REVOKE ALL ON FUNCTION public.worker_due_ai_reply_drafts(timestamp with time zone, integer) FROM autosale_api;
          GRANT EXECUTE ON FUNCTION public.worker_due_ai_reply_drafts(timestamp with time zone, integer) TO autosale_worker;
        END IF;
        IF to_regprocedure('public.worker_fail_expired_ai_reply_drafts(timestamp with time zone,integer)') IS NOT NULL THEN
          REVOKE ALL ON FUNCTION public.worker_fail_expired_ai_reply_drafts(timestamp with time zone, integer) FROM autosale_api;
          GRANT EXECUTE ON FUNCTION public.worker_fail_expired_ai_reply_drafts(timestamp with time zone, integer) TO autosale_worker;
        END IF;
        IF to_regprocedure('public.worker_instagram_attachment_backfill_events(integer)') IS NOT NULL THEN
          REVOKE ALL ON FUNCTION public.worker_instagram_attachment_backfill_events(integer) FROM autosale_api;
          GRANT EXECUTE ON FUNCTION public.worker_instagram_attachment_backfill_events(integer) TO autosale_worker;
        END IF;
        IF to_regprocedure('public.worker_due_instagram_events(integer)') IS NOT NULL THEN
          REVOKE ALL ON FUNCTION public.worker_due_instagram_events(integer) FROM autosale_api;
          GRANT EXECUTE ON FUNCTION public.worker_due_instagram_events(integer) TO autosale_worker;
        END IF;
        IF to_regprocedure('public.worker_due_instagram_profiles(timestamp with time zone,integer)') IS NOT NULL THEN
          REVOKE ALL ON FUNCTION public.worker_due_instagram_profiles(timestamp with time zone, integer) FROM autosale_api;
          GRANT EXECUTE ON FUNCTION public.worker_due_instagram_profiles(timestamp with time zone, integer) TO autosale_worker;
        END IF;
        IF to_regprocedure('public.api_instagram_tenant_for_account(text)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_instagram_tenant_for_account(text) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_instagram_tenant_for_account(text) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.api_consume_instagram_oauth_state(text,timestamp with time zone)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_consume_instagram_oauth_state(text, timestamp with time zone) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_consume_instagram_oauth_state(text, timestamp with time zone) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.api_facebook_tenant_for_page(text)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_facebook_tenant_for_page(text) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_facebook_tenant_for_page(text) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.api_consume_facebook_oauth_attempt(text,timestamp with time zone)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_consume_facebook_oauth_attempt(text, timestamp with time zone) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_consume_facebook_oauth_attempt(text, timestamp with time zone) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.api_tiktok_tenant_for_account(text)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_tiktok_tenant_for_account(text) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_tiktok_tenant_for_account(text) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.api_consume_tiktok_oauth_attempt(text,timestamp with time zone)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_consume_tiktok_oauth_attempt(text, timestamp with time zone) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_consume_tiktok_oauth_attempt(text, timestamp with time zone) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.worker_due_instagram_avatar_cleanups(timestamp with time zone,integer)') IS NOT NULL THEN
          REVOKE ALL ON FUNCTION public.worker_due_instagram_avatar_cleanups(timestamp with time zone, integer) FROM autosale_api;
          GRANT EXECUTE ON FUNCTION public.worker_due_instagram_avatar_cleanups(timestamp with time zone, integer) TO autosale_worker;
        END IF;
        IF to_regprocedure('public.api_consume_google_oauth_attempt(text,timestamp with time zone)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_consume_google_oauth_attempt(text, timestamp with time zone) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_consume_google_oauth_attempt(text, timestamp with time zone) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.api_due_google_credential_cleanups(integer)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_due_google_credential_cleanups(integer) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_due_google_credential_cleanups(integer) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.worker_due_catalogue_sources(timestamp with time zone,uuid,integer)') IS NOT NULL THEN
          REVOKE ALL ON FUNCTION public.worker_due_catalogue_sources(timestamp with time zone, uuid, integer) FROM autosale_api;
          GRANT EXECUTE ON FUNCTION public.worker_due_catalogue_sources(timestamp with time zone, uuid, integer) TO autosale_worker;
        END IF;
        IF to_regprocedure('public.worker_due_catalogue_mapping_runs(timestamp with time zone,integer)') IS NOT NULL THEN
          REVOKE ALL ON FUNCTION public.worker_due_catalogue_mapping_runs(timestamp with time zone, integer) FROM autosale_api;
          GRANT EXECUTE ON FUNCTION public.worker_due_catalogue_mapping_runs(timestamp with time zone, integer) TO autosale_worker;
        END IF;
        IF to_regprocedure('public.worker_delivery_tenants_for_shipments(uuid[])') IS NOT NULL THEN
          REVOKE ALL ON FUNCTION public.worker_delivery_tenants_for_shipments(uuid[]) FROM autosale_api;
          GRANT EXECUTE ON FUNCTION public.worker_delivery_tenants_for_shipments(uuid[]) TO autosale_worker;
        END IF;
        IF to_regprocedure('public.worker_due_shipment_attempts(timestamp with time zone,text,integer)') IS NOT NULL THEN
          REVOKE ALL ON FUNCTION public.worker_due_shipment_attempts(timestamp with time zone, text, integer) FROM autosale_api;
          GRANT EXECUTE ON FUNCTION public.worker_due_shipment_attempts(timestamp with time zone, text, integer) TO autosale_worker;
        END IF;
        IF to_regprocedure('public.worker_due_shipment_statuses(timestamp with time zone,text,integer)') IS NOT NULL THEN
          REVOKE ALL ON FUNCTION public.worker_due_shipment_statuses(timestamp with time zone, text, integer) FROM autosale_api;
          GRANT EXECUTE ON FUNCTION public.worker_due_shipment_statuses(timestamp with time zone, text, integer) TO autosale_worker;
        END IF;
        IF to_regprocedure('public.api_consume_telegram_link_attempt(text,text,timestamp with time zone)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_consume_telegram_link_attempt(text, text, timestamp with time zone) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_consume_telegram_link_attempt(text, text, timestamp with time zone) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.api_telegram_tenant_for_user(text)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_telegram_tenant_for_user(text) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_telegram_tenant_for_user(text) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.api_telegram_tenant_for_business_connection(text)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_telegram_tenant_for_business_connection(text) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_telegram_tenant_for_business_connection(text) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.worker_telegram_tenants_for_deliveries(uuid[])') IS NOT NULL THEN
          REVOKE ALL ON FUNCTION public.worker_telegram_tenants_for_deliveries(uuid[]) FROM autosale_api;
          GRANT EXECUTE ON FUNCTION public.worker_telegram_tenants_for_deliveries(uuid[]) TO autosale_worker;
        END IF;
        IF to_regprocedure('public.worker_due_telegram_deliveries(timestamp with time zone,integer)') IS NOT NULL THEN
          REVOKE ALL ON FUNCTION public.worker_due_telegram_deliveries(timestamp with time zone, integer) FROM autosale_api;
          GRANT EXECUTE ON FUNCTION public.worker_due_telegram_deliveries(timestamp with time zone, integer) TO autosale_worker;
        END IF;
        IF to_regprocedure('public.worker_expired_user_notifications(timestamp with time zone,integer)') IS NOT NULL THEN
          REVOKE ALL ON FUNCTION public.worker_expired_user_notifications(timestamp with time zone, integer) FROM autosale_api;
          GRANT EXECUTE ON FUNCTION public.worker_expired_user_notifications(timestamp with time zone, integer) TO autosale_worker;
        END IF;
        IF to_regprocedure('public.worker_due_order_exports(integer)') IS NOT NULL THEN
          REVOKE ALL ON FUNCTION public.worker_due_order_exports(integer) FROM autosale_api;
          GRANT EXECUTE ON FUNCTION public.worker_due_order_exports(integer) TO autosale_worker;
        END IF;
        IF to_regprocedure('public.api_append_platform_security_audit_log(uuid,text,text,text,jsonb)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_append_platform_security_audit_log(uuid, text, text, text, jsonb) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_append_platform_security_audit_log(uuid, text, text, text, jsonb) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.api_active_membership_for_user(uuid)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_active_membership_for_user(uuid) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_active_membership_for_user(uuid) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.api_invitation_authority(text,timestamp with time zone)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_invitation_authority(text, timestamp with time zone) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_invitation_authority(text, timestamp with time zone) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.api_activate_owner_memberships(uuid)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_activate_owner_memberships(uuid) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_activate_owner_memberships(uuid) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.api_issue_session(uuid,uuid,uuid,text,timestamp with time zone,text,text)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_issue_session(uuid, uuid, uuid, text, timestamp with time zone, text, text) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_issue_session(uuid, uuid, uuid, text, timestamp with time zone, text, text) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.api_resolve_session(text,timestamp with time zone)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_resolve_session(text, timestamp with time zone) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_resolve_session(text, timestamp with time zone) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.api_revoke_session(uuid,timestamp with time zone)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_revoke_session(uuid, timestamp with time zone) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_revoke_session(uuid, timestamp with time zone) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.api_revoke_sessions(uuid,uuid,uuid,timestamp with time zone)') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.api_revoke_sessions(uuid, uuid, uuid, timestamp with time zone) TO autosale_api;
          REVOKE ALL ON FUNCTION public.api_revoke_sessions(uuid, uuid, uuid, timestamp with time zone) FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.platform_tenant_directory()') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.platform_tenant_directory() TO autosale_api;
          REVOKE ALL ON FUNCTION public.platform_tenant_directory() FROM autosale_worker;
        END IF;
      END
      $functions$;
    `);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

function requiredEnvironmentValue(
  environment: Record<string, string | undefined>,
  name: string,
): string {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
