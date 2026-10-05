import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPrismaClient, type PrismaClient } from '@autosale/database';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AutomaticReplyDraftScheduler } from './automatic-reply-draft.scheduler.js';

describe('AutomaticReplyDraftScheduler', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    const root = resolve(process.cwd(), '../../packages/database/prisma/migrations');
    for (const name of (await readdir(root)).sort()) {
      if (name !== 'migration_lock.toml') await pool.query(await readFile(resolve(root, name, 'migration.sql'), 'utf8'));
    }
    await pool.end();
    prisma = createPrismaClient(container.getConnectionUri());
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  async function seed(text: string | null = 'Do you have fictional doors?') {
    const tenant = await prisma.tenant.create({ data: { key: randomUUID(), name: 'Fictional shop' } });
    await prisma.tenantReplyStyle.create({
      data: { tenantId: tenant.id, enabled: true, companyName: 'Fictional shop' },
    });
    const conversation = await prisma.conversation.create({ data: {
      tenantId: tenant.id, channel: 'INSTAGRAM', externalConversationId: randomUUID(),
      participantId: 'fictional-customer', lastMessageAt: new Date(),
    } });
    const event = await prisma.webhookEvent.create({ data: {
      tenantId: tenant.id, provider: 'META', externalEventId: randomUUID(), payload: {},
    } });
    const message = await prisma.message.create({ data: {
      tenantId: tenant.id, conversationId: conversation.id, rawEventId: event.id,
      channel: 'INSTAGRAM', externalMessageId: randomUUID(), direction: 'INBOUND',
      senderId: 'fictional-customer', text, sourceTimestamp: new Date(),
    } });
    return { tenantId: tenant.id, conversationId: conversation.id, eventId: event.id, messageId: message.id };
  }

  it('persists a system-attributed draft and queues it after ten seconds', async () => {
    const input = await seed();
    const add = vi.fn().mockResolvedValue(undefined);
    const now = new Date('2026-10-05T12:00:00.000Z');

    const result = await new AutomaticReplyDraftScheduler(prisma, { add }, () => now)
      .schedule(input.tenantId, input.messageId);

    expect(result).toBe('SCHEDULED');
    const draft = await prisma.aiReplyDraft.findFirstOrThrow({ where: { tenantId: input.tenantId } });
    expect(draft).toMatchObject({
      anchorMessageId: input.messageId,
      createdByUserId: null,
      triggerSource: 'AUTOMATIC',
      status: 'QUEUED',
      idempotencyKey: input.messageId,
      availableAt: new Date('2026-10-05T12:00:10.000Z'),
    });
    expect(add).toHaveBeenCalledWith('ai-replies.generate', {
      tenantId: input.tenantId, draftId: draft.id,
    }, expect.objectContaining({ jobId: `ai-reply-${draft.id}`, delay: 10_000 }));
  });

  it('replays the same durable draft for duplicate delivery', async () => {
    const input = await seed();
    const add = vi.fn().mockResolvedValue(undefined);
    const scheduler = new AutomaticReplyDraftScheduler(prisma, { add }, () => new Date('2026-10-05T12:00:00.000Z'));

    expect(await scheduler.schedule(input.tenantId, input.messageId)).toBe('SCHEDULED');
    expect(await scheduler.schedule(input.tenantId, input.messageId)).toBe('REPLAYED');
    expect(await prisma.aiReplyDraft.count({ where: { tenantId: input.tenantId } })).toBe(1);
  });

  it('makes the older draft stale when a later inbound message is persisted', async () => {
    const input = await seed();
    const scheduler = new AutomaticReplyDraftScheduler(
      prisma, { add: vi.fn().mockResolvedValue(undefined) }, () => new Date('2026-10-05T12:00:00.000Z'),
    );
    expect(await scheduler.schedule(input.tenantId, input.messageId)).toBe('SCHEDULED');
    const later = await prisma.message.create({ data: {
      tenantId: input.tenantId, conversationId: input.conversationId, rawEventId: input.eventId,
      channel: 'INSTAGRAM', externalMessageId: randomUUID(), direction: 'INBOUND',
      senderId: 'fictional-customer', text: 'And what colors?', sourceTimestamp: new Date('2020-01-01T00:00:00Z'),
    } });

    expect(await scheduler.schedule(input.tenantId, later.id)).toBe('SCHEDULED');
    const drafts = await prisma.aiReplyDraft.findMany({ where: { tenantId: input.tenantId }, orderBy: { createdAt: 'asc' } });
    expect(drafts.map(({ anchorMessageId, status }) => ({ anchorMessageId, status }))).toEqual([
      { anchorMessageId: input.messageId, status: 'STALE' },
      { anchorMessageId: later.id, status: 'QUEUED' },
    ]);
  });

  it.each([
    ['disabled style', false, 'usable text'],
    ['blank text', true, '   '],
    ['image-only message', true, null],
  ])('skips %s without invoking the model queue', async (_label, enabled, text) => {
    const input = await seed(text);
    await prisma.tenantReplyStyle.update({ where: { tenantId: input.tenantId }, data: { enabled } });
    const add = vi.fn();

    expect(await new AutomaticReplyDraftScheduler(prisma, { add }).schedule(input.tenantId, input.messageId))
      .toBe('SKIPPED');
    expect(add).not.toHaveBeenCalled();
    expect(await prisma.aiReplyDraft.count({ where: { tenantId: input.tenantId } })).toBe(0);
  });
});
