import type { ReplyDraftSource } from '@autosale/contracts/reply-drafts';
import { z } from 'zod';

const claimSchema = z.strictObject({
  start: z.number().int().min(0),
  end: z.number().int().min(1),
  text: z.string().min(1).max(300),
  type: z.enum(['NAME', 'SKU', 'VARIANT', 'PRICE', 'CURRENCY', 'STOCK', 'AVAILABILITY']),
  field: z.string().min(1).max(80),
  productId: z.uuid(),
});

export const generatedReplySchema = z.strictObject({
  outcome: z.enum(['ANSWER', 'CLARIFY', 'HANDOFF']),
  text: z.string().trim().min(1).max(1000),
  productIds: z.array(z.uuid()).max(8),
  claims: z.array(claimSchema).max(32),
});

export type GeneratedReply = z.infer<typeof generatedReplySchema>;
export type ClaimValidation = { ok: true; reply: GeneratedReply } | { ok: false; code: 'UNGROUNDED_CLAIM' };

export function validateReplyDraft(value: unknown, sources: readonly ReplyDraftSource[]): ClaimValidation {
  const parsed = generatedReplySchema.safeParse(value);
  if (!parsed.success) return blocked();
  const reply = parsed.data;
  const byId = new Map(sources.map((source) => [source.productId, source]));
  if (reply.productIds.some((id) => !byId.has(id))) return blocked();
  if (/\b(discount|delivery|payment|shipping|refund|guaranteed)\b|знижк|доставк|оплат|повернен|гарант/iu.test(reply.text)) return blocked();

  const spans: Array<[number, number]> = [];
  for (const claim of reply.claims) {
    const source = byId.get(claim.productId);
    if (!source || !reply.productIds.includes(claim.productId)) return blocked();
    if (claim.end <= claim.start || reply.text.slice(claim.start, claim.end) !== claim.text) return blocked();
    if (spans.some(([start, end]) => claim.start < end && claim.end > start)) return blocked();
    if (!matchesSource(claim, source)) return blocked();
    spans.push([claim.start, claim.end]);
  }

  const covered = (start: number, end: number) => spans.some(([from, to]) => start >= from && end <= to);
  const patterns = [
    /\d+(?:[.,]\d+)?/gu,
    /\b(?:UAH|USD|EUR|грн|євро|долар(?:ів|и)?)\b|[$€₴]/giu,
    /(?:немає|не має|(?<!\p{L})є(?!\p{L})|наявн\p{L}*|відсутн\p{L}*|in stock|out of stock|available|unavailable)/giu,
  ];
  for (const pattern of patterns) {
    for (const match of reply.text.matchAll(pattern)) {
      if (!covered(match.index, match.index + match[0].length)) return blocked();
    }
  }
  for (const source of sources) {
    for (const fact of [source.sku, source.name, ...Object.values(source.variants)]) {
      if (!fact || fact.length < 3) continue;
      let start = 0;
      while ((start = reply.text.toLocaleLowerCase('uk').indexOf(fact.toLocaleLowerCase('uk'), start)) >= 0) {
        if (!covered(start, start + fact.length)) return blocked();
        start += fact.length;
      }
    }
  }
  return { ok: true, reply };
}

function matchesSource(claim: GeneratedReply['claims'][number], source: ReplyDraftSource): boolean {
  const text = claim.text.trim().toLocaleLowerCase('uk');
  switch (claim.type) {
    case 'NAME': return claim.field === 'name' && text === source.name.toLocaleLowerCase('uk');
    case 'SKU': return claim.field === 'sku' && text === source.sku.toLocaleLowerCase('uk');
    case 'VARIANT': return text === source.variants[claim.field]?.toLocaleLowerCase('uk');
    case 'PRICE': return claim.field === 'price' && source.price !== null
      && source.currency !== null && numberValue(text) === numberValue(source.price);
    case 'CURRENCY': return claim.field === 'currency' && source.currency !== null
      && currencyMatches(text, source.currency);
    case 'STOCK': return claim.field === 'stockQuantity' && source.stockQuantity !== null
      && numberValue(text) === source.stockQuantity;
    case 'AVAILABILITY': {
      if (claim.field !== 'stockQuantity' || source.stockQuantity === null) return false;
      const negative = /немає|не має|відсутн|out of stock|unavailable/iu.test(text);
      const positive = /\bє\b|наявн|in stock|available/iu.test(text);
      return source.stockQuantity === 0 ? negative : positive && !negative;
    }
  }
}

function numberValue(value: string): number {
  return Number(value.replace(/\s/g, '').replace(',', '.'));
}

function currencyMatches(text: string, currency: string): boolean {
  const accepted: Record<string, string[]> = {
    UAH: ['uah', 'грн', '₴'], USD: ['usd', '$', 'долар', 'долари', 'доларів'],
    EUR: ['eur', '€', 'євро'],
  };
  return (accepted[currency.toUpperCase()] ?? [currency.toLowerCase()]).includes(text);
}

function blocked(): ClaimValidation {
  return { ok: false, code: 'UNGROUNDED_CLAIM' };
}
