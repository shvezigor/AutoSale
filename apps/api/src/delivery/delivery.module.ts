import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient, type PrismaClient } from '@autosale/database';
import { CredentialCipher, NovaPoshtaClient } from '@autosale/integrations';
import { DynamicModule, Module, type OnApplicationShutdown } from '@nestjs/common';

import { DeliveryController, DeliveryLocationController } from './delivery.controller.js';
import { DeliveryService } from './delivery.service.js';
import { DeliveryLocationService } from './delivery-location.service.js';

@Module({})
export class DeliveryModule {
  static register(env: ApiEnv): DynamicModule {
    const prisma = createPrismaClient(env.DATABASE_URL);
    const cipher = new CredentialCipher(Buffer.from(env.INTEGRATION_ENCRYPTION_KEY, 'base64'));
    const service = new DeliveryService(
      prisma,
      cipher,
      (apiKey) => new NovaPoshtaClient({ apiKey }),
      { enabled: env.NOVA_POSHTA_DELIVERY_ENABLED },
    );
    const locationService = new DeliveryLocationService(service);
    return {
      module: DeliveryModule,
      controllers: [DeliveryController, DeliveryLocationController],
      providers: [
        { provide: DeliveryService, useValue: service },
        { provide: DeliveryLocationService, useValue: locationService },
        { provide: DeliveryPrismaLifecycle, useValue: new DeliveryPrismaLifecycle(prisma) },
      ],
      exports: [DeliveryService],
    };
  }
}

class DeliveryPrismaLifecycle implements OnApplicationShutdown {
  constructor(private readonly prisma: PrismaClient) {}
  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
