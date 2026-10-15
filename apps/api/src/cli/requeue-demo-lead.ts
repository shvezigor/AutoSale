import { createPrismaClient, type PrismaClient } from '@autosale/database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function requeueDemoLead(
  prisma: Pick<PrismaClient, 'demoLead'>,
  id: string,
  confirmId: string,
  now: () => Date = () => new Date(),
): Promise<{ id: string; requeued: true }> {
  if (!UUID.test(id)) throw new Error('INVALID_LEAD_ID');
  if (confirmId !== id) throw new Error('CONFIRMATION_MISMATCH');
  const timestamp = now();
  const updated = await prisma.demoLead.updateMany({
    where: {
      id,
      notificationStatus: 'FAILED',
      notifiedAt: null,
      notificationNextAttemptAt: null,
      OR: [{ notificationLeaseId: null }, { notificationLeaseExpiresAt: { lte: timestamp } }],
    },
    data: {
      notificationStatus: 'PENDING',
      notificationAttempts: 0,
      notificationNextAttemptAt: timestamp,
      notificationLeaseId: null,
      notificationLeaseExpiresAt: null,
      lastNotificationError: null,
    },
  });
  if (updated.count !== 1) throw new Error('LEAD_NOT_REQUEUEABLE');
  return { id, requeued: true };
}

async function main(): Promise<void> {
  const [id, flag, confirmId, ...extra] = process.argv.slice(2);
  if (!id || flag !== '--confirm-id' || !confirmId || extra.length > 0) throw new Error('USAGE: requeue-demo-lead <uuid> --confirm-id <same-uuid>');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED');
  const prisma = createPrismaClient(databaseUrl);
  try {
    const result = await requeueDemoLead(prisma, id, confirmId);
    process.stdout.write(`${JSON.stringify({ action: 'demo_lead_requeue', id: result.id, result: 'REQUEUED' })}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith('requeue-demo-lead.js')) {
  void main().catch((error: unknown) => {
    const code = error instanceof Error && [
      'INVALID_LEAD_ID', 'CONFIRMATION_MISMATCH', 'LEAD_NOT_REQUEUEABLE',
      'DATABASE_URL_REQUIRED', 'USAGE: requeue-demo-lead <uuid> --confirm-id <same-uuid>',
    ].includes(error.message) ? error.message : 'REQUEUE_FAILED';
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
