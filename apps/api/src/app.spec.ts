import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { AppModule } from './app.module.js';

describe('application health over HTTP', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it('serves the liveness contract over HTTP', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
      .get('/health/live')
      .expect(200);

    expect(response.body).toEqual({ status: 'ok' });
  });

  it('exposes Prometheus-compatible API metrics', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const response = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain('autosale_api_info');
  });
});
