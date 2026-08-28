import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPrismaClient, type PrismaClient } from '@autosale/database';
import { NotFoundException } from '@nestjs/common';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConversationsService } from './conversations.service.js';

describe('ConversationsService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: ConversationsService;
  let tenantId: string;
  let newestId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const connectionString = container.getConnectionUri();
    const pool = new pg.Pool({ connectionString });
    for (const migrationName of [
      '20260826090000_init_webhook_events',
      '20260826123000_conversations_messages',
      '20260827160000_self_hosted_auth',
      '20260827170000_tenant_access_status',
      '20260828150000_instagram_oauth_attempt_guard',
    ]) {
      const sql = await readFile(
        resolve(
          process.cwd(),
          `../../packages/database/prisma/migrations/${migrationName}/migration.sql`,
        ),
        'utf8',
      );
      await pool.query(sql);
    }
    await pool.end();
    prisma = createPrismaClient(connectionString);
    const tenant = await prisma.tenant.create({ data: { key: 'a', name: 'A' } });
    const otherTenant = await prisma.tenant.create({ data: { key: 'b', name: 'B' } });
    tenantId = tenant.id;
    service = new ConversationsService(prisma);

    const event = await prisma.webhookEvent.create({
      data: { tenantId, provider: 'META', externalEventId: 'seed-a', payload: {} },
    });
    const times = [
      new Date('2026-08-26T10:00:00.000Z'),
      new Date('2026-08-26T11:00:00.000Z'),
      new Date('2026-08-26T12:00:00.000Z'),
    ];
    for (const [index, lastMessageAt] of times.entries()) {
      const conversation = await prisma.conversation.create({
        data: {
          tenantId,
          channel: 'INSTAGRAM',
          externalConversationId: `user-${index}`,
          participantId: `user-${index}`,
          displayName: `Клієнт ${index}`,
          lastMessageAt,
        },
      });
      await prisma.message.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          rawEventId: event.id,
          channel: 'INSTAGRAM',
          externalMessageId: `message-${index}`,
          direction: 'INBOUND',
          senderId: `user-${index}`,
          text: `Повідомлення ${index}`,
          sourceTimestamp: lastMessageAt,
        },
      });
      if (index === 2) newestId = conversation.id;
    }
    await prisma.conversation.create({
      data: {
        tenantId: otherTenant.id,
        channel: 'INSTAGRAM',
        externalConversationId: 'foreign-user',
        participantId: 'foreign-user',
        lastMessageAt: new Date('2026-08-26T13:00:00.000Z'),
      },
    });
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('orders newest first, isolates the tenant, and paginates by cursor', async () => {
    const first = await service.list(tenantId, { limit: 2 });
    const second = await service.list(tenantId, { limit: 2, cursor: first.nextCursor! });

    expect(first.items.map((item) => item.lastMessagePreview)).toEqual([
      'Повідомлення 2',
      'Повідомлення 1',
    ]);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(second.items.map((item) => item.lastMessagePreview)).toEqual(['Повідомлення 0']);
    expect(second.nextCursor).toBeNull();
  });

  it('returns an ordered conversation detail without source object URLs', async () => {
    const detail = await service.detail(tenantId, newestId);

    expect(detail).toMatchObject({
      id: newestId,
      channel: 'INSTAGRAM',
      messages: [{ text: 'Повідомлення 2' }],
    });
  });

  it('treats foreign and unknown conversation ids as not found', async () => {
    const foreign = await prisma.conversation.findFirstOrThrow({
      where: { tenantId: { not: tenantId } },
    });

    await expect(service.detail(tenantId, foreign.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.detail(tenantId, '11111111-1111-4111-8111-111111111111')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
