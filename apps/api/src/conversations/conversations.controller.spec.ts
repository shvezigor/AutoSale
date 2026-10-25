import {
  conversationStatusChangeResponseSchema,
  conversationDetailResponseSchema,
  conversationListResponseSchema,
  conversationMessageSchema,
  conversationOrderStartResponseSchema,
  conversationOrderStateSchema,
} from '@autosale/contracts/conversations';
import { TenantLifecycleFrozenError } from '@autosale/database';
import { TenantLifecycleExceptionFilter } from '../common/tenant-lifecycle-exception.filter.js';
import type { AuthPrincipal } from '@autosale/contracts/auth';
import { BadRequestException, ConflictException, type INestApplication, NotFoundException } from '@nestjs/common';
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
  tenantId, membershipRole: 'OWNER', locale: 'uk', avatarUrl: null, sessionId: 'owner-session',
};
const manager: AuthPrincipal = {
  ...owner, userId: 'manager-user', email: 'manager@example.com', name: 'Manager',
  membershipRole: 'MANAGER', sessionId: 'manager-session',
};

describe('ConversationsController', () => {
  let app: INestApplication | undefined;
  const list = vi.fn();
  const detail = vi.fn();
  const statusCounts = vi.fn();
  const changeStatus = vi.fn();
  const send = vi.fn();
  const retry = vi.fn();
  const createOrder = vi.fn();
  const orderState = vi.fn();
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
          workflowStatus: 'ACTIVE', statusVersion: 0,
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
      workflowStatus: 'INACTIVE', statusVersion: 3,
      channel: 'INSTAGRAM',
      participantName: 'Олена',
      participantUsername: 'olena',
      participantAvatarUrl: '/api/media/instagram-profiles/profile/avatar?v=v1',
      replyCapability: { enabled: true, aiDraftSendAllowed: true, reason: null },
      messages: [],
    });
    changeStatus.mockReset().mockResolvedValue({ status: 'INACTIVE', statusVersion: 1, statusChangedAt: '2026-10-25T12:00:00.000Z' });
    statusCounts.mockReset().mockResolvedValue({ ACTIVE: 2, INACTIVE: 1, CLOSED: 1 });
    send.mockReset().mockResolvedValue(outboundMessage);
    retry.mockReset().mockResolvedValue(outboundMessage);
    createOrder.mockReset().mockResolvedValue({ orderId: null, queued: true });
    orderState.mockReset().mockResolvedValue({ order: null });
    resolveSession.mockReset().mockImplementation(async (token: string) => {
      if (token === 'owner-token') return owner;
      if (token === 'manager-token') return manager;
      return null;
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [ConversationsController],
      providers: [
        { provide: ConversationsService, useValue: { list, detail, statusCounts, changeStatus, send, retry, createOrder, orderState } },
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
    app.useGlobalFilters(new TenantLifecycleExceptionFilter());
    await app.init();
  });

  afterEach(async () => app?.close());

  it.each([['manager-token', manager], ['owner-token', owner]])('moves status for %s with CSRF', async (token, principal) => {
    const body = { status: 'INACTIVE', expectedVersion: 0 };
    const response = await request(app!.getHttpServer()).patch(`/api/conversations/${conversationId}/status`)
      .set('Cookie', `autosale_session=${token}`).set('x-csrf-token', csrf.issue(principal.sessionId)).send(body).expect(200);
    expect(() => conversationStatusChangeResponseSchema.parse(response.body)).not.toThrow();
    expect(changeStatus).toHaveBeenCalledWith(tenantId, principal.userId, conversationId, body);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated, non-member and missing CSRF status mutations', async () => {
    const url = `/api/conversations/${conversationId}/status`;
    await request(app!.getHttpServer()).patch(url).send({}).expect(401);
    await request(app!.getHttpServer()).patch(url).set('Cookie', 'autosale_session=manager-token').send({}).expect(403);
    resolveSession.mockResolvedValueOnce({ ...manager, membershipRole: null, tenantId: null });
    await request(app!.getHttpServer()).patch(url).set('Cookie', 'autosale_session=manager-token')
      .set('x-csrf-token', csrf.issue(manager.sessionId)).send({}).expect(403);
    expect(changeStatus).not.toHaveBeenCalled();
  });

  it.each([{ status: 'ARCHIVED', expectedVersion: 0 }, { status: 'CLOSED', expectedVersion: -1 },
    { status: 'CLOSED', expectedVersion: 0.5 }, { status: 'CLOSED', expectedVersion: '0' }, { status: 'CLOSED' }])
  ('returns a safe validation error for %j', async (body) => {
    const response = await request(app!.getHttpServer()).patch(`/api/conversations/${conversationId}/status`)
      .set('Cookie', 'autosale_session=manager-token').set('x-csrf-token', csrf.issue(manager.sessionId)).send(body).expect(400);
    expect(response.body.message).toBe('CONVERSATION_STATUS_INVALID');
    expect(changeStatus).not.toHaveBeenCalled();
  });

  it('returns safe conflict and not-found JSON errors', async () => {
    for (const [error, status] of [[new ConflictException('CONVERSATION_STATUS_CHANGED'), 409], [new NotFoundException('Conversation not found'), 404]] as const) {
      changeStatus.mockRejectedValueOnce(error);
      const response = await request(app!.getHttpServer()).patch(`/api/conversations/${conversationId}/status`)
        .set('Cookie', 'autosale_session=manager-token').set('x-csrf-token', csrf.issue(manager.sessionId))
        .send({ status: 'CLOSED', expectedVersion: 0 }).expect(status);
      expect(response.body.message).toBe(error.message);
      expect(response.body).not.toHaveProperty('stack');
    }
  });

  it('returns the shared safe tenant freeze error', async () => {
    changeStatus.mockRejectedValueOnce(new TenantLifecycleFrozenError('CONVERSATION_TRIAGE'));
    const response = await request(app!.getHttpServer()).patch(`/api/conversations/${conversationId}/status`)
      .set('Cookie', 'autosale_session=manager-token').set('x-csrf-token', csrf.issue(manager.sessionId))
      .send({ status: 'CLOSED', expectedVersion: 0 }).expect(409);
    expect(response.body).toEqual({ statusCode: 409, code: 'TENANT_LIFECYCLE_FROZEN', message: 'TENANT_LIFECYCLE_FROZEN' });
  });

  it('returns a list conforming to the shared response contract', async () => {
    const response = await request(app!.getHttpServer()).get('/api/conversations?limit=20')
      .set('Cookie', 'autosale_session=manager-token').expect(200);

    expect(() => conversationListResponseSchema.parse(response.body)).not.toThrow();
    expect(list).toHaveBeenCalledWith(tenantId, { limit: 20 });
  });

  it('filters valid statuses and rejects unknown status values', async () => {
    await request(app!.getHttpServer()).get('/api/conversations?status=INACTIVE&limit=1')
      .set('Cookie', 'autosale_session=manager-token').expect(200);
    expect(list).toHaveBeenCalledWith(tenantId, { status: 'INACTIVE', limit: 1 });
    list.mockClear();
    await request(app!.getHttpServer()).get('/api/conversations?status=ARCHIVED')
      .set('Cookie', 'autosale_session=manager-token').expect(400);
    expect(list).not.toHaveBeenCalled();
  });

  it('returns tenant counts through the fixed route and requires membership', async () => {
    const response = await request(app!.getHttpServer()).get('/api/conversations/status-counts')
      .set('Cookie', 'autosale_session=manager-token').expect(200);
    expect(response.body).toEqual({ ACTIVE: 2, INACTIVE: 1, CLOSED: 1 });
    expect(statusCounts).toHaveBeenCalledWith(tenantId);
    expect(detail).not.toHaveBeenCalled();
    resolveSession.mockResolvedValueOnce({ ...manager, membershipRole: null, tenantId: null });
    await request(app!.getHttpServer()).get('/api/conversations/status-counts')
      .set('Cookie', 'autosale_session=manager-token').expect(403);
    expect(statusCounts).toHaveBeenCalledTimes(1);
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

  it('starts and reports manual AI order recognition', async () => {
    const headers = {
      Cookie: 'autosale_session=manager-token',
      'x-csrf-token': csrf.issue(manager.sessionId),
    };
    const started = await request(app!.getHttpServer())
      .post(`/api/conversations/${conversationId}/order`)
      .set(headers)
      .expect(201);
    const state = await request(app!.getHttpServer())
      .get(`/api/conversations/${conversationId}/order`)
      .set('Cookie', 'autosale_session=manager-token')
      .expect(200);

    expect(() => conversationOrderStartResponseSchema.parse(started.body)).not.toThrow();
    expect(() => conversationOrderStateSchema.parse(state.body)).not.toThrow();
    expect(createOrder).toHaveBeenCalledWith(tenantId, conversationId);
    expect(orderState).toHaveBeenCalledWith(tenantId, conversationId);
  });

  it('publishes all endpoints with response schemas in OpenAPI', () => {
    const document = SwaggerModule.createDocument(app!, new DocumentBuilder().build());

    expect(document.paths['/api/conversations']?.get?.responses?.['200']).toBeDefined();
    expect(document.paths['/api/conversations/{id}']?.get?.responses?.['200']).toBeDefined();
    expect(document.paths['/api/conversations/{id}/messages']?.post?.responses?.['201']).toBeDefined();
    expect(document.paths['/api/conversations/{id}/messages/{messageId}/retry']?.post?.responses?.['201']).toBeDefined();
    expect(document.paths['/api/conversations/{id}/order']?.get?.responses?.['200']).toBeDefined();
    expect(document.paths['/api/conversations/{id}/order']?.post?.responses?.['201']).toBeDefined();
    const statusResponse = document.paths['/api/conversations/{id}/status']?.patch?.responses?.['200'];
    expect(JSON.stringify(statusResponse)).toContain('statusChangedAt');
    expect(JSON.stringify(statusResponse)).toContain('statusVersion');
    const response = document.paths['/api/conversations']?.get?.responses?.['200'];
    expect(JSON.stringify(response)).toContain('workflowStatus');
    expect(JSON.stringify(response)).toContain('statusVersion');
    expect(document.paths['/api/conversations/status-counts']?.get?.responses?.['200']).toBeDefined();
    expect(JSON.stringify(document.paths['/api/conversations']?.get?.parameters)).toContain('status');
    expect(JSON.stringify(response)).toContain('participantAvatarUrl');
    expect(JSON.stringify(response)).toContain('participantUsername');
    const detailResponse = document.paths['/api/conversations/{id}']?.get?.responses?.['200'];
    expect(JSON.stringify(detailResponse)).toContain('workflowStatus');
    expect(JSON.stringify(detailResponse)).toContain('statusVersion');
    expect(JSON.stringify(detailResponse)).toContain('TIKTOK_CAPABILITY_UNAVAILABLE');
    expect(JSON.stringify(detailResponse)).toContain('TIKTOK_REPLY_NOT_PERMITTED');
  });
});
