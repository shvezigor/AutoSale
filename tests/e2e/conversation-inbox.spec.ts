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
  await page.getByRole('link', { name: /Клієнт Instagram/i }).click();
  await expect(page.getByText('Хочу чорну модель 38 розміру')).toBeVisible();
  await expect(page.getByRole('img', { name: /вкладення з Instagram/i })).toBeVisible();
});

async function deliverFixture(request: APIRequestContext, name: string): Promise<void> {
  const body = await readFile(resolve(process.cwd(), `tests/fixtures/meta/${name}`));
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
