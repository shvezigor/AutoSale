import {
  conversationDetailResponseSchema,
  conversationListResponseSchema,
} from '@autosale/contracts/conversations';
import { BadRequestException, type INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationsController } from './conversations.controller.js';
import { ConversationsService } from './conversations.service.js';

const conversationId = '11111111-1111-4111-8111-111111111111';
const tenantId = '22222222-2222-4222-8222-222222222222';

describe('ConversationsController', () => {
  let app: INestApplication | undefined;
  const list = vi.fn();
  const detail = vi.fn();

  beforeEach(async () => {
    list.mockReset().mockResolvedValue({
      items: [
        {
          id: conversationId,
          channel: 'INSTAGRAM',
          participantName: 'Олена',
          lastMessagePreview: 'Вітаю',
          lastMessageAt: '2026-08-26T12:00:00.000Z',
        },
      ],
      nextCursor: null,
    });
    detail.mockReset().mockResolvedValue({
      id: conversationId,
      channel: 'INSTAGRAM',
      participantName: 'Олена',
      messages: [],
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [ConversationsController],
      providers: [{ provide: ConversationsService, useValue: { list, detail } }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((request: { principal?: unknown }, _response: unknown, next: () => void) => {
      request.principal = { userId: 'user', email: 'manager@example.com', platformRole: 'USER', tenantId, membershipRole: 'MANAGER', sessionId: 'session' };
      next();
    });
    await app.init();
  });

  afterEach(async () => app?.close());

  it('returns a list conforming to the shared response contract', async () => {
    const response = await request(app!.getHttpServer()).get('/api/conversations?limit=20').expect(200);

    expect(() => conversationListResponseSchema.parse(response.body)).not.toThrow();
    expect(list).toHaveBeenCalledWith(tenantId, { limit: 20 });
  });

  it('returns detail conforming to the shared response contract', async () => {
    const response = await request(app!.getHttpServer())
      .get(`/api/conversations/${conversationId}`)
      .expect(200);

    expect(() => conversationDetailResponseSchema.parse(response.body)).not.toThrow();
    expect(detail).toHaveBeenCalledWith(tenantId, conversationId);
  });

  it('rejects an excessive page limit', async () => {
    await request(app!.getHttpServer()).get('/api/conversations?limit=51').expect(400);
    expect(list).not.toHaveBeenCalled();
  });

  it('rejects a malformed cursor and returns 404 for an unknown id', async () => {
    list.mockRejectedValueOnce(new BadRequestException('Malformed conversation cursor'));
    detail.mockRejectedValueOnce(new NotFoundException('Conversation not found'));

    await request(app!.getHttpServer()).get('/api/conversations?cursor=broken').expect(400);
    await request(app!.getHttpServer()).get(`/api/conversations/${conversationId}`).expect(404);
  });

  it('publishes both endpoints with response schemas in OpenAPI', () => {
    const document = SwaggerModule.createDocument(app!, new DocumentBuilder().build());

    expect(document.paths['/api/conversations']?.get?.responses?.['200']).toBeDefined();
    expect(document.paths['/api/conversations/{id}']?.get?.responses?.['200']).toBeDefined();
  });
});
