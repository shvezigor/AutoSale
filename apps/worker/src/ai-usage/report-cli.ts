import { execFile } from 'node:child_process';
import { lstat, open, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createPrismaClient, withTenantTransaction, type PrismaClient } from '@autosale/database';
import { z } from 'zod';
import { buildMonthlyAiUsageReport, utcMonth, type MonthlyReportInput } from './monthly-report.js';

const execFileAsync = promisify(execFile);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i).transform((value) => value.toLowerCase());
const identity = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/);
const decimal = z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,12})?$/);
const currency = z.string().regex(/^[A-Z]{3}$/);
const instant = z.iso.datetime({ offset: false }).transform((value) => new Date(value));
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const ids = z.array(uuid).max(100).refine((value) => new Set(value).size === value.length);
const range = { from: instant, until: instant };
const operatorSchema = z.strictObject({
  version: z.literal(1), month, authorizedTenantIds: ids.nonempty(), testTenantIds: ids,
  providerScope: z.strictObject({ accountId: identity, projectId: identity, verified: z.boolean() }),
  rates: z.array(z.strictObject({ version: identity, source: z.string().trim().min(1).max(512), model: identity, currency,
    effectiveFrom: instant, effectiveUntil: instant, inputPerMillion: decimal.nullable(), outputPerMillion: decimal.nullable(), cachedInputPerMillion: decimal.nullable(),
  }).refine((value) => value.effectiveFrom < value.effectiveUntil)).max(1000),
  providerInvoice: z.strictObject({ month, accountId: identity, projectId: identity, currency, subtotal: decimal, credits: decimal, taxes: decimal,
    evidenceReviewed: z.boolean(), tenantIds: ids.nonempty() }).nullable(),
  infrastructureInvoice: z.strictObject({ month, currency, attributableAmount: decimal, evidenceReviewed: z.boolean(), allocationApproved: z.boolean() }).nullable(),
  collectionEvidence: z.strictObject({ ...range, tenantIds: ids.nonempty(), complete: z.boolean() }).refine((value) => value.from < value.until).nullable(),
  collectionGaps: z.array(z.strictObject({ ...range, tenantId: uuid.nullable(), reason: z.enum(['COLLECTION_DISABLED', 'METERING_FAILURE', 'RETENTION_EXPIRED', 'HISTORICAL_INCOMPLETE', 'OTHER']) }).refine((value) => value.from < value.until)).max(1000),
});
type OperatorInput = Omit<MonthlyReportInput, 'attempts' | 'orderIds'>;
class OperatorError extends Error {}

/** Fail with a fixed message: validation diagnostics can contain credentials or customer text. */
export function parseOperatorInput(raw: unknown): OperatorInput {
  try {
    const parsed = operatorSchema.parse(raw);
    const tenantIds = parsed.authorizedTenantIds;
    if (parsed.testTenantIds.some((id) => !tenantIds.includes(id)) || parsed.collectionGaps.some((gap) => gap.tenantId !== null && !tenantIds.includes(gap.tenantId))) throw new Error();
    return { period: utcMonth(parsed.month), tenantIds, testTenantIds: parsed.testTenantIds, providerScope: parsed.providerScope,
      rates: parsed.rates, providerInvoice: parsed.providerInvoice, infrastructureInvoice: parsed.infrastructureInvoice,
      collectionEvidence: parsed.collectionEvidence, collectionGaps: parsed.collectionGaps };
  } catch { throw new OperatorError('Invalid operator input; check the versioned private JSON contract.'); }
}

/** No unrestricted directory query: the operator supplies every authorized UUID. */
export async function loadMonthlyReportData(prisma: PrismaClient, input: OperatorInput) {
  const attempts: MonthlyReportInput['attempts'] = [];
  const orderIds: MonthlyReportInput['orderIds'] = [];
  for (const tenantId of input.tenantIds) {
    const data = await withTenantTransaction(prisma, tenantId, async (tx) => {
      const rows = await tx.aiProviderUsageAttempt.findMany({
        where: { tenantId, startedAt: { gte: input.period.from, lt: input.period.until } },
        select: { id: true, tenantId: true, purpose: true, provider: true, requestedModel: true, returnedModel: true,
          startedAt: true, finalizedAt: true, outcome: true, inputTokens: true, outputTokens: true, cachedInputTokens: true },
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }], take: 100_001,
      });
      const orders = await tx.order.findMany({
        where: { tenantId, createdAt: { gte: input.period.from, lt: input.period.until } },
        select: { id: true, tenantId: true, createdAt: true }, orderBy: { id: 'asc' }, take: 100_001,
      });
      if (rows.length > 100_000 || orders.length > 100_000) throw new OperatorError('Report scope exceeds the private reader bound; no truncated report was written.');
      return { rows, orders };
    }, { isolationLevel: 'RepeatableRead' });
    attempts.push(...data.rows);
    orderIds.push(...data.orders);
  }
  return { attempts, orderIds };
}

function within(path: string, root: string) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
async function externalPath(path: string, repositoryRoot: string) {
  if (!isAbsolute(path)) throw new OperatorError('Use absolute external operator paths.');
  const canonical = await realpath(path);
  if (within(canonical, await realpath(repositoryRoot))) throw new OperatorError('Operator input and report output must stay outside the repository.');
  // A linked worktree's root differs from master. Reject any ancestor Git marker,
  // including gitfiles, so another checkout cannot become a private artifact store.
  let ancestor = (await stat(canonical)).isDirectory() ? canonical : dirname(canonical);
  while (true) {
    try { await lstat(join(ancestor, '.git')); throw new OperatorError('Operator files must stay outside every Git repository and worktree.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  return canonical;
}

/** Windows modes are insufficient. Inspect actual ACLs without interpolating any path into shell code. */
async function assertPrivateDirectory(path: string) {
  const info = await stat(path);
  if (!info.isDirectory()) throw new OperatorError('Private directory required.');
  if (process.platform === 'win32') {
    try {
      const script = '$ErrorActionPreference="Stop"; $a=[System.IO.Directory]::GetAccessControl($env:AI_USAGE_PRIVATE_DIRECTORY); $s=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $allowed=@($s,"S-1-5-18","S-1-5-32-544"); foreach($r in $a.Access){ if($r.AccessControlType -eq "Allow"){ $id=$r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; if($allowed -notcontains $id){ exit 1 } } }; if($a.Access.Count -eq 0){ exit 1 }';
      await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
        { env: { ...process.env, AI_USAGE_PRIVATE_DIRECTORY: path }, timeout: 10_000, windowsHide: true });
    } catch { throw new OperatorError('Private directory required: Windows ACL verification failed; restrict access to the operator, SYSTEM and Administrators.'); }
  } else if ((info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) {
    throw new OperatorError('Private directory required: operator-owned mode 0700.');
  }
}

async function privateOutputPath(outputPath: string, repositoryRoot: string) {
  if (!isAbsolute(outputPath)) throw new OperatorError('Use absolute external operator paths.');
  const parent = await externalPath(dirname(outputPath), repositoryRoot);
  await assertPrivateDirectory(parent);
  const target = resolve(parent, relative(dirname(outputPath), outputPath));
  try { await lstat(target); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return target;
    throw error;
  }
  throw new OperatorError('Report output already exists; choose a new private output filename.');
}

export async function writePrivateReport(outputPath: string, report: string, repositoryRoot: string) {
  const target = await privateOutputPath(outputPath, repositoryRoot);
  const file = await open(target, 'wx', 0o600);
  try { await file.writeFile(report, 'utf8'); await file.sync(); } finally { await file.close(); }
}

type CliDependencies = { repositoryRoot?: string; readData?: (input: OperatorInput) => Promise<Pick<MonthlyReportInput, 'attempts' | 'orderIds'>>;
  stderr?: (text: string) => void };

/** No report data or tenant totals are emitted on stdout, even on success. */
export async function runReportCli(args: string[], dependencies: CliDependencies = {}): Promise<number> {
  const stderr = dependencies.stderr ?? ((message: string) => { process.stderr.write(message); });
  const repositoryRoot = dependencies.repositoryRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  let prisma: PrismaClient | undefined;
  try {
    const flags = new Map<string, string>();
    if (args.length !== 6) throw new OperatorError('Usage: ai-usage:report --input ABSOLUTE_JSON --month YYYY-MM --output ABSOLUTE_NEW_JSON');
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index]!;
      if (!['--input', '--month', '--output'].includes(key) || flags.has(key)) throw new OperatorError('Invalid report arguments.');
      flags.set(key, args[index + 1]!);
    }
    const inputPath = await externalPath(flags.get('--input')!, repositoryRoot);
    const inputStat = await stat(inputPath);
    if (!inputStat.isFile() || inputStat.size > 2_000_000) throw new OperatorError('Invalid operator input file.');
    let raw: unknown;
    try { raw = JSON.parse(await readFile(inputPath, 'utf8')); } catch { throw new OperatorError('Invalid operator JSON.'); }
    const input = parseOperatorInput(raw);
    if (input.period.from.toISOString().slice(0, 7) !== flags.get('--month')) throw new OperatorError('Report month must match the operator input.');
    await privateOutputPath(flags.get('--output')!, repositoryRoot);
    let readData = dependencies.readData;
    if (!readData) {
      if (!process.env.DATABASE_URL) throw new OperatorError('An authorized RLS runtime DATABASE_URL is required.');
      prisma = createPrismaClient(process.env.DATABASE_URL);
      const client = prisma;
      readData = (scope) => loadMonthlyReportData(client, scope);
    }
    const data = await readData(input);
    const report = buildMonthlyAiUsageReport({ ...input, ...data });
    await writePrivateReport(flags.get('--output')!, `${JSON.stringify(report, null, 2)}\n`, repositoryRoot);
    return 0;
  } catch (error) {
    stderr(`${error instanceof OperatorError ? error.message : 'Private AI report failed; no raw diagnostics were emitted.'}\n`);
    return 1;
  } finally { if (prisma) await prisma.$disconnect().catch(() => undefined); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runReportCli(process.argv.slice(2));
}
