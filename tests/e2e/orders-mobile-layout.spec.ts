import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('keeps order search and filters together on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const styles = await readFile('apps/web/app/globals.css', 'utf8');
  await page.setContent(`
    <style>${styles}</style>
    <div class="authenticated-shell">
      <div class="authenticated-workspace">
        <header class="app-header"><button class="mobile-menu-trigger"><span></span><span></span><span></span></button></header>
        <main class="orders-layout orders-layout-content">
          <section class="orders-content">
            <header class="orders-header"><h1>Замовлення</h1><p>Перевіряйте замовлення, які сформував AI.</p></header>
            <div class="orders-toolbar">
              <form><input aria-label="Пошук замовлень"><button class="secondary-button">Знайти</button></form>
              <label class="orders-status-filter"><select aria-label="Статус замовлення"><option>Усі статуси</option></select></label>
              <label class="orders-status-filter"><select aria-label="Комплектація"><option>Уся комплектація</option></select></label>
            </div>
            <div class="orders-cards"><a class="orders-card">Замовлення клієнта</a></div>
          </section>
        </main>
      </div>
    </div>
  `);

  const search = await page.getByLabel('Пошук замовлень').boundingBox();
  const status = await page.getByLabel('Статус замовлення').boundingBox();
  const card = await page.locator('.orders-card').boundingBox();
  const appHeader = await page.locator('.app-header').boundingBox();
  const pageHeading = await page.getByRole('heading', { name: 'Замовлення' }).boundingBox();

  expect(search).not.toBeNull();
  expect(status).not.toBeNull();
  expect(card).not.toBeNull();
  expect(appHeader).not.toBeNull();
  expect(pageHeading).not.toBeNull();
  expect(search!.height).toBeLessThan(60);
  expect(status!.y - (search!.y + search!.height)).toBeLessThan(40);
  expect(card!.y).toBeLessThan(500);
  expect(pageHeading!.y).toBeGreaterThanOrEqual(appHeader!.y + appHeader!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  if (process.env.MOBILE_SCREENSHOT_PATH) await page.screenshot({ path: process.env.MOBILE_SCREENSHOT_PATH, fullPage: false });
});
