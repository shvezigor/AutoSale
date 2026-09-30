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
