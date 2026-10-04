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
const backupPassword = 'fictional-backup-password-32-chars';
const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const eventA = '33333333-3333-4333-8333-333333333333';
const eventB = '44444444-4444-4444-8444-444444444444';
const profileA = '55555555-5555-4555-8555-555555555555';
const profileB = '66666666-6666-4666-8666-666666666666';
const attachmentA = '77777777-7777-4777-8777-777777777777';
const attachmentB = '88888888-8888-4888-8888-888888888888';

describe('Instagram event, profile, and attachment row-level security', () => {
  let container: StartedPostgreSqlContainer;
  let admin: pg.Pool;
  let api: PrismaClient;
  let worker: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    admin = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(admin);
    await seedTenantAssets(admin, tenantA, eventA, profileA, attachmentA, 'tenant-a');
    await seedTenantAssets(admin, tenantB, eventB, profileB, attachmentB, 'tenant-b');
    await admin.query(`UPDATE webhook_events SET status = 'PROCESSED' WHERE id = $1`, [eventB]);
    await admin.query(`UPDATE attachments
      SET copy_status = 'FAILED', failure_summary = 'Unsupported media type: video/mp4'
      WHERE id = $1`, [attachmentB]);
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), { apiPassword, workerPassword, backupPassword });
    api = createPrismaClient(runtimeUrl(container.getConnectionUri(), 'autosale_api', apiPassword));
    worker = createPrismaClient(runtimeUrl(container.getConnectionUri(), 'autosale_worker', workerPassword));
  }, 60_000);

  afterAll(async () => {
    await api?.$disconnect();
    await worker?.$disconnect();
    await admin?.end();
    await container?.stop();
  });

  it('hides webhook payloads, customer profiles, and attachments until a tenant is selected', async () => {
    await expect(api.webhookEvent.findMany()).resolves.toEqual([]);
    await expect(api.instagramCustomerProfile.findMany()).resolves.toEqual([]);
    await expect(api.attachment.findMany()).resolves.toEqual([]);

    await expect(withTenantTransaction(api, tenantA, (tx) => tx.webhookEvent.findMany({
      select: { id: true, tenantId: true },
    }))).resolves.toEqual([{ id: eventA, tenantId: tenantA }]);
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.instagramCustomerProfile.findMany({
      select: { id: true, tenantId: true },
    }))).resolves.toEqual([{ id: profileA, tenantId: tenantA }]);
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.attachment.findMany({
      select: { id: true },
    }))).resolves.toEqual([{ id: attachmentA }]);
  });

  it('rejects cross-tenant event, profile, and attachment updates', async () => {
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.webhookEvent.update({
      where: { id: eventB },
      data: { status: 'PROCESSED' },
    }))).rejects.toMatchObject({ code: 'P2025' });
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.instagramCustomerProfile.update({
      where: { id: profileB },
      data: { displayName: 'Forbidden' },
    }))).rejects.toMatchObject({ code: 'P2025' });
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.attachment.update({
      where: { id: attachmentB },
      data: { failureSummary: 'Forbidden' },
    }))).rejects.toMatchObject({ code: 'P2025' });
  });

  it('allows only the worker to discover bounded event and profile identifiers', async () => {
    const events = await worker.$queryRaw<Array<{ tenant_id: string; event_id: string }>>`
      SELECT tenant_id, event_id
      FROM public.worker_due_instagram_events(100)
      ORDER BY tenant_id
    `;
    expect(events).toEqual([
      { tenant_id: tenantA, event_id: eventA },
      { tenant_id: tenantB, event_id: eventB },
    ]);

    const profiles = await worker.$queryRaw<Array<{ tenant_id: string; profile_id: string }>>`
      SELECT tenant_id, profile_id
      FROM public.worker_due_instagram_profiles(${new Date('2099-01-01T00:00:00.000Z')}, 100)
      ORDER BY tenant_id
    `;
    expect(profiles).toEqual([
      { tenant_id: tenantA, profile_id: profileA },
      { tenant_id: tenantB, profile_id: profileB },
    ]);

    await expect(api.$queryRaw`SELECT * FROM public.worker_due_instagram_events(100)`)
      .rejects.toMatchObject({ code: 'P2010' });
    await expect(api.$queryRaw`
      SELECT * FROM public.worker_due_instagram_profiles(${new Date('2099-01-01T00:00:00.000Z')}, 100)
    `).rejects.toMatchObject({ code: 'P2010' });
  });

  it('routes a durable TikTok event to the TikTok normalizer without exposing its payload', async () => {
    const tikTokEventId = '99999999-9999-4999-8999-999999999999';
    await admin.query(`INSERT INTO webhook_events
      (id, tenant_id, provider, external_event_id, payload, status)
      VALUES ($1, $2, 'TIKTOK', 'tiktok:fictional-message', '{"fictional":true}'::jsonb, 'RECEIVED')`,
    [tikTokEventId, tenantA]);

    await expect(worker.$queryRaw<Array<{ tenant_id: string; event_id: string; job_name: string }>>`
      SELECT tenant_id, event_id, job_name
      FROM public.worker_due_instagram_events(100)
      WHERE event_id = ${tikTokEventId}::uuid
    `).resolves.toEqual([{ tenant_id: tenantA, event_id: tikTokEventId, job_name: 'tiktok.normalize' }]);
  });
});

async function seedTenantAssets(
  pool: pg.Pool,
  tenantId: string,
  eventId: string,
  profileId: string,
  attachmentId: string,
  suffix: string,
): Promise<void> {
  const conversationId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  await pool.query('INSERT INTO tenants (id, key, name) VALUES ($1, $2, $3)', [tenantId, suffix, `Fictional ${suffix}`]);
  await pool.query(`INSERT INTO webhook_events
    (id, tenant_id, provider, external_event_id, payload, status)
    VALUES ($1, $2, 'META', $3, '{"fictional":true}'::jsonb, 'RECEIVED')`, [eventId, tenantId, `${suffix}-event`]);
  await pool.query(`INSERT INTO instagram_customer_profiles
    (id, tenant_id, participant_id, status, next_attempt_at, updated_at)
    VALUES ($1, $2, $3, 'PENDING', NOW(), NOW())`, [profileId, tenantId, `${suffix}-participant`]);
  await pool.query(`INSERT INTO conversations
    (id, tenant_id, channel, external_conversation_id, participant_id, profile_id, last_message_at, updated_at)
    VALUES ($1, $2, 'INSTAGRAM', $3, $3, $4, NOW(), NOW())`, [conversationId, tenantId, suffix, profileId]);
  await pool.query(`INSERT INTO messages
    (id, tenant_id, conversation_id, raw_event_id, channel, external_message_id, direction, sender_id, source_timestamp)
    VALUES ($1, $2, $3, $4, 'INSTAGRAM', $5, 'INBOUND', 'fictional-customer', NOW())`,
  [messageId, tenantId, conversationId, eventId, `${suffix}-message`]);
  await pool.query(`INSERT INTO attachments
    (id, message_id, type, original_url, copy_status, updated_at)
    VALUES ($1, $2, 'IMAGE', $3, 'PENDING', NOW())`, [attachmentId, messageId, `https://example.invalid/${suffix}.jpg`]);
}

function runtimeUrl(adminUrl: string, username: string, password: string): string {
  const url = new URL(adminUrl);
  url.username = username;
  url.password = password;
  return url.toString();
}

async function applyMigrations(pool: pg.Pool): Promise<void> {
  const root = resolve(fileURLToPath(new URL('../prisma/migrations', import.meta.url)));
  for (const name of (await readdir(root)).sort()) {
    if (name === 'migration_lock.toml') continue;
    await pool.query(await readFile(resolve(root, name, 'migration.sql'), 'utf8'));
  }
}
