import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const userA = '33333333-3333-4333-8333-333333333333';
const userB = '44444444-4444-4444-8444-444444444444';
const connectionA = '55555555-5555-4555-8555-555555555555';
const connectionB = '66666666-6666-4666-8666-666666666666';
const ordersA = [
  '70000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000002',
  '70000000-0000-4000-8000-000000000003',
  '70000000-0000-4000-8000-000000000004',
  '70000000-0000-4000-8000-000000000005',
];
const orderB = '80000000-0000-4000-8000-000000000001';

describe('delivery persistence', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(pool);
    await seedOrderFixtures(pool);
    await pool.query(`INSERT INTO delivery_connections
      (id, tenant_id, provider, status, encrypted_credential, credential_generation_id,
       account_label, connected_by_user_id, last_verified_at, updated_at)
      VALUES ($1, $2, 'NOVA_POSHTA', 'ACTIVE', 'cipher-a', gen_random_uuid(),
              'Відправник A', $3, NOW(), NOW()),
             ($4, $5, 'NOVA_POSHTA', 'ACTIVE', 'cipher-b', gen_random_uuid(),
              'Відправник B', $6, NOW(), NOW())`,
    [connectionA, tenantA, userA, connectionB, tenantB, userB]);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('allows only one connection for a provider inside a tenant', async () => {
    await expect(pool.query(`INSERT INTO delivery_connections
      (tenant_id, provider, status, encrypted_credential, credential_generation_id, updated_at)
      VALUES ($1, 'NOVA_POSHTA', 'ACTIVE', 'duplicate', gen_random_uuid(), NOW())`, [tenantA]))
      .rejects.toMatchObject({ code: '23505' });
  });

  it('prevents a sender profile from referencing another tenant connection', async () => {
    await expect(pool.query(`INSERT INTO delivery_sender_profiles
      (tenant_id, connection_id, sender_ref, contact_ref, contact_phone,
       origin_type, origin_city_ref, origin_location_ref, origin_label, payer,
       default_weight_kg, default_length_cm, default_width_cm, default_height_cm,
       customer_notification_template, updated_at)
      VALUES ($1, $2, 'sender', 'contact', '+380501112233',
              'BRANCH', 'city', 'branch', 'Відділення №1', 'SENDER',
              1, 30, 20, 10, '{company}: {trackingNumber}', NOW())`, [tenantA, connectionB]))
      .rejects.toMatchObject({ code: '23503' });
  });

  it('prevents a shipment from referencing another tenant order', async () => {
    await expect(insertShipment(pool, {
      tenantId: tenantA,
      orderId: orderB,
      connectionId: connectionA,
      status: 'DRAFT',
      idempotencyKey: 'shipment:cross-tenant',
    })).rejects.toMatchObject({ code: '23503' });
  });

  it('allows only one active shipment per order', async () => {
    await insertShipment(pool, {
      tenantId: tenantA,
      orderId: ordersA[0]!,
      connectionId: connectionA,
      status: 'DRAFT',
      idempotencyKey: 'shipment:active:first',
    });

    await expect(insertShipment(pool, {
      tenantId: tenantA,
      orderId: ordersA[0]!,
      connectionId: connectionA,
      status: 'CREATED',
      idempotencyKey: 'shipment:active:second',
    })).rejects.toMatchObject({ code: '23505' });
  });

  it('allows a replacement shipment after cancellation', async () => {
    const first = await insertShipment(pool, {
      tenantId: tenantA,
      orderId: ordersA[1]!,
      connectionId: connectionA,
      status: 'DRAFT',
      idempotencyKey: 'shipment:replace:first',
    });
    await pool.query(`UPDATE shipments SET status = 'CANCELLED', cancelled_at = NOW(), updated_at = NOW()
      WHERE id = $1`, [first]);

    await expect(insertShipment(pool, {
      tenantId: tenantA,
      orderId: ordersA[1]!,
      connectionId: connectionA,
      status: 'DRAFT',
      idempotencyKey: 'shipment:replace:second',
    })).resolves.toBeTypeOf('string');
  });

  it('keeps shipment intent idempotency unique inside a tenant', async () => {
    await insertShipment(pool, {
      tenantId: tenantA,
      orderId: ordersA[2]!,
      connectionId: connectionA,
      status: 'FAILED',
      idempotencyKey: 'shipment:create:v1:stable',
    });

    await expect(insertShipment(pool, {
      tenantId: tenantA,
      orderId: ordersA[3]!,
      connectionId: connectionA,
      status: 'FAILED',
      idempotencyKey: 'shipment:create:v1:stable',
    })).rejects.toMatchObject({ code: '23505' });

    await expect(insertShipment(pool, {
      tenantId: tenantB,
      orderId: orderB,
      connectionId: connectionB,
      status: 'FAILED',
      idempotencyKey: 'shipment:create:v1:stable',
    })).resolves.toBeTypeOf('string');
  });

  it('cascades shipment status events only with their own shipment', async () => {
    const shipmentId = await insertShipment(pool, {
      tenantId: tenantA,
      orderId: ordersA[4]!,
      connectionId: connectionA,
      status: 'FAILED',
      idempotencyKey: 'shipment:event:cascade',
    });
    await pool.query(`INSERT INTO shipment_status_events
      (tenant_id, shipment_id, status, provider_code, occurred_at)
      VALUES ($1, $2, 'FAILED', 'provider-error', NOW())`, [tenantA, shipmentId]);

    await pool.query('DELETE FROM shipments WHERE id = $1', [shipmentId]);
    const events = await pool.query('SELECT id FROM shipment_status_events WHERE shipment_id = $1', [shipmentId]);

    expect(events.rowCount).toBe(0);
    expect(await pool.query('SELECT id FROM orders WHERE id = $1', [ordersA[4]])).toMatchObject({ rowCount: 1 });
  });
});

async function insertShipment(pool: pg.Pool, input: {
  tenantId: string;
  orderId: string;
  connectionId: string;
  status: string;
  idempotencyKey: string;
}): Promise<string> {
  const result = await pool.query<{ id: string }>(`INSERT INTO shipments
    (tenant_id, order_id, connection_id, provider, status,
     sender_snapshot, recipient_snapshot, destination_snapshot, parcels,
     payer, declared_value, cod_amount, description, currency,
     version, idempotency_key, request_hash, updated_at)
    VALUES ($1, $2, $3, 'NOVA_POSHTA', $4,
            '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb,
            'RECIPIENT', 2500, NULL, 'Двері', 'UAH',
            1, $5, 'request-hash', NOW())
    RETURNING id`, [input.tenantId, input.orderId, input.connectionId, input.status, input.idempotencyKey]);
  return result.rows[0]!.id;
}

async function seedOrderFixtures(pool: pg.Pool): Promise<void> {
  await pool.query(`INSERT INTO tenants (id, key, name) VALUES
    ($1, 'delivery-a', 'Delivery A'), ($2, 'delivery-b', 'Delivery B')`, [tenantA, tenantB]);
  await pool.query(`INSERT INTO users (id, email, name, status, updated_at) VALUES
    ($1, 'delivery-a@example.com', 'User A', 'ACTIVE', NOW()),
    ($2, 'delivery-b@example.com', 'User B', 'ACTIVE', NOW())`, [userA, userB]);

  for (const [index, orderId] of [...ordersA, orderB].entries()) {
    const inTenantA = index < ordersA.length;
    const tenantId = inTenantA ? tenantA : tenantB;
    const token = String(index + 1).padStart(12, '0');
    const conversationId = `90000000-0000-4000-8000-${token}`;
    const messageId = `91000000-0000-4000-8000-${token}`;
    await pool.query(`INSERT INTO conversations
      (id, tenant_id, channel, external_conversation_id, participant_id, last_message_at, updated_at)
      VALUES ($1, $2, 'INSTAGRAM', $3, $3, NOW(), NOW())`,
    [conversationId, tenantId, `delivery-conversation-${index}`]);
    await pool.query(`INSERT INTO messages
      (id, tenant_id, conversation_id, channel, external_message_id, direction, sender_id, text,
       source_timestamp, client_idempotency_key, sent_by_user_id, delivery_status,
       next_delivery_attempt_at)
      VALUES ($1, $2, $3, 'INSTAGRAM', $4, 'OUTBOUND', 'manager', 'Підтверджено',
              NOW(), $1, $5, 'SENT', NOW())`,
    [messageId, tenantId, conversationId, `delivery-message-${index}`, inTenantA ? userA : userB]);
    await pool.query(`INSERT INTO orders
      (id, tenant_id, conversation_id, trigger_message_id, status, prompt_version, updated_at)
      VALUES ($1, $2, $3, $4, 'APPROVED', 'instagram-order-v2', NOW())`,
    [orderId, tenantId, conversationId, messageId]);
  }
}

async function applyMigrations(pool: pg.Pool): Promise<void> {
  const root = resolve(fileURLToPath(new URL('../prisma/migrations', import.meta.url)));
  for (const name of (await readdir(root)).sort()) {
    if (name === 'migration_lock.toml') continue;
    await pool.query(await readFile(resolve(root, name, 'migration.sql'), 'utf8'));
  }
}
