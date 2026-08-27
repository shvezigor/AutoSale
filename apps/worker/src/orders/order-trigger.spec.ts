import { describe, expect, it } from 'vitest';

import { isOrderTrigger } from './order-trigger.js';

describe('isOrderTrigger', () => {
  it('matches a configured phrase in an outbound manager message', () => {
    expect(
      isOrderTrigger(
        { direction: 'OUTBOUND', text: 'Дякуємо! Беремо замовлення в роботу.' },
        ['беремо замовлення в роботу'],
      ),
    ).toBe(true);
  });

  it('does not trigger from the same phrase sent by a customer', () => {
    expect(
      isOrderTrigger(
        { direction: 'INBOUND', text: 'Беремо замовлення в роботу' },
        ['беремо замовлення в роботу'],
      ),
    ).toBe(false);
  });

  it('does not match an empty message or empty configuration', () => {
    expect(isOrderTrigger({ direction: 'OUTBOUND', text: null }, ['замовлення прийнято'])).toBe(
      false,
    );
    expect(
      isOrderTrigger({ direction: 'OUTBOUND', text: 'Замовлення прийнято' }, []),
    ).toBe(false);
  });
});
