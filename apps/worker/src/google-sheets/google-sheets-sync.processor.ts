import type { PrismaClient } from '@autosale/database';
import type { GoogleSheetsAdapter } from '@autosale/integrations';

type Extraction = { customer?: { name?: string | null; phone?: string | null; instagramUsername?: string | null }; delivery?: { city?: string | null; address?: string | null; novaPoshtaBranch?: string | null } };

export class GoogleSheetsSyncProcessor {
  constructor(private readonly prisma: PrismaClient, private readonly sheets: Pick<GoogleSheetsAdapter, 'upsertRow'>) {}

  async process(exportId: string): Promise<void> {
    const record = await this.prisma.orderExport.findUniqueOrThrow({ where: { id: exportId } });
    await this.prisma.orderExport.update({ where: { id: exportId }, data: { status: 'PROCESSING', attempts: { increment: 1 }, lastAttemptAt: new Date() } });
    try {
      const order = await this.prisma.order.findUniqueOrThrow({ where: { id: record.orderId }, include: { items: { orderBy: { createdAt: 'asc' } } } });
      if (order.status !== 'APPROVED' && order.status !== 'AUTO_APPROVED') throw new Error('Only approved orders can be exported');
      const destination = await this.prisma.googleSheetsDestination.findUniqueOrThrow({ where: { tenantId: record.tenantId } });
      const headers = stringArray(destination.requiredHeaders);
      const products = headers.includes('product_name') ? await this.prisma.product.findMany({ where: { tenantId: order.tenantId, sku: { in: order.items.flatMap((item) => item.catalogId ? [item.catalogId] : []) } }, select: { sku: true, name: true } }) : [];
      const values = mapRow(headers, order, new Map(products.map((product) => [product.sku, product.name])));
      const result = await this.sheets.upsertRow({ spreadsheetId: destination.spreadsheetId, sheetName: destination.sheetName, orderId: order.id, values });
      await this.prisma.orderExport.update({ where: { id: exportId }, data: { status: 'SUCCEEDED', rowNumber: result.rowNumber, lastSyncedAt: new Date(), errorSummary: null } });
    } catch (error) {
      const summary = error instanceof Error ? error.message.slice(0, 500) : 'Unknown Google Sheets synchronization error';
      await this.prisma.orderExport.update({ where: { id: exportId }, data: { status: 'FAILED', errorSummary: summary } });
      throw error;
    }
  }
}

function mapRow(headers: string[], order: { id: string; status: string; conversationId?: string; createdAt?: Date; updatedAt?: Date; approvedAt?: Date | null; overallConfidence?: number | null; extraction: unknown; items: Array<{ catalogId: string | null; quantity: number; color: string | null; size: string | null }> }, productNames: Map<string, string>): Array<string | number | null> {
  const extraction = (order.extraction ?? {}) as Extraction;
  const items = order.items.map((item) => `${item.catalogId ?? ''} × ${item.quantity}${[item.color, item.size].filter(Boolean).map((value) => `, ${value}`).join('')}`).join('; ');
  const fields: Record<string, string | number | null> = {
    order_id: order.id, status: order.status, customer_name: extraction.customer?.name ?? null,
    created_at: order.createdAt?.toISOString() ?? null, updated_at: order.updatedAt?.toISOString() ?? null,
    channel: 'INSTAGRAM', conversation_id: order.conversationId ?? null,
    phone: extraction.customer?.phone ?? null, customer_phone: extraction.customer?.phone ?? null, instagram_username: extraction.customer?.instagramUsername ?? null,
    city: extraction.delivery?.city ?? null, delivery_city: extraction.delivery?.city ?? null, address: extraction.delivery?.address ?? null,
    nova_poshta_branch: extraction.delivery?.novaPoshtaBranch ?? null, delivery_branch: extraction.delivery?.novaPoshtaBranch ?? null,
    sku: order.items.map((item) => item.catalogId).filter(Boolean).join('; '),
    product_name: order.items.map((item) => item.catalogId ? productNames.get(item.catalogId) ?? '' : '').filter(Boolean).join('; '),
    quantity: order.items.map((item) => item.quantity).join('; '), items, manager_note: null,
    confidence: order.overallConfidence ?? null,
    approved_at: order.approvedAt?.toISOString() ?? null,
  };
  return headers.map((header) => fields[header] ?? null);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
