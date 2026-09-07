import {
  conversationDetailResponseSchema,
  conversationListResponseSchema,
  conversationMessageSchema,
} from '@autosale/contracts/conversations';
import type { AuthPrincipal } from '@autosale/contracts/auth';
import { BadRequestException, type INestApplication, NotFoundException } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationsController } from './conversations.controller.js';
import { ConversationsService } from './conversations.service.js';
import { AUTH_HTTP_CONFIG } from '../auth/auth.controller.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CsrfService } from '../auth/csrf.service.js';
import { SessionService } from '../auth/session.service.js';

const conversationId = '11111111-1111-4111-8111-111111111111';
const messageId = '33333333-3333-4333-8333-333333333333';
const tenantId = '22222222-2222-4222-8222-222222222222';
const owner: AuthPrincipal = {
  userId: 'owner-user', email: 'owner@example.com', name: 'Owner', platformRole: 'USER',
  tenantId, membershipRole: 'OWNER', sessionId: 'owner-session',
};
const manager: AuthPrincipal = {
  ...owner, userId: 'manager-user', email: 'manager@example.com', name: 'Manager',
  membershipRole: 'MANAGER', sessionId: 'manager-session',
};

describe('ConversationsController', () => {
  let app: INestApplication | undefined;
  const list = vi.fn();
  const detail = vi.fn();
  const send = vi.fn();
  const retry = vi.fn();
  const resolveSession = vi.fn();
  const csrf = new CsrfService('c'.repeat(32));
  const outboundMessage = {
    id: messageId,
    direction: 'OUTBOUND',
    senderId: 'instagram-shop',
    text: 'Вітаю',
    sourceTimestamp: '2026-09-07T12:00:00.000Z',
    attachments: [],
    delivery: { status: 'PENDING', attempts: 0, errorCode: null, retryAllowed: false },
  };

  beforeEach(async () => {
    list.mockReset().mockResolvedValue({
      items: [
        {
          id: conversationId,
          channel: 'INSTAGRAM',
          participantName: 'Олена',
          participantUsername: 'olena',
          participantAvatarUrl: '/api/media/instagram-profiles/profile/avatar?v=v1',
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
      participantUsername: 'olena',
      participantAvatarUrl: '/api/media/instagram-profiles/profile/avatar?v=v1',
      replyCapability: { enabled: true, reason: null },
      messages: [],
    });
    send.mockReset().mockResolvedValue(outboundMessage);
    retry.mockReset().mockResolvedValue(outboundMessage);
    resolveSession.mockReset().mockImplementation(async (token: string) => {
      if (token === 'owner-token') return owner;
      if (token === 'manager-token') return manager;
      return null;
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [ConversationsController],
      providers: [
        { provide: ConversationsService, useValue: { list, detail, send, retry } },
        { provide: SessionService, useValue: { resolve: resolveSession } },
        { provide: CsrfService, useValue: csrf },
        { provide: AUTH_HTTP_CONFIG, useValue: { cookieName: 'autosale_session', production: false } },
        {
          provide: AuthGuard,
          useFactory: () => new AuthGuard(
            new Reflector(),
            { resolve: resolveSession } as never,
            { cookieName: 'autosale_session', production: false },
            csrf,
          ),
        },
        { provide: APP_GUARD, useExisting: AuthGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => app?.close());

  it('returns a list conforming to the shared response contract', async () => {
    const response = await request(app!.getHttpServer()).get('/api/conversations?limit=20')
      .set('Cookie', 'autosale_session=manager-token').expect(200);

    expect(() => conversationListResponseSchema.parse(response.body)).not.toThrow();
    expect(list).toHaveBeenCalledWith(tenantId, { limit: 20 });
  });

  it('returns detail conforming to the shared response contract', async () => {
    const response = await request(app!.getHttpServer())
      .get(`/api/conversations/${conversationId}`)
      .set('Cookie', 'autosale_session=manager-token')
      .expect(200);

    expect(() => conversationDetailResponseSchema.parse(response.body)).not.toThrow();
    expect(detail).toHaveBeenCalledWith(tenantId, conversationId);
  });

  it('rejects an excessive page limit', async () => {
    await request(app!.getHttpServer()).get('/api/conversations?limit=51')
      .set('Cookie', 'autosale_session=manager-token').expect(400);
    expect(list).not.toHaveBeenCalled();
  });

  it('rejects a malformed cursor and returns 404 for an unknown id', async () => {
    list.mockRejectedValueOnce(new BadRequestException('Malformed conversation cursor'));
    detail.mockRejectedValueOnce(new NotFoundException('Conversation not found'));

    await request(app!.getHttpServer()).get('/api/conversations?cursor=broken')
      .set('Cookie', 'autosale_session=manager-token').expect(400);
    await request(app!.getHttpServer()).get(`/api/conversations/${conversationId}`)
      .set('Cookie', 'autosale_session=manager-token').expect(404);
  });

  it.each([
    ['manager-token', manager],
    ['owner-token', owner],
  ])('accepts an idempotent reply from %s with valid CSRF', async (token, principal) => {
    const response = await request(app!.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .set('Cookie', `autosale_session=${token}`)
      .set('x-csrf-token', csrf.issue(principal.sessionId))
      .send({ text: '  Вітаю  ', idempotencyKey: '44444444-4444-4444-8444-444444444444' })
      .expect(201);

    expect(() => conversationMessageSchema.parse(response.body)).not.toThrow();
    expect(send).toHaveBeenCalledWith(tenantId, principal.userId, conversationId, {
      text: 'Вітаю', idempotencyKey: '44444444-4444-4444-8444-444444444444',
    });
  });

  it('rejects missing or invalid CSRF and invalid reply bodies before service execution', async () => {
    const url = `/api/conversations/${conversationId}/messages`;
    const body = { text: 'Вітаю', idempotencyKey: '44444444-4444-4444-8444-444444444444' };

    await request(app!.getHttpServer()).post(url)
      .set('Cookie', 'autosale_session=manager-token').send(body).expect(403);
    await request(app!.getHttpServer()).post(url)
      .set('Cookie', 'autosale_session=manager-token').set('x-csrf-token', 'invalid').send(body).expect(403);
    await request(app!.getHttpServer()).post(url)
      .set('Cookie', 'autosale_session=manager-token')
      .set('x-csrf-token', csrf.issue(manager.sessionId))
      .send({ text: ' ', idempotencyKey: 'not-a-uuid' }).expect(400);

    expect(send).not.toHaveBeenCalled();
  });

  it('does not expose a foreign conversation and supports a safe retry', async () => {
    send.mockRejectedValueOnce(new NotFoundException('Conversation not found'));
    const headers = {
      Cookie: 'autosale_session=manager-token',
      'x-csrf-token': csrf.issue(manager.sessionId),
    };
    await request(app!.getHttpServer()).post(`/api/conversations/${conversationId}/messages`)
      .set(headers).send({
        text: 'Вітаю', idempotencyKey: '44444444-4444-4444-8444-444444444444',
      }).expect(404);

    const response = await request(app!.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages/${messageId}/retry`)
      .set(headers)
      .expect(201);
    expect(() => conversationMessageSchema.parse(response.body)).not.toThrow();
    expect(retry).toHaveBeenCalledWith(tenantId, manager.userId, conversationId, messageId);
  });

  it('publishes all endpoints with response schemas in OpenAPI', () => {
    const document = SwaggerModule.createDocument(app!, new DocumentBuilder().build());

    expect(document.paths['/api/conversations']?.get?.responses?.['200']).toBeDefined();
    expect(document.paths['/api/conversations/{id}']?.get?.responses?.['200']).toBeDefined();
    expect(document.paths['/api/conversations/{id}/messages']?.post?.responses?.['201']).toBeDefined();
    expect(document.paths['/api/conversations/{id}/messages/{messageId}/retry']?.post?.responses?.['201']).toBeDefined();
    const response = document.paths['/api/conversations']?.get?.responses?.['200'];
    expect(JSON.stringify(response)).toContain('participantAvatarUrl');
    expect(JSON.stringify(response)).toContain('participantUsername');
  });
});
