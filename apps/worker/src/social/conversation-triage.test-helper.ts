import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@autosale/database';
import { expect, it, vi } from 'vitest';
import type { SocialChannel } from './normalized-inbound-message.js';
import type { SocialMediaCopier } from './social-inbound-ingestion.service.js';

// Register the same persisted-state contract against each real provider adapter.
export function conversationTriageTests(channel: SocialChannel, context: () => {
  prisma: PrismaClient;
  tenantId: string;
  processor: (media: SocialMediaCopier, schedule: (tenantId: string, messageId: string) => Promise<unknown>, orders: (tenantId: string, messageId: string) => Promise<unknown>) => {
    process(tenantId: string, eventId: string): Promise<unknown>;
  };
}) {
  it.each(['INACTIVE', 'CLOSED'] as const)('reopens %s only for newly inserted newer inbound, including media', async (workflowStatus) => {
    const { prisma, tenantId, processor } = context();
    const participant = `fictional-triage-${randomUUID()}`;
    const changedAt = new Date('2026-01-01T12:00:00Z');
    const newer = new Date(changedAt.getTime() + 1000);
    const actor = await prisma.user.create({ data: { email: `fictional-triage-${randomUUID()}@example.test`, name: 'Fictional manager' } });
    const row = await prisma.conversation.create({ data: {
      tenantId, channel, externalConversationId: participant, participantId: participant,
      lastMessageAt: changedAt, workflowStatus, statusVersion: 7, statusChangedAt: changedAt, statusChangedByUserId: actor.id,
    } });
    const copy = vi.fn().mockResolvedValue({ key: 'fictional/image.jpg', etag: 'etag', checksum: 'checksum', contentType: 'image/jpeg' });
    const schedule = vi.fn(async () => undefined);
    const orders = vi.fn(async () => undefined);
    const worker = processor({ copy }, schedule, orders);
    const event = async (id: string, timestamp: Date, media = false, echo = false) => prisma.webhookEvent.create({ data: {
      tenantId, provider: channel === 'TIKTOK' ? 'TIKTOK' : 'META', externalEventId: randomUUID(),
      payload: channel === 'TIKTOK' ? {
        event: echo ? 'im_send_msg' : 'im_receive_msg', user_openid: 'fictional-shop',
        content: JSON.stringify({ message_id: id, conversation_id: participant, from: participant, timestamp: timestamp.getTime(),
          type: media ? 'image' : 'text', ...(media ? { image: { media_id: 'fictional-image' } } : { text: { body: 'Fictional question' } }) }),
      } : {
        object: channel === 'INSTAGRAM' ? 'instagram' : 'page', entry: [{ id: 'fictional-shop', messaging: [{
          sender: { id: echo ? 'fictional-shop' : participant }, recipient: { id: echo ? participant : 'fictional-shop' },
          timestamp: timestamp.getTime(), message: { mid: id, ...(echo ? { is_echo: true } : {}),
            ...(media ? { attachments: [{ type: 'image', payload: { url: 'https://fictional.example.test/image.jpg' } }] } : { text: 'Fictional question' }) },
        }] }],
      },
    } });
    const media = workflowStatus === 'CLOSED';
    const first = await event(randomUUID(), newer, media);
    await worker.process(tenantId, first.id);
    const reopened = await prisma.conversation.findUniqueOrThrow({ where: { id: row.id } });
    expect(reopened).toMatchObject({ workflowStatus: 'ACTIVE', statusVersion: 8, statusChangedByUserId: null });
    expect(reopened.statusChangedAt!.getTime()).toBeGreaterThan(changedAt.getTime());
    expect(await prisma.message.count({ where: { conversationId: row.id } })).toBe(1);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(orders).toHaveBeenCalledTimes(media ? 0 : 1);
    await worker.process(tenantId, first.id);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: row.id } })).statusVersion).toBe(8);
    // Close again with a deliberately earlier cutoff: replay must be excluded by insertion,
    // not accidentally by the timestamp predicate or already-active state.
    await prisma.conversation.update({ where: { id: row.id }, data: { workflowStatus, statusVersion: 9, statusChangedAt: changedAt } });
    if (media) await prisma.attachment.updateMany({ where: { message: { conversationId: row.id } }, data: { copyStatus: 'RETRYABLE_FAILURE' } });
    await worker.process(tenantId, first.id);
    if (media) expect(copy).toHaveBeenCalledTimes(2);
    for (const timestamp of [new Date(changedAt.getTime() - 1000), changedAt]) {
      await worker.process(tenantId, (await event(randomUUID(), timestamp)).id);
    }
    await worker.process(tenantId, (await event(randomUUID(), newer, false, true)).id);
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: row.id } }))
      .toMatchObject({ workflowStatus, statusVersion: 9, statusChangedAt: changedAt });
  });
}
