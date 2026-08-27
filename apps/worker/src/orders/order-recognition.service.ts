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
    const validationIssues = [...result.order.missingFields];

    result.order.items.forEach((item, index) => {
      if (item.catalogId === null || !productIds.has(item.catalogId)) {
        validationIssues.push(`items.${index}.catalogId`);
      }
    });
    if (!result.order.isOrder) validationIssues.push('isOrder');
    if (result.order.items.length === 0) validationIssues.push('items');

    return {
      ...result,
      validationIssues,
      status: decideOrderStatus({
        mode: settings.approvalMode,
        confidence: result.order.overallConfidence,
        threshold: settings.autoApprovalThreshold,
        isComplete: validationIssues.length === 0,
      }),
    };
  }
}
