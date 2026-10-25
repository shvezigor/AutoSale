import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, chmod } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { configureRuntimeDatabaseRoles, createPrismaClient, withTenantTransaction, type PrismaClient } from '@autosale/database';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { loadMonthlyReportData, parseOperatorInput, runReportCli, writePrivateReport } from './report-cli.js';

const tenant = '11111111-1111-4111-8111-111111111111';
const directories: string[] = [];
async function directory(privateAccess = true) {
  const path = await mkdtemp(join(tmpdir(), 'fictional-ai-report-'));
  directories.push(path);
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '$ErrorActionPreference="Stop"; $p=$env:AI_REPORT_TEST_DIRECTORY; $a=[System.IO.Directory]::GetAccessControl($p); $a.SetAccessRuleProtection($true,$false); $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $r=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,"FullControl","ContainerInherit,ObjectInherit","None","Allow"); $a.AddAccessRule($r); if($env:AI_REPORT_TEST_PUBLIC -eq "true"){ $everyone=New-Object System.Security.Principal.SecurityIdentifier("S-1-1-0"); $public=New-Object System.Security.AccessControl.FileSystemAccessRule($everyone,"ReadAndExecute","ContainerInherit,ObjectInherit","None","Allow"); $a.AddAccessRule($public) }; [System.IO.Directory]::SetAccessControl($p,$a)'],
    { env: { ...process.env, AI_REPORT_TEST_DIRECTORY: path, AI_REPORT_TEST_PUBLIC: String(!privateAccess) }, stdio: 'pipe', windowsHide: true });
  } else await chmod(path, privateAccess ? 0o700 : 0o755);
  return path;
}
function config() {
  return { version: 1, month: '2026-09', authorizedTenantIds: [tenant], testTenantIds: [],
    providerScope: { accountId: 'fictional-account', projectId: 'fictional-project', verified: true },
    rates: [], providerInvoice: null, infrastructureInvoice: null, collectionEvidence: null, collectionGaps: [] };
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe('private operator report CLI', () => {
  it('requires versioned strict input, explicit UUID scope, provider identity and decimal-string prices before reading any rows', () => {
    expect(parseOperatorInput(config()).tenantIds).toEqual([tenant]);
    for (const bad of [{ ...config(), version: 2 }, { ...config(), authorizedTenantIds: [] }, { ...config(), providerScope: {} },
      { ...config(), rawResponse: 'credential-content' }, { ...config(), testTenantIds: ['22222222-2222-4222-8222-222222222222'] },
      { ...config(), month: '2026-13' }, { ...config(), rates: [{ inputPerMillion: 0.1 }] }]) {
      expect(() => parseOperatorInput(bad)).toThrow('Invalid operator input');
    }
  });

  it('rejects numeric/negative rates, ambiguous timestamps, unknown nested keys and duplicate authorized UUIDs', () => {
    const rate = { version: 'fictional-v1', source: 'fictional tariff', model: 'fictional-model', currency: 'USD',
      effectiveFrom: '2026-09-01T00:00:00.000Z', effectiveUntil: '2026-10-01T00:00:00.000Z', inputPerMillion: '0.1', outputPerMillion: '0.2', cachedInputPerMillion: null };
    expect(parseOperatorInput({ ...config(), rates: [rate] }).rates[0]!.inputPerMillion).toBe('0.1');
    for (const change of [{ inputPerMillion: 0.1 }, { outputPerMillion: '-0.2' }, { inputPerMillion: '1e-7' },
      { effectiveFrom: '2026-09-01T00:00:00+03:00' }, { effectiveUntil: rate.effectiveFrom }, { response: 'fictional-secret' }]) {
      expect(() => parseOperatorInput({ ...config(), rates: [{ ...rate, ...change }] })).toThrow('Invalid operator input');
    }
    expect(() => parseOperatorInput({ ...config(), authorizedTenantIds: [tenant, tenant] })).toThrow('Invalid operator input');
  });

  it.each(['effectiveFrom', 'effectiveUntil'] as const)('rejects sub-millisecond %s tariff boundaries instead of silently rounding', (field) => {
    const rate = { version: 'fictional-v1', source: 'fictional tariff', model: 'fictional-model', currency: 'USD',
      effectiveFrom: '2026-09-01T00:00:00.000Z', effectiveUntil: '2026-10-01T00:00:00.000Z', inputPerMillion: '0.1', outputPerMillion: '0.2', cachedInputPerMillion: '0.01' };
    for (const instant of ['2026-09-16T00:00:00.0009Z', '2026-09-16T00:00:00.000000Z']) {
      expect(() => parseOperatorInput({ ...config(), rates: [{ ...rate, [field]: instant }] })).toThrow('Invalid operator input');
    }
    for (const [instant, expected] of [['2026-09-16T00:00:00Z', '2026-09-16T00:00:00.000Z'],
      ['2026-09-16T00:00:00.1Z', '2026-09-16T00:00:00.100Z'], ['2026-09-16T00:00:00.12Z', '2026-09-16T00:00:00.120Z'],
      ['2026-09-16T00:00:00.123Z', '2026-09-16T00:00:00.123Z']]) {
      expect(parseOperatorInput({ ...config(), rates: [{ ...rate, [field]: instant }] }).rates[0]![field].toISOString()).toBe(expected);
    }
  });

  it('rejects a sub-millisecond tariff before querying or writing a report', async () => {
    const dir = await directory();
    const repo = await directory();
    const rate = { version: 'fictional-v1', source: 'fictional tariff', model: 'fictional-model', currency: 'USD',
      effectiveFrom: '2026-09-16T00:00:00.0009Z', effectiveUntil: '2026-10-01T00:00:00.000Z', inputPerMillion: '0.1', outputPerMillion: '0.2', cachedInputPerMillion: '0.01' };
    await writeFile(join(dir, 'input.json'), JSON.stringify({ ...config(), rates: [rate] }));
    let reads = 0;
    const errors: string[] = [];
    expect(await runReportCli(['--input', join(dir, 'input.json'), '--month', '2026-09', '--output', join(dir, 'report.json')], {
      repositoryRoot: repo, readData: async () => { reads++; return { attempts: [], orderIds: [] }; }, stderr: (message) => errors.push(message),
    })).toBe(1);
    expect(reads).toBe(0);
    await expect(readFile(join(dir, 'report.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(errors).toEqual(['Invalid operator input; check the versioned private JSON contract.\n']);
  });

  it('reads only selected scalar evidence and canonical order IDs inside each explicit tenant RLS transaction', async () => {
    const calls: unknown[] = [];
    const tx = {
      $queryRaw: vi.fn(async (_sql: unknown, tenantId: string) => { calls.push(['context', tenantId]); }),
      aiProviderUsageAttempt: { findMany: vi.fn(async (query: unknown) => { calls.push(['attempts', query]); return []; }) },
      order: { findMany: vi.fn(async (query: unknown) => { calls.push(['orders', query]); return []; }) },
    };
    const prisma = { $transaction: async (operation: (value: typeof tx) => Promise<unknown>) => operation(tx) } as unknown as PrismaClient;
    expect(await loadMonthlyReportData(prisma, parseOperatorInput(config()))).toEqual({ attempts: [], orderIds: [] });
    expect(calls[0]).toEqual(['context', tenant]);
    expect(calls[1]).toMatchObject(['attempts', { where: { tenantId: tenant, startedAt: { gte: new Date('2026-09-01T00:00:00Z'), lt: new Date('2026-10-01T00:00:00Z') } } }]);
    expect(calls[2]).toMatchObject(['orders', { where: { tenantId: tenant, createdAt: { gte: new Date('2026-09-01T00:00:00Z'), lt: new Date('2026-10-01T00:00:00Z') } }, select: { id: true, tenantId: true, createdAt: true } }]);
    expect(JSON.stringify(calls[1])).not.toMatch(/"(operationId|request|response|include)"/);
  });

  it('aborts an oversized reader scope without returning a truncated report', async () => {
    const tx = { $queryRaw: async () => [], aiProviderUsageAttempt: { findMany: async () => Array.from({ length: 100_001 }, () => ({})) }, order: { findMany: async () => [] } };
    const prisma = { $transaction: async (operation: (value: typeof tx) => Promise<unknown>) => operation(tx) } as unknown as PrismaClient;
    await expect(loadMonthlyReportData(prisma, parseOperatorInput(config()))).rejects.toThrow('no truncated report');
  });

  it('writes only an exclusive private external file and refuses public directories or repository paths', async () => {
    const privateDir = await directory();
    const repo = await directory();
    const output = join(privateDir, 'report.json');
    await writePrivateReport(output, '{"status":"PROVISIONAL"}', repo);
    expect(await readFile(output, 'utf8')).toBe('{"status":"PROVISIONAL"}');
    await expect(writePrivateReport(output, '{}', repo)).rejects.toThrow();
    await expect(writePrivateReport(join(repo, 'report.json'), '{}', repo)).rejects.toThrow();
    const publicDir = await directory(false);
    await expect(writePrivateReport(join(publicDir, 'report.json'), '{}', repo)).rejects.toThrow('Private directory');
  });

  it('validates the external file before querying and emits no tenant totals or raw errors to stdout/stderr', async () => {
    const dir = await directory();
    const repo = await directory();
    const input = join(dir, 'input.json');
    await writeFile(input, JSON.stringify(config()));
    let reads = 0;
    const stdout = vi.spyOn(process.stdout, 'write');
    const stderr: string[] = [];
    const dependencies = { repositoryRoot: repo, readData: async () => { reads++; return { attempts: [], orderIds: [] }; }, stderr: (text: string) => stderr.push(text) };
    expect(await runReportCli(['--input', input, '--month', '2026-09', '--output', join(dir, 'report.json')], dependencies)).toBe(0);
    expect(reads).toBe(1);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toEqual([]);
    expect(JSON.parse(await readFile(join(dir, 'report.json'), 'utf8')).status).toBe('PROVISIONAL');
    await writeFile(input, '{"credential":"secret-raw-content"}');
    expect(await runReportCli(['--input', input, '--month', '2026-09', '--output', join(dir, 'other.json')], dependencies)).toBe(1);
    expect(reads).toBe(1);
    expect(stderr.join('')).not.toMatch(/secret|credential|11111111/);
    await mkdir(join(repo, 'operator'));
    const internal = join(repo, 'operator', 'input.json');
    await writeFile(internal, JSON.stringify(config()));
    expect(await runReportCli(['--input', internal, '--month', '2026-09', '--output', join(dir, 'third.json')], dependencies)).toBe(1);
    expect(reads).toBe(1);
  });

  it('redacts a database exception and refuses mismatched months before database access', async () => {
    const dir = await directory();
    const repo = await directory();
    await writeFile(join(dir, 'input.json'), JSON.stringify(config()));
    const errors: string[] = [];
    let reads = 0;
    const readData = async (): Promise<{ attempts: []; orderIds: [] }> => { reads++; throw new Error('fictional-credential customer-content 11111111'); };
    const deps = { repositoryRoot: repo, readData, stderr: (message: string) => errors.push(message) };
    expect(await runReportCli(['--input', join(dir, 'input.json'), '--month', '2026-08', '--output', join(dir, 'report.json')], deps)).toBe(1);
    expect(reads).toBe(0);
    expect(await runReportCli(['--input', join(dir, 'input.json'), '--month', '2026-09', '--output', join(dir, 'report.json')], deps)).toBe(1);
    expect(reads).toBe(1);
    expect(errors.join('')).not.toMatch(/fictional-credential|customer-content|11111111/);
    expect(errors[1]).toBe('Private AI report failed; no raw diagnostics were emitted.\n');
  });

  it('rejects a private path inside another Git checkout, including a worktree gitfile', async () => {
    const repo = await directory();
    const other = await directory();
    await writeFile(join(other, '.git'), 'gitdir: fictional-main-repository');
    const nested = join(other, 'nested');
    await mkdir(nested);
    await expect(writePrivateReport(join(nested, 'report.json'), '{}', repo)).rejects.toThrow('outside');
  });

  it.skipIf(process.platform !== 'win32')('fails closed when Windows ACL verification is unavailable', async () => {
    const privateDir = await directory();
    const repo = await directory();
    vi.stubEnv('PATH', privateDir);
    try { await expect(writePrivateReport(join(privateDir, 'report.json'), '{}', repo)).rejects.toThrow('Windows ACL verification failed'); }
    finally { vi.unstubAllEnvs(); }
  });
});

describe('private report reader with PostgreSQL runtime RLS', () => {
  const otherTenant = '22222222-2222-4222-8222-222222222222';
  let container: StartedPostgreSqlContainer;
  let admin: pg.Pool;
  let worker: PrismaClient;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    admin = new pg.Pool({ connectionString: container.getConnectionUri() });
    const migrations = resolve(process.cwd(), '../../packages/database/prisma/migrations');
    for (const migration of (await readdir(migrations)).sort()) {
      if (migration !== 'migration_lock.toml') await admin.query(await readFile(join(migrations, migration, 'migration.sql'), 'utf8'));
    }
    for (const tenantId of [tenant, otherTenant]) {
      await admin.query('INSERT INTO tenants(id,key,name) VALUES($1,$2,$2)', [tenantId, `fictional-${tenantId}`]);
      const conversationId = randomUUID();
      await admin.query(`INSERT INTO conversations(id,tenant_id,channel,external_conversation_id,participant_id,last_message_at,updated_at)
        VALUES($1,$2,'INSTAGRAM',$3,'fictional-person','2026-09-01',now())`, [conversationId, tenantId, `fictional-${tenantId}`]);
      for (const date of ['2026-08-31T23:59:59Z', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z']) {
        const messageId = randomUUID();
        const eventId = randomUUID();
        await admin.query("INSERT INTO webhook_events(id,tenant_id,provider,external_event_id,payload) VALUES($1,$2,'META',$3,'{}')", [eventId, tenantId, randomUUID()]);
        await admin.query(`INSERT INTO messages(id,tenant_id,conversation_id,channel,external_message_id,direction,sender_id,text,source_timestamp,raw_event_id)
          VALUES($1,$2,$3,'INSTAGRAM',$4,'INBOUND','fictional-person','Fictional private text',$5,$6)`, [messageId, tenantId, conversationId, randomUUID(), date, eventId]);
        await admin.query(`INSERT INTO orders(id,tenant_id,conversation_id,trigger_message_id,prompt_version,created_at,updated_at,input_tokens,output_tokens)
          VALUES($1,$2,$3,$4,'fictional-v1',$5,$5,999999,999999)`, [randomUUID(), tenantId, conversationId, messageId, date]);
        await admin.query(`INSERT INTO ai_provider_usage_attempts(id,tenant_id,operation_id,purpose,requested_model,returned_model,started_at,finalized_at,outcome,input_tokens,output_tokens,cached_input_tokens)
          VALUES($1,$2,$3,'ORDER_INTENT','fictional-model','fictional-model',$4,$4,'REPORTED',1,2,0)`, [randomUUID(), tenantId, messageId, date]);
      }
    }
    const passwords = { apiPassword: 'fictional-api-password-32-characters', workerPassword: 'fictional-worker-password-32-chars', backupPassword: 'fictional-backup-password-32-chars' };
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), passwords);
    const url = new URL(container.getConnectionUri());
    url.username = 'autosale_worker';
    url.password = passwords.workerPassword;
    worker = createPrismaClient(url.toString());
  }, 60_000);
  afterAll(async () => { await worker?.$disconnect(); await admin?.end(); await container?.stop(); });

  it('reads only explicitly authorized tenants and the half-open month, with empty and cross-tenant contexts denied', async () => {
    expect(await worker.aiProviderUsageAttempt.findMany()).toEqual([]);
    expect(await withTenantTransaction(worker, tenant, (tx) => tx.aiProviderUsageAttempt.findMany({ where: { tenantId: otherTenant } }))).toEqual([]);
    const data = await loadMonthlyReportData(worker, parseOperatorInput(config()));
    expect(data.attempts).toHaveLength(1);
    expect(data.attempts[0]).toMatchObject({ tenantId: tenant, inputTokens: 1, outputTokens: 2, startedAt: new Date('2026-09-01T00:00:00Z') });
    expect(data.orderIds).toHaveLength(1);
    expect(data.orderIds[0]!.tenantId).toBe(tenant);
    expect(JSON.stringify(data)).not.toMatch(/Fictional private text|999999|operationId/);
  });

  it('writes the complete private CLI artifact with a separately authorized test cohort and no product-table token addition', async () => {
    const dir = await directory();
    const repo = await directory();
    const operator = { ...config(), authorizedTenantIds: [tenant, otherTenant], testTenantIds: [otherTenant] };
    await writeFile(join(dir, 'input.json'), JSON.stringify(operator));
    const errors: string[] = [];
    expect(await runReportCli(['--input', join(dir, 'input.json'), '--month', '2026-09', '--output', join(dir, 'report.json')],
      { repositoryRoot: repo, readData: (input) => loadMonthlyReportData(worker, input), stderr: (message) => errors.push(message) })).toBe(0);
    const artifact = await readFile(join(dir, 'report.json'), 'utf8');
    expect(JSON.parse(artifact)).toMatchObject({ status: 'PROVISIONAL', included: { orders: 1, attempts: 1, inputTokens: '1', outputTokens: '2', cachedInputTokens: '0' }, testCohort: { orders: 1, attempts: 1, inputTokens: '1', outputTokens: '2', cachedInputTokens: '0' } });
    expect(artifact).not.toMatch(/Fictional private text|999999|operationId|fictional-account/);
    expect(errors).toEqual([]);
  });
});
