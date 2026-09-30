import type { Prisma, PrismaClient } from './generated/prisma/client.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function withTenantTransaction<T>(
  prisma: Pick<PrismaClient, '$transaction'>,
  tenantId: string,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  options?: {
    maxWait?: number;
    timeout?: number;
    isolationLevel?: Prisma.TransactionIsolationLevel;
  },
): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    await setTenantContext(transaction, tenantId);
    return operation(transaction);
  }, options);
}

export async function setTenantContext(transaction: Prisma.TransactionClient, tenantId: string): Promise<void> {
  if (!UUID_PATTERN.test(tenantId)) throw new Error('A valid tenant identifier is required');
  await transaction.$queryRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
}
