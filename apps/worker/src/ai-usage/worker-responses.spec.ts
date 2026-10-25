import { describe, expect, it, vi } from 'vitest';
import type { AiUsageContext } from '@autosale/database';

import { createWorkerResponses } from './worker-responses.js';

const context: AiUsageContext = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  operationId: '22222222-2222-4222-8222-222222222222',
  purpose: 'REPLY_DRAFT',
};

describe('worker usage collection switch', () => {
  it.each([false, true])('preserves the provider result with collection enabled=%s', async (enabled) => {
    const response = { id: 'resp-fictional', model: 'fictional-model', output_text: 'fictional',
      usage: { input_tokens: 10, output_tokens: 2 } };
    const create = vi.fn().mockResolvedValue(response);
    const factory = vi.fn().mockReturnValue({ responses: { create } });
    const store = { start: vi.fn().mockResolvedValue(undefined), finalize: vi.fn().mockResolvedValue(true) };
    const boundary = createWorkerResponses('fictional-key', enabled, store, vi.fn(), factory);
    expect(await boundary.create(context, { model: 'fictional-model', input: 'fictional' })).toBe(response);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ model: 'fictional-model', input: 'fictional', store: false });
    if (enabled) {
      expect(factory).toHaveBeenCalledWith({ apiKey: 'fictional-key', maxRetries: 0 });
      expect(store.start).toHaveBeenCalledTimes(1);
      expect(store.finalize).toHaveBeenCalledWith(context, expect.any(String), 'REPORTED',
        { inputTokens: 10, outputTokens: 2, cachedInputTokens: null }, 'fictional-model', expect.any(Date));
    } else {
      expect(factory).toHaveBeenCalledWith({ apiKey: 'fictional-key' });
      expect(store.start).not.toHaveBeenCalled();
      expect(store.finalize).not.toHaveBeenCalled();
    }
  });
});
