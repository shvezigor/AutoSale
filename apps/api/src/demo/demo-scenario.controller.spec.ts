import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DemoScenarioController } from './demo-scenario.controller.js';
import { DemoScenarioService } from './demo-scenario.service.js';

describe('DemoScenarioController', () => {
  let app: INestApplication | undefined;
  const start = vi.fn().mockResolvedValue({ eventId: 'event-1', duplicate: false });

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DemoScenarioController],
      providers: [{ provide: DemoScenarioService, useValue: { start } }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((req: { principal?: unknown }, _res: unknown, next: () => void) => {
      req.principal = { tenantId: 'tenant-1', membershipRole: 'OWNER' };
      next();
    });
    await app.init();
  });

  afterEach(async () => app?.close());

  it('starts the scenario for the current tenant', async () => {
    const response = await request(app!.getHttpServer()).post('/api/demo/order-scenario').expect(201);
    expect(response.body).toEqual({ eventId: 'event-1', duplicate: false });
    expect(start).toHaveBeenCalledWith('tenant-1');
  });
});
