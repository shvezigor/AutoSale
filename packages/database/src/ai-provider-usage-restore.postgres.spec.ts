import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { configureRuntimeDatabaseRoles } from './runtime-database-roles.js';

const execFileAsync = promisify(execFile);
const database = 'fictional_restore';
const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const attemptA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const attemptB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const migrations = resolve(fileURLToPath(new URL('../prisma/migrations', import.meta.url)));
const passwords = {
  apiPassword: 'fictional-api-password-32-characters',
  workerPassword: 'fictional-worker-password-32-chars',
  backupPassword: 'fictional-backup-password-32-chars',
};

async function docker(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('docker', args, { maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

async function sql(container: string, statement: string): Promise<string> {
  return docker('exec', container, 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-v', 'VERBOSITY=verbose',
    '-U', 'fictional_owner', '-d', database, '-c', statement);
}

async function startIsolatedPostgres(name: string, loopbackPort = false): Promise<void> {
  await docker('run', '--detach', '--rm', '--name', name,
    ...(loopbackPort ? ['--publish', '127.0.0.1::5432'] : ['--network', 'none']),
    '--tmpfs', '/var/lib/postgresql/data:rw,size=512m',
    '--env', `POSTGRES_DB=${database}`,
    '--env', 'POSTGRES_USER=fictional_owner',
    '--env', 'POSTGRES_HOST_AUTH_METHOD=trust',
    'postgres:17.6-alpine');
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        await docker('exec', name, 'pg_isready', '-U', 'fictional_owner', '-d', database);
        return;
      } catch {
        await new Promise((done) => setTimeout(done, 500));
      }
    }
    throw new Error('Isolated fictional PostgreSQL fixture did not become ready');
  } catch (error) {
    await docker('rm', '--force', name);
    throw error;
  }
}

async function createFictionalRoles(container: string): Promise<void> {
  await sql(container, 'CREATE ROLE autosale_api; CREATE ROLE autosale_worker; CREATE ROLE autosale_backup;');
}

describe('AI usage ledger fictional dump and isolated restore', () => {
  const suffix = randomUUID().slice(0, 12);
  const source = `salesaito-ledger-fixture-source-${suffix}`;
  const restored = `salesaito-ledger-fixture-restored-${suffix}`;
  let sourceStarted = false;
  let restoredStarted = false;
  let temporaryDirectory: string | undefined;
  let preBootstrapTableGrants: string;

  beforeAll(async () => {
    await startIsolatedPostgres(source);
    sourceStarted = true;
    await createFictionalRoles(source);
    await docker('cp', migrations, `${source}:/tmp/migrations`);
    await docker('exec', source, 'sh', '-c',
      `set -eu; for file in /tmp/migrations/*/migration.sql; do psql -X -v ON_ERROR_STOP=1 -U fictional_owner -d ${database} -f "$file" >/dev/null; done`);
    await sql(source, `INSERT INTO tenants (id, key, name) VALUES
      ('${tenantA}', 'fictional-alpha', 'Fictional Alpha'),
      ('${tenantB}', 'fictional-beta', 'Fictional Beta')`);
    await sql(source, `INSERT INTO ai_provider_usage_attempts
      (id, tenant_id, purpose, operation_id, requested_model, returned_model,
       started_at, finalized_at, outcome, input_tokens, output_tokens)
      VALUES
      ('${attemptA}', '${tenantA}', 'REPLY_DRAFT', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
       'fictional-model', 'fictional-model', '2026-10-24T09:00:00Z', '2026-10-24T09:00:01Z', 'REPORTED', 7, 2),
      ('${attemptB}', '${tenantB}', 'ORDER_INTENT', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc',
       'fictional-model', 'fictional-model', '2026-10-24T09:00:00Z', '2026-10-24T09:00:01Z', 'REPORTED', 3, 1)`);

    await docker('exec', source, 'pg_dump', '--format=custom', '--no-owner', '--no-privileges',
      '-U', 'fictional_owner', '-d', database, '--file=/tmp/fictional-ledger.dump');
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'sales-aito-fictional-ledger-'));
    const archive = join(temporaryDirectory, 'fictional-ledger.dump');
    await docker('cp', `${source}:/tmp/fictional-ledger.dump`, archive);

    await startIsolatedPostgres(restored, true);
    restoredStarted = true;
    await createFictionalRoles(restored);
    await docker('cp', archive, `${restored}:/tmp/fictional-ledger.dump`);
    await docker('exec', restored, 'pg_restore', '--exit-on-error', '--no-owner', '--no-privileges',
      '-U', 'fictional_owner', '-d', database, '/tmp/fictional-ledger.dump');
    preBootstrapTableGrants = await sql(restored, `SELECT
      has_table_privilege('autosale_api', 'ai_provider_usage_attempts', 'SELECT'),
      has_table_privilege('autosale_api', 'ai_provider_usage_attempts', 'INSERT'),
      has_table_privilege('autosale_api', 'ai_provider_usage_attempts', 'UPDATE'),
      has_table_privilege('autosale_worker', 'ai_provider_usage_attempts', 'DELETE')`);
    const binding = await docker('port', restored, '5432/tcp');
    const match = /^127\.0\.0\.1:(\d+)$/.exec(binding);
    if (!match) throw new Error('Fictional restore container must bind only to loopback');
    await configureRuntimeDatabaseRoles(
      `postgresql://fictional_owner@127.0.0.1:${match[1]}/${database}`,
      passwords,
    );
  }, 180_000);

  afterAll(async () => {
    const cleanups: Promise<unknown>[] = [];
    if (restoredStarted) cleanups.push(docker('rm', '--force', restored));
    if (sourceStarted) cleanups.push(docker('rm', '--force', source));
    if (temporaryDirectory) cleanups.push(rm(temporaryDirectory, { recursive: true, force: true }));
    const failures = (await Promise.allSettled(cleanups)).filter((result) => result.status === 'rejected');
    if (failures.length) throw new Error('Fictional PostgreSQL fixture cleanup failed');
  });

  it('keeps both fictional tenant rows with source offline and restore bound only to loopback', async () => {
    expect(await docker('inspect', '--format', '{{.HostConfig.NetworkMode}}|{{len .HostConfig.PortBindings}}', source))
      .toBe('none|0');
    expect(await docker('port', restored, '5432/tcp')).toMatch(/^127\.0\.0\.1:\d+$/);
    expect(await sql(restored, `SELECT tenant_id || '|' || outcome || '|' || input_tokens || '|' || output_tokens
      FROM ai_provider_usage_attempts ORDER BY tenant_id`)).toBe(
      `${tenantA}|REPORTED|7|2\n${tenantB}|REPORTED|3|1`,
    );
  });

  it('keeps forced RLS schema and limits each bootstrapped API tenant to its own row', async () => {
    expect(await sql(restored, `SELECT relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE oid = 'public.ai_provider_usage_attempts'::regclass`)).toBe('t|t');
    expect(await sql(restored, `SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'ai_provider_usage_attempts'`))
      .toBe('ai_provider_usage_tenant');
    expect(await sql(restored, `SET ROLE autosale_api; SET app.current_tenant_id = '${tenantA}';
      SELECT id FROM ai_provider_usage_attempts ORDER BY id`)).toBe(attemptA);
    expect(await sql(restored, `SET ROLE autosale_api; SET app.current_tenant_id = '${tenantB}';
      SELECT id FROM ai_provider_usage_attempts ORDER BY id`)).toBe(attemptB);
    expect(await sql(restored, 'SET ROLE autosale_api; SELECT count(*) FROM ai_provider_usage_attempts'))
      .toBe('0');
  });

  it('bootstrap replaces omitted ACLs with API write and worker delete denials, preserving terminal immutability', async () => {
    expect(preBootstrapTableGrants).toBe('f|f|f|f');
    expect(await sql(restored, `SELECT
      has_table_privilege('autosale_api', 'ai_provider_usage_attempts', 'SELECT'),
      has_table_privilege('autosale_api', 'ai_provider_usage_attempts', 'INSERT'),
      has_table_privilege('autosale_api', 'ai_provider_usage_attempts', 'UPDATE'),
      has_table_privilege('autosale_worker', 'ai_provider_usage_attempts', 'DELETE')`))
      .toBe('t|f|f|f');
    await expect(sql(restored, `SET ROLE autosale_api; SET app.current_tenant_id = '${tenantA}';
      INSERT INTO ai_provider_usage_attempts
        (id, tenant_id, purpose, operation_id, requested_model, started_at)
      VALUES
        ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '${tenantA}', 'REPLY_DRAFT',
         'cccccccc-cccc-4ccc-8ccc-cccccccccccd', 'fictional-model', '2026-10-24T09:00:00Z')`))
      .rejects.toMatchObject({ stderr: expect.stringContaining('42501') });
    await expect(sql(restored, `SET ROLE autosale_api; SET app.current_tenant_id = '${tenantA}';
      UPDATE ai_provider_usage_attempts SET input_tokens = 8 WHERE id = '${attemptA}'`))
      .rejects.toMatchObject({ stderr: expect.stringContaining('42501') });
    await expect(sql(restored, `SET ROLE autosale_worker; SET app.current_tenant_id = '${tenantA}';
      DELETE FROM ai_provider_usage_attempts WHERE id = '${attemptA}'`))
      .rejects.toMatchObject({ stderr: expect.stringContaining('42501') });
    await expect(sql(restored, `UPDATE ai_provider_usage_attempts SET input_tokens = 8 WHERE id = '${attemptA}'`))
      .rejects.toMatchObject({ stderr: expect.stringContaining('23514') });
    expect(await sql(restored, `SELECT input_tokens FROM ai_provider_usage_attempts WHERE id = '${attemptA}'`))
      .toBe('7');
  });

  it('restores maintenance functions and bootstraps worker-only execution grants', async () => {
    for (const name of ['worker_due_ai_provider_usage_attempts', 'worker_purge_ai_provider_usage_attempts']) {
      expect(await sql(restored, `SELECT p.prosecdef, array_to_string(p.proconfig, ';')
        FROM pg_proc p WHERE p.oid = 'public.${name}(timestamptz,integer)'::regprocedure`))
        .toBe('t|search_path=pg_catalog, public');
      expect(await sql(restored, `SELECT
        has_function_privilege('autosale_worker', 'public.${name}(timestamptz,integer)', 'EXECUTE'),
        has_function_privilege('autosale_api', 'public.${name}(timestamptz,integer)', 'EXECUTE'),
        has_function_privilege('autosale_backup', 'public.${name}(timestamptz,integer)', 'EXECUTE')`))
        .toBe('t|f|f');
    }
  });
});
