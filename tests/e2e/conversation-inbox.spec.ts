import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test, type APIRequestContext } from '@playwright/test';

const appSecret = process.env.META_APP_SECRET ?? 'replace-with-meta-app-secret';

test('manager opens an Instagram conversation with a photo', async ({ page, request }) => {
  await deliverFixture(request, 'text-message.json');
  await deliverFixture(request, 'image-message.json');

  await expect
    .poll(async () => {
      const response = await request.get('/api/conversations?limit=20');
      const body = (await response.json()) as { items?: unknown[] };
      return body.items?.length ?? 0;
    })
    .toBeGreaterThan(0);

  await page.goto('/conversations');
  await page.getByRole('link', { name: /Вкладення з Instagram/i }).click();
  await expect(page.getByText('Хочу чорну модель 38 розміру')).toBeVisible();
  await expect(page.getByRole('img', { name: /вкладення з Instagram/i })).toBeVisible();
});

test('replayed Meta webhook creates one normalized message', async ({ request }) => {
  const uniqueId = `m_replay_${Date.now()}`;
  const marker = `Replay acceptance ${uniqueId}`;
  const payload = Buffer.from(JSON.stringify({
    object: 'instagram',
    entry: [{
      id: '17841400000000000',
      time: Date.now(),
      messaging: [{
        sender: { id: 'ig-user-replay' },
        recipient: { id: '17841400000000000' },
        timestamp: Date.now(),
        message: { mid: uniqueId, text: marker },
      }],
    }],
  }));

  await deliverBody(request, payload);
  await deliverBody(request, payload);

  await expect.poll(async () => countMessagesContaining(request, marker)).toBe(1);
});

test('manager opens an AI-created order and sees its Sheets state', async ({ page }) => {
  await page.goto('/orders');
  const order = page.getByRole('link', { name: /Клієнт Instagram.*Urban Black/i }).first();
  await expect(order).toBeVisible();
  await order.click();
  await expect(page.getByRole('region', { name: 'Замовлення' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Товар 1' })).toHaveValue('UB-038-BLK');
  await expect(page.getByRole('heading', { name: 'Очікує синхронізації' })).toBeVisible();
});

async function deliverFixture(request: APIRequestContext, name: string): Promise<void> {
  const body = await readFile(resolve(process.cwd(), `tests/fixtures/meta/${name}`));
  await deliverBody(request, body);
}

async function deliverBody(request: APIRequestContext, body: Buffer): Promise<void> {
  const signature = `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`;
  const response = await request.post('/webhooks/meta', {
    data: body,
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': signature,
    },
  });
  expect(response.ok()).toBe(true);
}

async function countMessagesContaining(request: APIRequestContext, marker: string): Promise<number> {
  const listResponse = await request.get('/api/conversations?limit=50');
  expect(listResponse.ok()).toBe(true);
  const list = (await listResponse.json()) as { items: Array<{ id: string }> };
  let count = 0;
  for (const conversation of list.items) {
    const detailResponse = await request.get(`/api/conversations/${conversation.id}`);
    if (!detailResponse.ok()) continue;
    const detail = (await detailResponse.json()) as { messages?: Array<{ text?: string | null }> };
    count += detail.messages?.filter((message) => message.text === marker).length ?? 0;
  }
  return count;
}
