import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('keeps expected total and compatible payment account usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const styles = await readFile('apps/web/app/globals.css', 'utf8');
  await page.setContent(`
    <style>${styles}</style>
    <main class="review-panel">
      <section class="order-commercial-card review-section">
        <div class="commercial-card-heading"><div><h2>Оплата</h2><p>Автоматично розрахована сума та реквізити.</p></div><span class="commercial-ready">Розраховано</span></div>
        <div class="commercial-amount"><span>Сума до сплати</span><strong>2 598,00 грн</strong></div>
        <p class="commercial-payment-note">Сума до сплати — не підтвердження отримання коштів.</p>
        <dl class="commercial-selection-summary"><div><dt>Юридична особа</dt><dd>ТОВ Тест Комерс</dd></div><div><dt>Валюта</dt><dd>UAH</dd></div></dl>
        <label class="commercial-account-select">Рахунок для оплати<select><option>Основний UAH · UA••••0000 · UAH</option></select></label>
        <div class="commercial-card-actions"><button class="loading-button">Зберегти реквізити</button></div>
      </section>
    </main>
  `);

  await expect(page.getByText('2 598,00 грн')).toBeVisible();
  await expect(page.getByText('Сума до сплати — не підтвердження отримання коштів.')).toBeVisible();
  await expect(page.getByLabel('Рахунок для оплати')).toHaveValue('Основний UAH · UA••••0000 · UAH');
  await expect(page.getByRole('button', { name: 'Зберегти реквізити' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
