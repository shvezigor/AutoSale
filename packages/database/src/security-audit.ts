import type { Prisma, PrismaClient } from './generated/prisma/client.js';
import { withTenantTransaction } from './tenant-transaction.js';

export type SecurityAuditInput = {
  tenantId: string | null;
  userId: string;
  actor: 'USER' | 'SYSTEM';
  action: string;
  result: 'SUCCESS' | 'FAILURE';
  metadata: Prisma.InputJsonValue;
};

type AuditClient = Pick<PrismaClient, '$queryRaw' | 'securityAuditLog'> | Prisma.TransactionClient;

export async function appendSecurityAudit(client: AuditClient, input: SecurityAuditInput): Promise<void> {
  if (input.tenantId) {
    await client.securityAuditLog.create({ data: input });
    return;
  }

  const metadata = JSON.stringify(input.metadata);
  const appended = await client.$queryRaw<Array<{ audit_id: string }>>`
    SELECT audit_id
    FROM public.api_append_platform_security_audit_log(
      ${input.userId}::uuid, ${input.actor}, ${input.action}, ${input.result}, ${metadata}::jsonb
    )
  `;
  if (!appended[0]) throw new Error('Platform security audit was rejected');
}

export async function writeSecurityAudit(prisma: PrismaClient, input: SecurityAuditInput): Promise<void> {
  if (!input.tenantId) {
    await appendSecurityAudit(prisma, input);
    return;
  }
  await withTenantTransaction(prisma, input.tenantId, (transaction) => appendSecurityAudit(transaction, input));
}
