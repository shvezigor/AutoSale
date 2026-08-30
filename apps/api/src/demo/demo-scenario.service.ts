import { Prisma, type PrismaClient } from '@autosale/database';

interface NormalizeQueue {
  add(name: 'instagram.normalize', data: { eventId: string; correlationId: string }): Promise<unknown>;
}

export class DemoScenarioService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: NormalizeQueue,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async start(tenantId: string): Promise<{ eventId: string; duplicate: boolean }> {
    await this.prisma.product.upsert({
      where: { tenantId_sku: { tenantId, sku: 'DEMO-BAG-001' } },
      update: { name: 'Сумка Luna чорна', aliases: ['чорна сумка Luna', 'Luna black'], active: true },
      create: { tenantId, sku: 'DEMO-BAG-001', name: 'Сумка Luna чорна', aliases: ['чорна сумка Luna', 'Luna black'] },
    });

    const externalEventId = 'demo:instagram-order:v1';
    let event: { id: string };
    try {
      event = await this.prisma.webhookEvent.create({
        data: {
          tenantId,
          provider: 'META',
          externalEventId,
          payload: this.payload(tenantId) as Prisma.InputJsonObject,
        },
        select: { id: true },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      event = await this.prisma.webhookEvent.findUniqueOrThrow({
        where: { tenantId_provider_externalEventId: { tenantId, provider: 'META', externalEventId } },
        select: { id: true },
      });
      return { eventId: event.id, duplicate: true };
    }

    await this.queue.add('instagram.normalize', { eventId: event.id, correlationId: event.id });
    return { eventId: event.id, duplicate: false };
  }

  private payload(tenantId: string): Record<string, unknown> {
    const base = this.now().getTime();
    const customerId = `demo-client-${tenantId}`;
    const businessId = `demo-business-${tenantId}`;
    return {
      object: 'instagram',
      entry: [{
        id: businessId,
        time: base,
        messaging: [
          { sender: { id: customerId }, recipient: { id: businessId }, timestamp: base - 120_000, message: { mid: `demo-in-1-${tenantId}`, text: 'Добрий день! Хочу чорну сумку Luna, 2 штуки.' } },
          { sender: { id: customerId }, recipient: { id: businessId }, timestamp: base - 60_000, message: { mid: `demo-in-2-${tenantId}`, text: 'Олена Коваль, телефон +380 67 123 45 67. Доставка: Луцьк, відділення Нової пошти №3.' } },
          { sender: { id: businessId }, recipient: { id: customerId }, timestamp: base, message: { mid: `demo-out-1-${tenantId}`, is_echo: true, text: 'Дякуємо, беремо замовлення в роботу' } },
        ],
      }],
    };
  }
}
