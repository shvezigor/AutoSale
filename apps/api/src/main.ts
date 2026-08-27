import 'reflect-metadata';

import { parseApiEnv } from '@autosale/config/api-env';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createHttpTelemetry, metrics, StructuredLogger } from '@autosale/observability';

import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const env = parseApiEnv(process.env);
  const app = await NestFactory.create(AppModule.register(env), { rawBody: true, logger: false });
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
