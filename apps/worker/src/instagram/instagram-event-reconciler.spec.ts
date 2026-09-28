import { describe, expect, it, vi } from 'vitest';

import { InstagramEventReconciler } from './instagram-event-reconciler.js';

describe('InstagramEventReconciler', () => {
  it('re-enqueues persisted RECEIVED events with stable queue identities', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: '11111111-1111-4111-8111-111111111111' },
      { id: '22222222-2222-4222-8222-222222222222' },
    ]);
    const add = vi.fn().mockResolvedValue(undefined);
    const reconciler = new InstagramEventReconciler(
      {
        webhookEvent: { findMany },
        message: { findMany: vi.fn().mockResolvedValue([]) },
      } as never,
      { add } as never,
    );

    await expect(reconciler.reconcile()).resolves.toEqual({ attempted: 2, failed: 0 });
    expect(findMany).toHaveBeenCalledWith({
      where: { provider: 'META', status: 'RECEIVED' },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: { id: true },
    });
    expect(add).toHaveBeenNthCalledWith(
      1,
      'instagram.normalize',
      {
        eventId: '11111111-1111-4111-8111-111111111111',
        correlationId: '11111111-1111-4111-8111-111111111111',
      },
      { jobId: '11111111-1111-4111-8111-111111111111', removeOnFail: true },
    );
  });

  it('re-enqueues processed attachment-only messages that were normalized as empty', async () => {
    const findPending = vi.fn().mockResolvedValue([]);
    const findMessages = vi.fn().mockResolvedValue([
      { rawEventId: '33333333-3333-4333-8333-333333333333' },
    ]);
    const add = vi.fn().mockResolvedValue(undefined);
    const reconciler = new InstagramEventReconciler(
      {
        webhookEvent: { findMany: findPending },
        message: { findMany: findMessages },
      } as never,
      { add } as never,
    );

    await expect(reconciler.reconcile()).resolves.toEqual({ attempted: 1, failed: 0 });
    expect(findMessages).toHaveBeenCalledWith({
      where: {
        channel: 'INSTAGRAM',
        rawEventId: { not: null },
        OR: [
          { text: null, attachments: { none: {} } },
          {
            attachments: {
              some: {
                type: 'IMAGE',
                copyStatus: 'FAILED',
                failureSummary: {
                  in: [
                    'Unsupported media type: video/mp4',
                    'Media exceeds the configured byte ceiling',
                  ],
                },
              },
            },
          },
        ],
      },
      distinct: ['rawEventId'],
      orderBy: [{ sourceTimestamp: 'asc' }, { id: 'asc' }],
      take: 100,
      select: { rawEventId: true },
    });
    expect(add).toHaveBeenCalledWith(
      'instagram.normalize',
      {
        eventId: '33333333-3333-4333-8333-333333333333',
        correlationId: '33333333-3333-4333-8333-333333333333',
      },
      { jobId: 'instagram-attachment-backfill-33333333-3333-4333-8333-333333333333', removeOnFail: true },
    );
  });

  it('re-enqueues the event for an MP4 that legacy image-only handling rejected', async () => {
    const findMessages = vi.fn().mockResolvedValue([
      { rawEventId: '44444444-4444-4444-8444-444444444444' },
    ]);
    const add = vi.fn().mockResolvedValue(undefined);
    const reconciler = new InstagramEventReconciler(
      {
        webhookEvent: { findMany: vi.fn().mockResolvedValue([]) },
        message: { findMany: findMessages },
      } as never,
      { add } as never,
    );

    await expect(reconciler.reconcile()).resolves.toEqual({ attempted: 1, failed: 0 });
    expect(findMessages).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          {
            attachments: {
              some: {
                type: 'IMAGE',
                copyStatus: 'FAILED',
                failureSummary: {
                  in: [
                    'Unsupported media type: video/mp4',
                    'Media exceeds the configured byte ceiling',
                  ],
                },
              },
            },
          },
        ]),
      }),
    }));
    expect(add).toHaveBeenCalledWith(
      'instagram.normalize',
      {
        eventId: '44444444-4444-4444-8444-444444444444',
        correlationId: '44444444-4444-4444-8444-444444444444',
      },
      {
        jobId: 'instagram-attachment-backfill-44444444-4444-4444-8444-444444444444',
        removeOnFail: true,
      },
    );
  });

  it('continues after one queue failure so another pending event can recover', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'event-1' }, { id: 'event-2' }]);
    const add = vi.fn().mockRejectedValueOnce(new Error('redis unavailable')).mockResolvedValueOnce(undefined);
    const reconciler = new InstagramEventReconciler(
      {
        webhookEvent: { findMany },
        message: { findMany: vi.fn().mockResolvedValue([]) },
      } as never,
      { add } as never,
    );

    await expect(reconciler.reconcile()).resolves.toEqual({ attempted: 2, failed: 1 });
    expect(add).toHaveBeenCalledTimes(2);
  });
});
