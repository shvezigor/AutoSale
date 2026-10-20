import { describe, expect, it } from 'vitest';

import { conversionEventSchema } from './conversion-events.js';

describe('public conversion event contract', () => {
  it('accepts only the fixed anonymous event and approved plan vocabulary', () => {
    expect(conversionEventSchema.safeParse({ event: 'pricing_view', locale: 'uk' }).success).toBe(true);
    expect(conversionEventSchema.safeParse({ event: 'registration_arrival', locale: 'en' }).success).toBe(true);
    expect(conversionEventSchema.safeParse({ event: 'plan_interest', locale: 'en', planId: 'start' }).success).toBe(true);
    for (const payload of [
      { event: 'pricing_view', locale: 'uk', email: 'fictional@example.test' },
      { event: 'pricing_view', locale: 'uk', url: 'https://example.test/?search=private' },
      { event: 'plan_interest', locale: 'en', planId: 'enterprise' },
      { event: 'plan_interest', locale: 'en' },
      { event: 'account_registered', locale: 'uk' },
      { event: 'first_order_confirmed', locale: 'uk' },
      { event: 'demo_intent', locale: 'uk' },
    ]) expect(conversionEventSchema.safeParse(payload).success).toBe(false);
  });
});
