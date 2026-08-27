import { createPrismaClient, type PrismaClient } from '@autosale/database';
import { z } from 'zod';
import { CryptoService } from '../auth/crypto.service.js';

const inputSchema = z.object({ email: z.string().trim().email(), name: z.string().trim().min(1), password: z.string().min(12).max(128), tenantKey: z.string().trim().min(1).optional() }).strict();
export type BootstrapInput = z.infer<typeof inputSchema>;

export function parseBootstrapInput(stdin: string, args: string[]): BootstrapInput {
  if (args.some((arg) => /password/i.test(arg))) throw new Error('Password must be provided through stdin only');
  const input = inputSchema.parse(JSON.parse(stdin));
  return { ...input, email: input.email.toLowerCase() };
}

export async function bootstrapIdentity(prisma: PrismaClient, crypto: Pick<CryptoService, 'hashPassword'>, mode: 'admin' | 'adopt', input: BootstrapInput) {
  const passwordHash = await crypto.hashPassword(input.password);
  const now = new Date();
  const user = await prisma.user.upsert({
    where: { email: input.email },
    create: { email: input.email, name: input.name, passwordHash, emailVerifiedAt: now, status: 'ACTIVE', platformRole: mode === 'admin' ? 'PLATFORM_ADMIN' : 'USER' },
    update: { name: input.name, passwordHash, emailVerifiedAt: now, status: 'ACTIVE', ...(mode === 'admin' ? { platformRole: 'PLATFORM_ADMIN' as const } : {}) },
  });
  if (mode === 'adopt') {
    if (!input.tenantKey) throw new Error('tenantKey is required for tenant adoption');
    const tenant = await prisma.tenant.findUnique({ where: { key: input.tenantKey } });
    if (!tenant) throw new Error('Tenant not found');
    await prisma.tenantMembership.upsert({ where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } }, create: { userId: user.id, tenantId: tenant.id, role: 'OWNER', status: 'ACTIVE' }, update: { role: 'OWNER', status: 'ACTIVE' } });
  }
  return { userId: user.id };
}

async function main() {
  const mode = process.argv[2] === 'adopt' ? 'adopt' : 'admin';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const input = parseBootstrapInput(Buffer.concat(chunks).toString('utf8'), process.argv.slice(3));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const prisma = createPrismaClient(databaseUrl);
  try { const result = await bootstrapIdentity(prisma, new CryptoService(), mode, input); process.stdout.write(`${JSON.stringify(result)}\n`); }
  finally { await prisma.$disconnect(); }
}

if (process.argv[1]?.endsWith('bootstrap-auth.js')) void main();
