import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';

const attachmentId = '11111111-1111-4111-8111-111111111111';

describe('MediaController', () => {
  let app: INestApplication | undefined;
  const load = vi.fn();

  beforeEach(async () => {
    load.mockReset().mockResolvedValue({
      body: Uint8Array.from([137, 80, 78, 71]),
      contentType: 'image/png',
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [{ provide: MediaService, useValue: { load } }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => app?.close());

  it('serves controlled media inline without exposing a storage URL', async () => {
    const response = await request(app!.getHttpServer())
      .get(`/api/media/${attachmentId}`)
      .expect(200)
      .expect('Content-Type', /image\/png/);

    expect(Buffer.from(response.body as Uint8Array)).toEqual(Buffer.from([137, 80, 78, 71]));
    expect(load).toHaveBeenCalledWith(attachmentId);
  });
});
