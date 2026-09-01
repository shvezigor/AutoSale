import { readFileSync } from 'node:fs';

import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { createGoogleSheetsAdapter } from '@autosale/integrations';
import { DynamicModule, Module } from '@nestjs/common';
import { Queue } from 'bullmq';

import { CatalogueSourcesController } from './catalogue-sources.controller.js';
import { CatalogueSourcesService } from './catalogue-sources.service.js';

@Module({})
export class CatalogueSourcesModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: CatalogueSourcesModule,
      controllers: [CatalogueSourcesController],
      providers: [{
        provide: CatalogueSourcesService,
        useFactory: () => new CatalogueSourcesService(
          createPrismaClient(env.DATABASE_URL),
          env.GOOGLE_SERVICE_ACCOUNT_FILE ? createGoogleSheetsAdapter(env.GOOGLE_SERVICE_ACCOUNT_FILE) : undefined,
          new Queue('catalogue', { connection: queueConnection(env.REDIS_URL) }),
          serviceAccountConfig(env.GOOGLE_SERVICE_ACCOUNT_FILE),
        ),
      }],
    };
  }
}

function readServiceAccountEmail(path: string | undefined): string | undefined {
  if (!path) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { client_email?: unknown };
    return typeof parsed.client_email === 'string' && /^[^\s@]+@[^\s@]+$/.test(parsed.client_email) ? parsed.client_email : undefined;
  } catch {
    return undefined;
  }
}

function serviceAccountConfig(path: string | undefined): { serviceAccountEmail?: string } {
  const serviceAccountEmail = readServiceAccountEmail(path);
  return serviceAccountEmail ? { serviceAccountEmail } : {};
}

function queueConnection(redisUrl: string) {
  const url = new URL(redisUrl);
  return { host: url.hostname, port: Number(url.port || 6379), username: url.username || undefined, password: url.password || undefined, tls: url.protocol === 'rediss:' ? {} : undefined };
}
