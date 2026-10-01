import pg from 'pg';

export interface RuntimeDatabaseRolePasswords {
  apiPassword: string;
  workerPassword: string;
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

  return { connectionString, passwords: { apiPassword, workerPassword } };
}

export async function configureRuntimeDatabaseRoles(
  connectionString: string,
  passwords: RuntimeDatabaseRolePasswords,
): Promise<void> {
  if (passwords.apiPassword.length < 32 || passwords.workerPassword.length < 32) {
    throw new Error('Runtime database passwords must contain at least 32 characters');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(passwords.apiPassword) || !/^[A-Za-z0-9_-]+$/.test(passwords.workerPassword)) {
    throw new Error('Runtime database passwords must use URL-safe letters, digits, underscore, or hyphen');
  }
  if (passwords.apiPassword === passwords.workerPassword) {
    throw new Error('API and worker database passwords must be different');
  }

  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('autosale.bootstrap.api_password', $1, true)", [passwords.apiPassword]);
    await client.query("SELECT set_config('autosale.bootstrap.worker_password', $1, true)", [passwords.workerPassword]);
    await client.query(`
      DO $roles$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_api') THEN
          CREATE ROLE autosale_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autosale_worker') THEN
          CREATE ROLE autosale_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        END IF;

        EXECUTE format(
          'ALTER ROLE autosale_api WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
          current_setting('autosale.bootstrap.api_password')
        );
        EXECUTE format(
          'ALTER ROLE autosale_worker WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
          current_setting('autosale.bootstrap.worker_password')
        );
        EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
        EXECUTE format('GRANT CONNECT ON DATABASE %I TO autosale_api, autosale_worker', current_database());
        EXECUTE format('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM autosale_api, autosale_worker', current_database());
      END
      $roles$;

      REVOKE CREATE ON SCHEMA public FROM PUBLIC, autosale_api, autosale_worker;
      GRANT USAGE ON SCHEMA public TO autosale_api, autosale_worker;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO autosale_api, autosale_worker;
      GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO autosale_api, autosale_worker;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO autosale_api, autosale_worker;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO autosale_api, autosale_worker;
      DO $functions$
      BEGIN
        IF to_regprocedure('public.platform_order_counts()') IS NOT NULL THEN
          GRANT EXECUTE ON FUNCTION public.platform_order_counts() TO autosale_api;
          REVOKE ALL ON FUNCTION public.platform_order_counts() FROM autosale_worker;
        END IF;
        IF to_regprocedure('public.worker_due_instagram_messages(timestamp with time zone,integer)') IS NOT NULL THEN
          REVOKE ALL ON FUNCTION public.worker_due_instagram_messages(timestamp with time zone, integer) FROM autosale_api;
          GRANT EXECUTE ON FUNCTION public.worker_due_instagram_messages(timestamp with time zone, integer) TO autosale_worker;
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
