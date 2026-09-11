import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('keeps the Nova Poshta drawer usable at 390×844 without jumping actions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const styles = await readFile('apps/web/app/globals.css', 'utf8');
  await page.setContent(`
    <style>${styles}</style>
    <button id="trigger">Оформити доставку</button>
    <div class="modal-backdrop shipment-dialog-backdrop">
      <section class="shipment-review-dialog" role="dialog" aria-label="Оформлення доставки">
        <header><div><span>Нова Пошта</span><h2>Оформлення доставки</h2></div><button class="icon-button" aria-label="Закрити">×</button></header>
        <div class="shipment-form">
          <div class="shipment-form-grid">
            <label><span>Ім’я отримувача</span><input value="Олена"></label>
            <label><span>Телефон отримувача</span><input value="+380671234567"></label>
            <label><span>Місто</span><input value="Луцьк"></label>
            <label><span>Відділення</span><input value="Відділення №24"></label>
          </div>
          <div class="shipment-parcel-grid">
            ${['Вага, кг', 'Довжина, см', 'Ширина, см', 'Висота, см', 'Оголошена вартість, грн', 'Післяплата, грн'].map((label) => `<label><span>${label}</span><input value="20"></label>`).join('')}
          </div>
          <div class="shipment-quote"><strong>120 грн</strong><span>Вартість розраховано</span></div>
        </div>
        <footer>
          <button class="secondary-button">Скасувати</button>
          <button class="loading-button"><span class="loading-button-idle">Зберегти чернетку</span><span class="loading-button-pending" aria-hidden="true"><span class="button-spinner"></span><span>Зберігаємо…</span></span></button>
          <button class="loading-button shipment-create-button"><span class="loading-button-idle">Створити ТТН</span><span class="loading-button-pending" aria-hidden="true"><span class="button-spinner"></span><span>Створюємо ТТН…</span></span></button>
        </footer>
      </section>
    </div>
    <div class="toast-viewport"><article class="toast toast-success">ТТН створено</article></div>
  `);

  const dialog = page.getByRole('dialog', { name: 'Оформлення доставки' });
  const create = page.getByRole('button', { name: 'Створити ТТН' });
  const before = await create.boundingBox();
  await create.evaluate((button) => {
    button.setAttribute('aria-busy', 'true');
    button.querySelector('.loading-button-idle')?.setAttribute('aria-hidden', 'true');
    button.querySelector('.loading-button-pending')?.removeAttribute('aria-hidden');
  });
  const after = await page.getByRole('button', { name: 'Створюємо ТТН…' }).boundingBox();
  const footer = await dialog.locator('footer').boundingBox();
  const toast = await page.locator('.toast-viewport').boundingBox();

  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(after!.width).toBe(before!.width);
  expect(footer).not.toBeNull();
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(844);
  expect(toast).not.toBeNull();
  expect(toast!.x + toast!.width).toBeLessThanOrEqual(378);
});
