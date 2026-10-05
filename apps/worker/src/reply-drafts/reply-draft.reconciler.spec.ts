import { describe, expect, it, vi } from 'vitest';
import { ReplyDraftReconciler } from './reply-draft.reconciler.js';

describe('ReplyDraftReconciler', () => {
  it('wakes due durable draft IDs and marks ambiguous expired work failed', async () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const draftId = '22222222-2222-4222-8222-222222222222';
    const availableAt = new Date('2026-10-05T12:00:00.000Z');
    const query = vi.fn().mockResolvedValueOnce([{ worker_fail_expired_ai_reply_drafts: 1 }]).mockResolvedValueOnce([{
      tenant_id: tenantId, draft_id: draftId, available_at: availableAt,
    }]);
    const add = vi.fn().mockResolvedValue({});
    const result = await new ReplyDraftReconciler(
      { $queryRaw: query } as never,
      { add },
      () => new Date('2026-10-05T11:59:58.000Z'),
    ).reconcile();
    expect(result).toEqual({ expiredFailed: 1, attempted: 1, queued: 1 });
    expect(add).toHaveBeenCalledWith('ai-replies.generate', { tenantId, draftId }, expect.objectContaining({
      attempts: 1, delay: 2_000,
    }));
  });

  it('keeps a missed Redis dispatch recoverable on the next pass', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ worker_fail_expired_ai_reply_drafts: 0 }]).mockResolvedValueOnce([{
      tenant_id: '11111111-1111-4111-8111-111111111111', draft_id: '22222222-2222-4222-8222-222222222222',
      available_at: new Date(),
    }]);
    const add = vi.fn().mockRejectedValue(new Error('fictional Redis outage'));
    const result = await new ReplyDraftReconciler({ $queryRaw: query } as never, { add }).reconcile();
    expect(result).toEqual({ expiredFailed: 0, attempted: 1, queued: 0 });
  });
});
