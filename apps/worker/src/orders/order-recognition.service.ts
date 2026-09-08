import { decideOrderStatus, type ApprovalMode } from './approval-policy.js';
import type {
  OpenAiOrderRecognizer,
  OrderRecognitionInput,
  RecognizedOrder,
} from './openai-order-recognizer.js';

type Recognizer = Pick<OpenAiOrderRecognizer, 'recognize'>;

export class OrderRecognitionService {
  constructor(private readonly recognizer: Recognizer) {}

  async recognize(
    input: OrderRecognitionInput,
    settings: { approvalMode: ApprovalMode; autoApprovalThreshold: number },
  ): Promise<{
    order: RecognizedOrder;
    metadata: Awaited<ReturnType<Recognizer['recognize']>>['metadata'];
    status: 'NEEDS_REVIEW' | 'AUTO_APPROVED';
    validationIssues: string[];
  }> {
    const result = await this.recognizer.recognize(input);
    const productIds = new Set(input.products.map((product) => product.id));
    const order = {
      ...result.order,
      items: result.order.items.map((item) => ({
        ...item,
        catalogId: item.catalogId === null
          ? findUnambiguousCatalogueId(item.originalText, input.products)
          : item.catalogId,
      })),
    };
    const validationIssues: string[] = [];

    if (!order.customer.name) validationIssues.push('customer.name');
    if (!order.customer.phone) validationIssues.push('customer.phone');
    if (!order.delivery.city) validationIssues.push('delivery.city');
    if (!order.delivery.address && !order.delivery.novaPoshtaBranch) {
      validationIssues.push('delivery.address');
    }

    order.items.forEach((item, index) => {
      if (item.catalogId === null || !productIds.has(item.catalogId)) {
        validationIssues.push(`items.${index}.catalogId`);
      }
      if (item.quantity < 1) validationIssues.push(`items.${index}.quantity`);
    });
    if (!order.isOrder) validationIssues.push('isOrder');
    if (order.items.length === 0) validationIssues.push('items');

    return {
      ...result,
      order,
      validationIssues,
      status: decideOrderStatus({
        mode: settings.approvalMode,
        confidence: order.overallConfidence,
        threshold: settings.autoApprovalThreshold,
        isComplete: validationIssues.length === 0,
      }),
    };
  }
}

function findUnambiguousCatalogueId(
  originalText: string,
  products: OrderRecognitionInput['products'],
): string | null {
  const normalizedItem = normalizeProductText(originalText);
  if (!normalizedItem) return null;

  const matches = new Set<string>();
  for (const product of products) {
    for (const candidate of [product.name, ...product.aliases]) {
      const normalizedCandidate = normalizeProductText(candidate);
      if (
        normalizedCandidate.length >= 3 &&
        (` ${normalizedItem} `.includes(` ${normalizedCandidate} `) ||
          ` ${normalizedCandidate} `.includes(` ${normalizedItem} `))
      ) {
        matches.add(product.id);
      }
    }
  }
  return matches.size === 1 ? [...matches][0]! : null;
}

function normalizeProductText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('uk-UA')
    .replace(/[xх×]/gu, 'x')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}
