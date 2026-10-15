import { describe, expect, it } from 'vitest';
import { validateReplyDraft, type GeneratedReply } from './claim-validator.js';

const productId = '11111111-1111-4111-8111-111111111111';
const source = [{
  productId, sku: 'DOOR-7', name: 'Fictional door', variants: { size: '90x200' },
  price: '1500.00', currency: 'UAH', stockQuantity: 0,
  updatedAt: '2026-10-05T10:00:00.000Z',
}];
const claim = (text: string, fragment: string, type: GeneratedReply['claims'][number]['type'], field: string) => ({
  start: text.indexOf(fragment), end: text.indexOf(fragment) + fragment.length,
  text: fragment, type, field, productId,
});

describe('validateReplyDraft', () => {
  it('accepts exact facts including zero stock with exhaustive spans', () => {
    const text = 'DOOR-7 має розмір 90x200, ціна 1500.00 UAH, немає в наявності.';
    const result: GeneratedReply = {
      outcome: 'ANSWER', text, productIds: [productId],
      claims: [
        claim(text, 'DOOR-7', 'SKU', 'sku'), claim(text, '90x200', 'VARIANT', 'size'),
        claim(text, '1500.00', 'PRICE', 'price'), claim(text, 'UAH', 'CURRENCY', 'currency'),
        claim(text, 'немає в наявності', 'AVAILABILITY', 'stockQuantity'),
      ],
    };
    expect(validateReplyDraft(result, source).ok).toBe(true);
  });

  it('blocks unsupported numerical, currency, stock or commercial promises', () => {
    for (const text of ['Знижка 15%', 'Доставка завтра', 'Є 3 шт.', 'Ціна 2000 UAH']) {
      expect(validateReplyDraft({ outcome: 'ANSWER', text, productIds: [], claims: [] }, source).ok).toBe(false);
    }
  });

  it.each(['Відправимо завтра.', 'We will ship tomorrow.', "We'll ship tomorrow.", 'I’ll deliver tomorrow.'])(
    'blocks an unsupported shipping-date promise without catalogue claims: %s', (text) => {
      expect(validateReplyDraft({ outcome: 'CLARIFY', text, productIds: [], claims: [] }, source).ok).toBe(false);
    },
  );

  it('does not treat an ordinary request to the buyer as a shipping promise', () => {
    expect(validateReplyDraft({ outcome: 'CLARIFY', text: 'Надішліть, будь ласка, фото.', productIds: [], claims: [] }, source).ok).toBe(true);
  });

  it('blocks a price claim when the source has no currency', () => {
    const text = 'Ціна 1500.00';
    expect(validateReplyDraft({
      outcome: 'ANSWER', text, productIds: [productId],
      claims: [claim(text, '1500.00', 'PRICE', 'price')],
    }, [{ ...source[0]!, currency: null }]).ok).toBe(false);
  });

  it('blocks unknown products and claims about unknown stock', () => {
    const text = 'Є в наявності';
    const result: GeneratedReply = {
      outcome: 'ANSWER', text, productIds: [productId], claims: [claim(text, text, 'AVAILABILITY', 'stockQuantity')],
    };
    expect(validateReplyDraft(result, [{ ...source[0]!, stockQuantity: null }]).ok).toBe(false);
    expect(validateReplyDraft({ ...result, productIds: ['22222222-2222-4222-8222-222222222222'] }, source).ok).toBe(false);
  });

  it('allows a fact-free clarifying question', () => {
    expect(validateReplyDraft({ outcome: 'CLARIFY', text: 'Яку саме модель ви маєте на увазі?', productIds: [], claims: [] }, []).ok).toBe(true);
  });
});
