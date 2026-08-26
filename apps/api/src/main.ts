import 'reflect-metadata';

import { parseApiEnv } from '@autosale/config/api-env';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const env = parseApiEnv(process.env);
  const app = await NestFactory.create(AppModule.register(env), { rawBody: true });

  await app.listen(env.PORT, '0.0.0.0');
}

void bootstrap();
