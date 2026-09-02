import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';

const attachmentId = '11111111-1111-4111-8111-111111111111';
const tenantId = '22222222-2222-4222-8222-222222222222';

describe('MediaController', () => {
  let app: INestApplication | undefined;
  const load = vi.fn();
  const loadProfileAvatar = vi.fn();

  beforeEach(async () => {
    load.mockReset().mockResolvedValue({
      body: Uint8Array.from([137, 80, 78, 71]),
      contentType: 'image/png',
    });
    loadProfileAvatar.mockReset().mockResolvedValue({
      body: Uint8Array.from([255, 216, 255]),
      contentType: 'image/jpeg',
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [{ provide: MediaService, useValue: { load, loadProfileAvatar } }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((request: { principal?: unknown }, _response: unknown, next: () => void) => {
      request.principal = { userId: 'user', email: 'manager@example.com', platformRole: 'USER', tenantId, membershipRole: 'MANAGER', sessionId: 'session' };
      next();
    });
    await app.init();
  });

  afterEach(async () => app?.close());

  it('serves controlled media inline without exposing a storage URL', async () => {
    const response = await request(app!.getHttpServer())
      .get(`/api/media/${attachmentId}`)
      .expect(200)
      .expect('Content-Type', /image\/png/);

    expect(Buffer.from(response.body as Uint8Array)).toEqual(Buffer.from([137, 80, 78, 71]));
    expect(load).toHaveBeenCalledWith(tenantId, attachmentId);
  });

  it('serves a tenant-scoped cached profile avatar from an authenticated route', async () => {
    await request(app!.getHttpServer())
      .get(`/api/media/instagram-profiles/${attachmentId}/avatar?v=checksum`)
      .expect(200)
      .expect('Content-Type', /image\/jpeg/)
      .expect('Cache-Control', /private/);

    expect(loadProfileAvatar).toHaveBeenCalledWith(tenantId, attachmentId);
  });
});
