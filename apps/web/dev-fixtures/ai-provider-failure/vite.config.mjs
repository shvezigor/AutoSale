import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const conversationId = '11111111-1111-4111-8111-111111111111';
const messageId = '33333333-3333-4333-8333-333333333333';
let explicitRetryCount = 0;
const conversation = {
  id: conversationId,
  channel: 'INSTAGRAM',
  participantName: 'Умовний клієнт',
  participantUsername: 'fictional.customer',
  participantAvatarUrl: null,
  replyCapability: { enabled: true, aiDraftSendAllowed: true, reason: null },
  messages: [{
    id: messageId,
    direction: 'INBOUND',
    senderId: 'fictional-customer',
    text: 'Покажіть модель Регіон',
    sourceTimestamp: '2026-10-05T10:00:00.000Z',
    attachments: [],
    delivery: null,
  }],
  replyDrafts: [{
    id: '55555555-5555-4555-8555-555555555555',
    conversationId,
    anchorMessageId: messageId,
    triggerSource: 'AUTOMATIC',
    availableAt: '2026-10-05T10:00:10.000Z',
    status: 'FAILED',
    outcome: null,
    generatedText: null,
    finalText: null,
    sources: [{
      productId: '77777777-7777-4777-8777-777777777777',
      sku: 'DOOR-7', name: 'Вигадані двері', variants: {},
      price: '1500', currency: 'UAH', stockQuantity: 3,
      updatedAt: '2026-10-05T09:00:00.000Z',
    }],
    errorCode: 'PROVIDER_UNAVAILABLE',
    createdAt: '2026-10-05T10:00:00.000Z',
    updatedAt: '2026-10-05T10:00:11.000Z',
  }],
};

function json(response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

export default {
  root,
  esbuild: { jsx: 'automatic' },
  resolve: { alias: {
    'next/link': path.join(root, 'next-link.tsx'),
    'next/navigation': path.join(root, 'next-navigation.ts'),
  } },
  server: { host: '127.0.0.1', port: 4177, strictPort: true, fs: { allow: [path.resolve(root, '../../../..')] } },
  plugins: [{
    name: 'isolated-ai-provider-failure-api',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url === `/api/conversations/${conversationId}` && request.method === 'GET') {
          json(response, 200, conversation);
        } else if (request.url === '/api/auth/csrf' && request.method === 'POST') {
          json(response, 200, { token: 'fictional-local-token' });
        } else if (request.url === `/api/conversations/${conversationId}/reply-drafts` && request.method === 'POST') {
          explicitRetryCount++;
          json(response, 503, { code: 'PROVIDER_UNAVAILABLE' });
        } else if (request.url === `/api/conversations/${conversationId}/messages` && request.method === 'POST') {
          json(response, 403, { code: 'FIXTURE_SEND_DISABLED' });
        } else if (request.url === '/__fixture/stats' && request.method === 'GET') {
          json(response, 200, { explicitRetryCount });
        } else {
          next();
        }
      });
    },
  }],
};
