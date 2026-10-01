import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from './client.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { configureRuntimeDatabaseRoles } from './runtime-database-roles.js';
import { withTenantTransaction } from './tenant-transaction.js';

const apiPassword = 'fictional-api-password-32-characters';
const workerPassword = 'fictional-worker-password-32-chars';
const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';

describe('delivery row-level security', () => {
  let container: StartedPostgreSqlContainer;
  let adminPool: pg.Pool;
  let admin: PrismaClient;
  let api: PrismaClient;
  let worker: PrismaClient;
  let shipmentA: string;
  let shipmentB: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    adminPool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(adminPool);
    admin = createPrismaClient(container.getConnectionUri());
    shipmentA = await seedDelivery(admin, tenantA, 'tenant-a');
    shipmentB = await seedDelivery(admin, tenantB, 'tenant-b');
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), { apiPassword, workerPassword });
    api = createPrismaClient(runtimeUrl(container.getConnectionUri(), 'autosale_api', apiPassword));
    worker = createPrismaClient(runtimeUrl(container.getConnectionUri(), 'autosale_worker', workerPassword));
  }, 60_000);

  afterAll(async () => {
    await api?.$disconnect();
    await worker?.$disconnect();
    await admin?.$disconnect();
    await adminPool?.end();
    await container?.stop();
  });

  it('fails closed without tenant context and exposes only the selected tenant delivery records', async () => {
    for (const client of [api, worker]) {
      await expect(client.deliveryConnection.findMany()).resolves.toEqual([]);
      await expect(client.deliverySenderProfile.findMany()).resolves.toEqual([]);
      await expect(client.shipment.findMany()).resolves.toEqual([]);
      await expect(client.shipmentAttempt.findMany()).resolves.toEqual([]);
      await expect(client.shipmentStatusEvent.findMany()).resolves.toEqual([]);
    }

    await expect(withTenantTransaction(api, tenantA, async (transaction) => ({
      connections: await transaction.deliveryConnection.count(),
      profiles: await transaction.deliverySenderProfile.count(),
      shipments: await transaction.shipment.count(),
      attempts: await transaction.shipmentAttempt.count(),
      events: await transaction.shipmentStatusEvent.count(),
    }))).resolves.toEqual({ connections: 1, profiles: 1, shipments: 1, attempts: 1, events: 1 });
  });

  it('rejects cross-tenant delivery writes', async () => {
    await expect(withTenantTransaction(api, tenantA, (transaction) => transaction.shipment.update({
      where: { id: shipmentB }, data: { description: 'Forbidden' },
    }))).rejects.toMatchObject({ code: 'P2025' });
  });

  it('allows only the worker role to resolve bounded shipment tenant authority', async () => {
    const rows = await worker.$queryRaw<Array<{ tenant_id: string; shipment_id: string }>>`
      SELECT tenant_id, shipment_id
      FROM public.worker_delivery_tenants_for_shipments(${[shipmentA, shipmentB]}::uuid[])
      ORDER BY shipment_id
    `;
    expect(rows).toEqual([
      { tenant_id: tenantA, shipment_id: shipmentA },
      { tenant_id: tenantB, shipment_id: shipmentB },
    ].sort((left, right) => left.shipment_id.localeCompare(right.shipment_id)));
    await expect(api.$queryRaw`
      SELECT * FROM public.worker_delivery_tenants_for_shipments(${[shipmentA]}::uuid[])
    `).rejects.toMatchObject({ code: 'P2010' });
    await expect(worker.$queryRaw`
      SELECT * FROM public.worker_delivery_tenants_for_shipments(${Array.from({ length: 51 }, () => shipmentA)}::uuid[])
    `).rejects.toMatchObject({ code: 'P2010' });
  });

  it('allows only the worker role to discover bounded due delivery work', async () => {
    await admin.shipment.updateMany({
      where: { id: { in: [shipmentA, shipmentB] } },
      data: { status: 'CREATING' },
    });
    const attempts = await worker.$queryRaw<Array<{ tenant_id: string; shipment_id: string; version: number }>>`
      SELECT tenant_id, shipment_id, version
      FROM public.worker_due_shipment_attempts(${new Date('2099-01-01T00:00:00.000Z')}, ${'CREATE'}, ${50})
      ORDER BY shipment_id
    `;
    expect(attempts).toHaveLength(2);
    await admin.shipment.updateMany({
      where: { id: { in: [shipmentA, shipmentB] } },
      data: { status: 'CREATED' },
    });
    const shipments = await worker.$queryRaw<Array<{ tenant_id: string; shipment_id: string; version: number }>>`
      SELECT tenant_id, shipment_id, version
      FROM public.worker_due_shipment_statuses(${new Date('2099-01-01T00:00:00.000Z')}, ${'UKRPOSHTA'}, ${250})
      ORDER BY shipment_id
    `;
    expect(shipments).toHaveLength(2);
    await expect(api.$queryRaw`
      SELECT * FROM public.worker_due_shipment_attempts(${new Date('2099-01-01T00:00:00.000Z')}, ${'CREATE'}, ${50})
    `).rejects.toMatchObject({ code: 'P2010' });
    await expect(api.$queryRaw`
      SELECT * FROM public.worker_due_shipment_statuses(${new Date('2099-01-01T00:00:00.000Z')}, ${'UKRPOSHTA'}, ${250})
    `).rejects.toMatchObject({ code: 'P2010' });
  });
});

async function seedDelivery(prisma: PrismaClient, tenantId: string, suffix: string): Promise<string> {
  await prisma.tenant.create({ data: { id: tenantId, key: suffix, name: `Fictional ${suffix}` } });
  const conversation = await prisma.conversation.create({ data: {
    tenantId, channel: 'INSTAGRAM', externalConversationId: `conversation-${suffix}`,
    participantId: `participant-${suffix}`, lastMessageAt: new Date('2026-09-30T12:00:00.000Z'),
  } });
  const message = await prisma.message.create({ data: {
    tenantId, conversationId: conversation.id, channel: 'INSTAGRAM',
    externalMessageId: `message-${suffix}`, direction: 'INBOUND', senderId: `sender-${suffix}`,
    text: 'Fictional order', sourceTimestamp: new Date('2026-09-30T12:00:00.000Z'),
    clientIdempotencyKey: crypto.randomUUID(),
  } });
  const order = await prisma.order.create({ data: {
    tenantId, conversationId: conversation.id, triggerMessageId: message.id,
    status: 'APPROVED', promptVersion: 'fictional-test-v1',
  } });
  const connection = await prisma.deliveryConnection.create({ data: {
    tenantId, provider: 'UKRPOSHTA', status: 'ACTIVE', encryptedCredential: 'fictional-encrypted-secret',
    credentialGenerationId: crypto.randomUUID(), accountLabel: `Fictional ${suffix}`,
  } });
  await prisma.deliverySenderProfile.create({ data: {
    tenantId, connectionId: connection.id, senderRef: `sender-${suffix}`, contactRef: `contact-${suffix}`,
    contactPhone: '+380000000000', originType: 'BRANCH', originCityRef: `city-${suffix}`,
    originLocationRef: `branch-${suffix}`, defaultWeightKg: 1, defaultLengthCm: 10,
    defaultWidthCm: 10, defaultHeightCm: 10, customerNotificationTemplate: 'Fictional shipment {trackingNumber}',
  } });
  const shipment = await prisma.shipment.create({ data: {
    tenantId, orderId: order.id, connectionId: connection.id, provider: 'UKRPOSHTA', status: 'CREATED',
    senderSnapshot: {}, recipientSnapshot: {}, destinationSnapshot: {}, parcels: [], payer: 'SENDER',
    declaredValue: 100, description: 'Fictional parcel', trackingNumber: `TRACK-${suffix}`,
    nextStatusCheckAt: new Date('2026-09-30T11:00:00.000Z'),
    idempotencyKey: `shipment-${suffix}`, requestHash: suffix.padEnd(64, '0').slice(0, 64),
  } });
  await prisma.shipmentAttempt.create({ data: {
    tenantId, shipmentId: shipment.id, version: 1, operation: 'CREATE', status: 'PENDING',
    idempotencyKey: `attempt-${suffix}`, requestHash: suffix.padEnd(64, '1').slice(0, 64),
    nextAttemptAt: new Date('2026-09-30T11:00:00.000Z'),
  } });
  await prisma.shipmentStatusEvent.create({ data: {
    tenantId, shipmentId: shipment.id, status: 'CREATED', providerCode: 'CREATED',
    occurredAt: new Date('2026-09-30T12:00:00.000Z'),
  } });
  return shipment.id;
}

function runtimeUrl(adminUrl: string, username: string, password: string): string {
  const url = new URL(adminUrl); url.username = username; url.password = password; return url.toString();
}

async function applyMigrations(pool: pg.Pool): Promise<void> {
  const root = resolve(fileURLToPath(new URL('../prisma/migrations', import.meta.url)));
  for (const name of (await readdir(root)).sort()) {
    if (name === 'migration_lock.toml') continue;
    await pool.query(await readFile(resolve(root, name, 'migration.sql'), 'utf8'));
  }
}
