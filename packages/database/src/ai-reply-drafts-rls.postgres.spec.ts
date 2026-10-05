import { randomUUID } from 'node:crypto';
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

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const apiPassword = 'fictional-api-password-32-characters';
const workerPassword = 'fictional-worker-password-32-chars';
const backupPassword = 'fictional-backup-password-32-chars';

describe('AI reply draft tenant isolation', () => {
  let container: StartedPostgreSqlContainer;
  let admin: pg.Pool;
  let api: PrismaClient;
  let worker: PrismaClient;
  const identities = new Map<string, { conversationId: string; anchorId: string; userId: string; draftId: string }>();

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    admin = new pg.Pool({ connectionString: container.getConnectionUri() });
    const root = resolve(fileURLToPath(new URL('../prisma/migrations', import.meta.url)));
    for (const name of (await readdir(root)).sort()) {
      if (name !== 'migration_lock.toml') await admin.query(await readFile(resolve(root, name, 'migration.sql'), 'utf8'));
    }
    for (const [tenantId, suffix] of [[tenantA, 'alpha'], [tenantB, 'beta']] as const) {
      const [userId, conversationId, anchorId, draftId] = Array.from({ length: 4 }, randomUUID);
      identities.set(tenantId, { userId: userId!, conversationId: conversationId!, anchorId: anchorId!, draftId: draftId! });
      await admin.query('INSERT INTO tenants (id, key, name) VALUES ($1, $2, $3)', [tenantId, suffix, `Fictional ${suffix}`]);
      await admin.query("INSERT INTO users (id, email, name, status, updated_at) VALUES ($1, $2, $3, 'ACTIVE', NOW())", [userId, `${suffix}@example.invalid`, `Fictional ${suffix}`]);
      await admin.query(`INSERT INTO conversations (id, tenant_id, channel, external_conversation_id, participant_id, last_message_at, updated_at)
        VALUES ($1, $2, 'INSTAGRAM', $3, $3, NOW(), NOW())`, [conversationId, tenantId, suffix]);
      const eventId = randomUUID();
      await admin.query(`INSERT INTO webhook_events (id, tenant_id, provider, external_event_id, payload, status)
        VALUES ($1, $2, 'META', $3, '{}'::jsonb, 'PROCESSED')`, [eventId, tenantId, `${suffix}-event`]);
      await admin.query(`INSERT INTO messages (id, tenant_id, conversation_id, raw_event_id, channel, external_message_id, direction, sender_id, text, source_timestamp)
        VALUES ($1, $2, $3, $4, 'INSTAGRAM', $5, 'INBOUND', 'fictional-customer', 'Is the fictional door available?', NOW())`,
      [anchorId, tenantId, conversationId, eventId, `${suffix}-anchor`]);
      await admin.query(`INSERT INTO tenant_reply_styles (id, tenant_id, enabled, company_name, updated_at)
        VALUES ($1, $2, TRUE, $3, NOW())`, [randomUUID(), tenantId, `Fictional ${suffix} shop`]);
      await admin.query(`INSERT INTO ai_reply_drafts
        (id, tenant_id, conversation_id, anchor_message_id, created_by_user_id, idempotency_key, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())`, [draftId, tenantId, conversationId, anchorId, userId, randomUUID()]);
    }
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), { apiPassword, workerPassword, backupPassword });
    const runtimeUrl = (username: string, password: string) => {
      const url = new URL(container.getConnectionUri());
      url.username = username;
      url.password = password;
      return url.toString();
    };
    api = createPrismaClient(runtimeUrl('autosale_api', apiPassword));
    worker = createPrismaClient(runtimeUrl('autosale_worker', workerPassword));
  }, 60_000);

  afterAll(async () => {
    await api?.$disconnect();
    await worker?.$disconnect();
    await admin?.end();
    await container?.stop();
  });

  it('hides styles and drafts without tenant context and between tenants', async () => {
    await expect(api.tenantReplyStyle.findMany()).resolves.toEqual([]);
    await expect(api.aiReplyDraft.findMany()).resolves.toEqual([]);
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.aiReplyDraft.findMany({ select: { tenantId: true } })))
      .resolves.toEqual([{ tenantId: tenantA }]);
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.tenantReplyStyle.findMany({ select: { tenantId: true } })))
      .resolves.toEqual([{ tenantId: tenantA }]);
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.aiReplyDraft.update({
      where: { id: identities.get(tenantB)!.draftId }, data: { status: 'STALE' },
    }))).rejects.toMatchObject({ code: 'P2025' });
  });

  it('rejects cross-tenant conversation and anchor links', async () => {
    const a = identities.get(tenantA)!;
    const b = identities.get(tenantB)!;
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.aiReplyDraft.create({
      data: {
        tenantId: tenantA, conversationId: b.conversationId, anchorMessageId: a.anchorId,
        createdByUserId: a.userId, idempotencyKey: randomUUID(),
      },
    }))).rejects.toBeDefined();
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.aiReplyDraft.create({
      data: {
        tenantId: tenantA, conversationId: a.conversationId, anchorMessageId: b.anchorId,
        createdByUserId: a.userId, idempotencyKey: randomUUID(),
      },
    }))).rejects.toBeDefined();
  });

  it('limits worker discovery to identifiers and denies API execution', async () => {
    const due = await worker.$queryRaw<Array<{ tenant_id: string; draft_id: string }>>`
      SELECT tenant_id, draft_id FROM public.worker_due_ai_reply_drafts(${new Date('2099-01-01T00:00:00Z')}, 50)
    `;
    expect(due.map((row) => row.tenant_id).sort()).toEqual([tenantA, tenantB]);
    expect(Object.keys(due[0]!).sort()).toEqual(['draft_id', 'tenant_id']);
    await expect(api.$queryRaw`
      SELECT tenant_id, draft_id FROM public.worker_due_ai_reply_drafts(${new Date('2099-01-01T00:00:00Z')}, 50)
    `).rejects.toMatchObject({ code: 'P2010' });
  });

  it('fails an expired possible model call without redispatching it', async () => {
    const draftId = identities.get(tenantA)!.draftId;
    await withTenantTransaction(api, tenantA, (tx) => tx.aiReplyDraft.update({
      where: { id: draftId }, data: {
        status: 'PROCESSING', attempts: 1, leaseId: randomUUID(),
        leaseExpiresAt: new Date('2026-10-01T00:00:00Z'),
        modelRequestStartedAt: new Date('2026-10-01T00:00:00Z'),
      },
    }));
    const changed = await worker.$queryRaw<Array<{ worker_fail_expired_ai_reply_drafts: number }>>`
      SELECT public.worker_fail_expired_ai_reply_drafts(${new Date('2026-10-05T00:00:00Z')}, 50)
    `;
    expect(changed[0]?.worker_fail_expired_ai_reply_drafts).toBe(1);
    const due = await worker.$queryRaw<Array<{ draft_id: string }>>`
      SELECT draft_id FROM public.worker_due_ai_reply_drafts(${new Date('2026-10-05T00:00:00Z')}, 50)
    `;
    expect(due.some((row) => row.draft_id === draftId)).toBe(false);
    expect((await withTenantTransaction(api, tenantA, (tx) => tx.aiReplyDraft.findUnique({ where: { id: draftId } })))?.status).toBe('FAILED');
  });
});
