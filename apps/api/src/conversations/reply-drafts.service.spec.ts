import { randomUUID } from 'node:crypto';

import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ReplyDraftsService } from './reply-drafts.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const anchorId = '33333333-3333-4333-8333-333333333333';
const actorId = '44444444-4444-4444-8444-444444444444';
const now = new Date('2026-10-05T10:00:00.000Z');

function harness(options: { enabled?: boolean; anchor?: string | null; queueFails?: boolean; existing?: object | null } = {}) {
  const key = randomUUID();
  const draft = {
    id: randomUUID(), tenantId, conversationId, anchorMessageId: anchorId, createdByUserId: actorId,
    idempotencyKey: key, status: 'QUEUED', outcome: null, generatedText: null,
    finalText: null, sourceSnapshot: null, errorCode: null, createdAt: now, updatedAt: now,
  };
  const create = vi.fn().mockResolvedValue(draft);
  const findFirstDraft = vi.fn().mockResolvedValue(options.existing ?? null);
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([{ available: true }]),
    conversation: { findFirst: vi.fn().mockResolvedValue({ id: conversationId }) },
    tenantReplyStyle: { findUnique: vi.fn().mockResolvedValue({ enabled: options.enabled ?? true }) },
    message: { findFirst: vi.fn().mockResolvedValue(options.anchor === null ? null : { id: options.anchor ?? anchorId }) },
    aiReplyDraft: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }), findFirst: findFirstDraft,
      count: vi.fn().mockResolvedValue(0), create,
    },
  };
  const prisma = { $transaction: (fn: (tx: unknown) => unknown) => fn(transaction) };
  const queue = { add: options.queueFails ? vi.fn().mockRejectedValue(new Error('fictional outage')) : vi.fn().mockResolvedValue({}) };
  return { service: new ReplyDraftsService(prisma as never, queue), transaction, queue, draft, create, key };
}

describe('ReplyDraftsService', () => {
  it('creates a durable draft before waking the queue', async () => {
    const { service, create, queue, key } = harness();
    const summary = await service.create(tenantId, actorId, conversationId, key);
    expect(create).toHaveBeenCalledOnce();
    expect(summary.status).toBe('QUEUED');
    expect(queue.add).toHaveBeenCalledWith('ai-replies.generate', { tenantId, draftId: summary.id }, expect.objectContaining({ attempts: 1 }));
  });

  it('replays an existing request without inserting another row', async () => {
    const existing = { ...harness().draft, idempotencyKey: '55555555-5555-4555-8555-555555555555' };
    const { service, create } = harness({ existing });
    expect((await service.create(tenantId, actorId, conversationId, existing.idempotencyKey)).id).toBe(existing.id);
    expect(create).not.toHaveBeenCalled();
  });

  it('leaves the committed draft queued when Redis wake-up fails', async () => {
    const { service, create, key } = harness({ queueFails: true });
    expect((await service.create(tenantId, actorId, conversationId, key)).status).toBe('QUEUED');
    expect(create).toHaveBeenCalledOnce();
  });

  it('rejects disabled style and missing inbound anchor', async () => {
    const disabled = harness({ enabled: false });
    await expect(disabled.service.create(tenantId, actorId, conversationId, disabled.key)).rejects.toBeInstanceOf(ConflictException);
    const noAnchor = harness({ anchor: null });
    await expect(noAnchor.service.create(tenantId, actorId, conversationId, noAnchor.key)).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not expose another tenant conversation', async () => {
    const { service, transaction, key } = harness();
    transaction.conversation.findFirst.mockResolvedValue(null as never);
    await expect(service.create(tenantId, actorId, conversationId, key)).rejects.toBeInstanceOf(NotFoundException);
  });
});
