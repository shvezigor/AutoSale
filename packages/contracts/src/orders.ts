export type OrderStatus = 'AI_PROCESSING' | 'AI_FAILED' | 'NEEDS_REVIEW' | 'AUTO_APPROVED' | 'APPROVED' | 'CANCELLED';

export interface ManagerOrder {
  id: string;
  status: OrderStatus;
  participantName: string | null;
  channel: 'INSTAGRAM';
  overallConfidence: number | null;
  validationIssues: string[];
  customer: { name: string | null; phone: string | null; instagramUsername: string | null };
  delivery: { city: string | null; address: string | null; novaPoshtaBranch: string | null };
  items: Array<{
    id: string;
    catalogId: string | null;
    productName: string | null;
    originalText: string;
    quantity: number;
    color: string | null;
    size: string | null;
    confidence: number;
  }>;
  catalogueCandidates: Array<{ sku: string; name: string }>;
  createdAt: string;
  sheetsExport: {
    status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
    attempts: number;
    rowNumber: number | null;
    lastAttemptAt: string | null;
    lastSyncedAt: string | null;
    errorSummary: string | null;
    retryAllowed: boolean;
  } | null;
}

export interface ManagerOrderUpdate {
  customer?: Partial<ManagerOrder['customer']>;
  delivery?: Partial<ManagerOrder['delivery']>;
  items?: Array<{ id: string; catalogId: string | null; quantity: number; color: string | null; size: string | null }>;
}

export interface OrderListResponse { items: ManagerOrder[] }
