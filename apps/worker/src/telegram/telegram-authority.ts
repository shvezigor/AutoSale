import type { TelegramDeliveryPurpose } from '@autosale/contracts';
import { Prisma, type PrismaClient } from '@autosale/database';

export type TelegramDeliveryAuthority = {
  tenantId: string;
  deliveryId: string;
  purpose: TelegramDeliveryPurpose;
};

type TelegramDeliveryAuthorityRow = {
  tenant_id: string;
  delivery_id: string;
  purpose: TelegramDeliveryPurpose;
};

export async function resolveTelegramDeliveryAuthorities(
  prisma: PrismaClient,
  deliveryIds: string[],
): Promise<Map<string, TelegramDeliveryAuthority>> {
  if (deliveryIds.length < 1 || deliveryIds.length > 50) {
    throw new Error('Telegram delivery authority lookup must contain between 1 and 50 identifiers');
  }
  const rows = await prisma.$queryRaw<TelegramDeliveryAuthorityRow[]>(Prisma.sql`
    SELECT tenant_id, delivery_id, purpose
    FROM public.worker_telegram_tenants_for_deliveries(
      ARRAY[${Prisma.join(deliveryIds.map((deliveryId) => Prisma.sql`${deliveryId}::uuid`))}]::uuid[]
    )
  `);
  return new Map(rows.map((row) => [row.delivery_id, {
    tenantId: row.tenant_id,
    deliveryId: row.delivery_id,
    purpose: row.purpose,
  }]));
}

export async function resolveTelegramDeliveryAuthority(
  prisma: PrismaClient,
  deliveryId: string,
): Promise<TelegramDeliveryAuthority | null> {
  return (await resolveTelegramDeliveryAuthorities(prisma, [deliveryId])).get(deliveryId) ?? null;
}

export async function dueTelegramDeliveryAuthorities(
  prisma: PrismaClient,
  now: Date,
  limit = 50,
): Promise<TelegramDeliveryAuthority[]> {
  const rows = await prisma.$queryRaw<TelegramDeliveryAuthorityRow[]>(Prisma.sql`
    SELECT tenant_id, delivery_id, purpose
    FROM public.worker_due_telegram_deliveries(${now}, ${limit})
  `);
  return rows.map((row) => ({
    tenantId: row.tenant_id,
    deliveryId: row.delivery_id,
    purpose: row.purpose,
  }));
}
