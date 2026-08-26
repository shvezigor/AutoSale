import { describe, expect, it } from 'vitest';

import { registerMetaEventSchema } from './meta.js';

describe('registerMetaEventSchema', () => {
  it('accepts a stable Meta event identity and JSON payload', () => {
    const input = {
      tenantId: '9f3ee8dc-a0eb-44f7-a072-6f9ecf20778d',
      externalEventId: 'm_text_001',
      payload: { object: 'instagram', entry: [] },
    };

    expect(registerMetaEventSchema.parse(input)).toEqual(input);
  });

  it('rejects an empty external event identity', () => {
    expect(() =>
      registerMetaEventSchema.parse({
        tenantId: '9f3ee8dc-a0eb-44f7-a072-6f9ecf20778d',
        externalEventId: '',
        payload: {},
      }),
    ).toThrow();
  });
});
