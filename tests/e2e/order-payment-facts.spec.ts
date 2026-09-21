import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('keeps payment facts and cancelled history usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const styles = await readFile('apps/web/app/globals.css', 'utf8');
  await page.setContent(`
    <style>${styles}</style>
    <main class="review-panel">
      <section class="order-payments-card review-section">
        <div class="payment-card-heading"><div><h2>Факти оплат</h2><p>Фактично отримані кошти.</p></div><span class="payment-status payment-partially_paid">Частково оплачено</span></div>
        <dl class="payment-summary">
          <div><dt>До сплати</dt><dd>500,00 грн</dd></div><div><dt>Отримано</dt><dd>200,00 грн</dd></div>
          <div><dt>Залишок</dt><dd>300,00 грн</dd></div><div><dt>Статус</dt><dd>Частково оплачено</dd></div>
        </dl>
        <form class="payment-form"><div class="payment-form-grid"><label>Сума<input value="300.00"></label><label>Спосіб<select><option>Банківський переказ</option></select></label><label>Дата<input type="datetime-local" value="2026-09-21T10:00"></label><label class="payment-note">Примітка<textarea></textarea></label></div><div class="payment-form-actions"><button>Зафіксувати оплату</button></div></form>
        <section class="payment-history"><h3>Історія оплат</h3><ul>
          <li class="payment-history-row"><div><strong>200,00 грн</strong><span>Готівка · 20 вер.</span></div><span>Менеджер Тест</span></li>
          <li class="payment-history-row" data-cancelled="true"><div><strong>300,00 грн</strong><span>Банківський переказ · 19 вер.</span><small>Скасовано: помилковий запис</small></div><span>Власник Тест</span></li>
        </ul></section>
      </section>
    </main>
  `);

  await expect(page.getByRole('heading', { name: 'Факти оплат' })).toBeVisible();
  await expect(page.getByText('Залишок')).toBeVisible();
  await expect(page.getByText('Скасовано: помилковий запис')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Зафіксувати оплату' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
