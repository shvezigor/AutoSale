import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient, type PrismaClient } from '@autosale/database';
import { CredentialCipher, MeestClient, NovaPoshtaClient, UkrposhtaClient } from '@autosale/integrations';
import { DynamicModule, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';

import { DeliveryController, DeliveryLocationController, MeestConnectionController, ShipmentController, ShipmentLifecycleController, UkrposhtaConnectionController } from './delivery.controller.js';
import { DeliveryService } from './delivery.service.js';
import { DeliveryLocationService } from './delivery-location.service.js';
import { MeestConnectionService } from './meest-connection.service.js';
import { UkrposhtaConnectionService } from './ukrposhta-connection.service.js';
import { ConversationsService } from '../conversations/conversations.service.js';

@Module({})
export class DeliveryModule {
  static register(env: ApiEnv): DynamicModule {
    const prisma = createPrismaClient(env.DATABASE_URL);
    const cipher = new CredentialCipher(Buffer.from(env.INTEGRATION_ENCRYPTION_KEY, 'base64'));
    const shipmentQueue = new Queue('delivery', { connection: queueConnection(env.REDIS_URL) });
    const instagramQueue = new Queue('instagram', { connection: queueConnection(env.REDIS_URL) });
    const instagramOutbound = new ConversationsService(prisma, instagramQueue);
    const service = new DeliveryService(
      prisma,
      cipher,
      (apiKey) => new NovaPoshtaClient({ apiKey }),
      { enabled: env.NOVA_POSHTA_DELIVERY_ENABLED },
      shipmentQueue,
      instagramOutbound,
    );
    const meestService = new MeestConnectionService(
      prisma,
      cipher,
      (credentials) => new MeestClient(credentials),
      { enabled: env.NOVA_POSHTA_DELIVERY_ENABLED },
    );
    const ukrposhtaService = new UkrposhtaConnectionService(
      prisma,
      cipher,
      (credentials) => new UkrposhtaClient(credentials),
      { enabled: env.NOVA_POSHTA_DELIVERY_ENABLED },
    );
    const locationService = new DeliveryLocationService(service, meestService);
    return {
      module: DeliveryModule,
      controllers: [DeliveryController, MeestConnectionController, UkrposhtaConnectionController, DeliveryLocationController, ShipmentController, ShipmentLifecycleController],
      providers: [
        { provide: DeliveryService, useValue: service },
        { provide: MeestConnectionService, useValue: meestService },
        { provide: UkrposhtaConnectionService, useValue: ukrposhtaService },
        { provide: DeliveryLocationService, useValue: locationService },
        { provide: DeliveryPrismaLifecycle, useValue: new DeliveryPrismaLifecycle(prisma, [shipmentQueue, instagramQueue]) },
      ],
      exports: [DeliveryService],
    };
  }
}

class DeliveryPrismaLifecycle implements OnApplicationShutdown {
  constructor(private readonly prisma: PrismaClient, private readonly queues: Queue[]) {}
  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.queues.map((queue) => queue.close()));
    await this.prisma.$disconnect();
  }
}

function queueConnection(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
  };
}
