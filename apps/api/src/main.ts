import 'reflect-metadata';

import { parseApiEnv } from '@autosale/config/api-env';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createHttpTelemetry, metrics, StructuredLogger } from '@autosale/observability';

import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const env = parseApiEnv(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(env), { rawBody: true, logger: false });
  // Only Caddy can reach the API in the deployed internal network; it sends one sanitized client IP.
  app.set('trust proxy', 1);
  const logger = new StructuredLogger('api');
  app.use(createHttpTelemetry(logger, metrics));
  const openApiConfig = new DocumentBuilder()
    .setTitle('AutoSale API')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, openApiConfig));

  await app.listen(env.PORT, '0.0.0.0');
  logger.info('service_started', { correlationId: 'system:startup', port: env.PORT });
}

void bootstrap();
