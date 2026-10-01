import { Prisma, type PrismaClient } from '@autosale/database';

type ShipmentTenantRow = { tenant_id: string; shipment_id: string };

export async function resolveShipmentTenants(
  prisma: PrismaClient,
  shipmentIds: string[],
): Promise<Map<string, string>> {
  if (shipmentIds.length < 1 || shipmentIds.length > 50) {
    throw new Error('Shipment authority lookup must contain between 1 and 50 identifiers');
  }
  const rows = await prisma.$queryRaw<ShipmentTenantRow[]>(Prisma.sql`
    SELECT tenant_id, shipment_id
    FROM public.worker_delivery_tenants_for_shipments(
      ARRAY[${Prisma.join(shipmentIds.map((shipmentId) => Prisma.sql`${shipmentId}::uuid`))}]::uuid[]
    )
  `);
  return new Map(rows.map((row) => [row.shipment_id, row.tenant_id]));
}

export async function resolveShipmentTenant(prisma: PrismaClient, shipmentId: string): Promise<string | null> {
  return (await resolveShipmentTenants(prisma, [shipmentId])).get(shipmentId) ?? null;
}
