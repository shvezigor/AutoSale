import { Prisma } from '@autosale/database';
import { describe, expect, it, vi } from 'vitest';

import { DemoScenarioService } from './demo-scenario.service.js';

describe('DemoScenarioService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';

  it('creates a catalogue product and queues one Meta-compatible demo event', async () => {
    const productUpsert = vi.fn().mockResolvedValue({ id: 'product-1' });
    const eventCreate = vi.fn().mockResolvedValue({ id: 'event-1' });
    const queueAdd = vi.fn().mockResolvedValue(undefined);
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ set_config: tenantId }]),
      product: { upsert: productUpsert },
      webhookEvent: { create: eventCreate },
    };
    const service = new DemoScenarioService(
      { $transaction: async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction) } as never,
      { add: queueAdd },
      () => new Date('2026-08-30T12:00:00.000Z'),
    );

    await expect(service.start(tenantId)).resolves.toEqual({ eventId: 'event-1', duplicate: false });
    expect(productUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_sku: { tenantId, sku: 'DEMO-BAG-001' } },
    }));
    const payload = eventCreate.mock.calls[0]![0].data.payload;
    expect(payload.entry[0].messaging).toHaveLength(3);
    expect(payload.entry[0].messaging[2].message).toMatchObject({ is_echo: true, text: 'Дякуємо, беремо замовлення в роботу' });
    expect(queueAdd).toHaveBeenCalledWith('instagram.normalize', { tenantId, eventId: 'event-1', correlationId: 'event-1' });
  });

  it('returns the existing event and does not queue a duplicate run', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test' });
    const queueAdd = vi.fn();
    const transaction = {
        $queryRaw: vi.fn().mockResolvedValue([{ set_config: tenantId }]),
        product: { upsert: vi.fn() },
        webhookEvent: {
          create: vi.fn().mockRejectedValue(duplicate),
          findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'event-existing' }),
        },
      };
    const service = new DemoScenarioService(
      { $transaction: async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction) } as never,
      { add: queueAdd },
    );

    await expect(service.start(tenantId)).resolves.toEqual({ eventId: 'event-existing', duplicate: true });
    expect(queueAdd).not.toHaveBeenCalled();
  });
});
