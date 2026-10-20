import { expect, test, type Page } from '@playwright/test';

const widths = [320, 768, 1024, 1440] as const;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const ownerPassword = process.env.E2E_OWNER_PASSWORD;
const safeOrderId = process.env.E2E_SAFE_ORDER_ID;

async function noDocumentOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth, 'document must not scroll horizontally').toBeLessThanOrEqual(dimensions.clientWidth);
}

async function expectAccessibleError(page: Page, selector: string) {
  const control = page.locator(selector);
  await expect(control).toHaveAttribute('aria-invalid', 'true');
  const describedBy = await control.getAttribute('aria-describedby');
  expect(describedBy, `${selector} must describe its error`).toBeTruthy();
  for (const id of describedBy!.split(/\s+/)) await expect(page.locator(`[id="${id}"]`)).toBeVisible();
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ownerEmail!);
  await page.getByLabel('Пароль').fill(ownerPassword!);
  await page.getByRole('button', { name: 'Увійти' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

for (const width of widths) {
  test(`registration errors are keyboard-accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/register');
    await page.getByLabel('Ім’я').fill('Вигадана особа');
    await page.getByRole('button', { name: 'Зареєструватися' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Назва організації')).toBeFocused();
    await expectAccessibleError(page, '#auth-tenantName');
    await expect(page.getByLabel('Ім’я')).toHaveValue('Вигадана особа');
    await page.getByLabel('Назва організації').fill('Вигаданий магазин');
    await expect(page.locator('#auth-tenantName-error')).toHaveCount(0);
    await expectAccessibleError(page, '#auth-email');
    await noDocumentOverflow(page);
  });

  test(`profile and product validation remain accessible at ${width}px`, async ({ page }) => {
    test.skip(!ownerEmail || !ownerPassword, 'Authorized fictional owner credentials are not configured');
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    await page.goto('/profile');
    await page.locator('#profile-name').fill('');
    await page.getByRole('button', { name: 'Зберегти зміни' }).click();
    await expect(page.locator('#profile-name')).toBeFocused();
    await expectAccessibleError(page, '#profile-name');
    await page.locator('#profile-name').fill('Вигаданий тест');
    await expect(page.locator('#profile-name-error')).toHaveCount(0);
    await noDocumentOverflow(page);

    await page.goto('/catalogue');
    await page.locator('.catalogue-add-button').click();
    await page.locator('.product-editor button[type="submit"]').click();
    await expect(page.locator('#product-sku')).toBeFocused();
    await expectAccessibleError(page, '#product-sku');
    await expectAccessibleError(page, '#product-name');
    await page.locator('#product-sku').fill('FICTIONAL-ACCESSIBILITY');
    await expect(page.locator('#product-sku-error')).toHaveCount(0);
    await expectAccessibleError(page, '#product-name');
    await noDocumentOverflow(page);
  });

  test(`bank-account validation remains accessible at ${width}px`, async ({ page }) => {
    test.skip(!ownerEmail || !ownerPassword, 'Authorized fictional owner credentials are not configured');
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    await page.goto('/settings?tab=payments');
    await page.getByRole('button', { name: /Банківські рахунки/ }).click();
    const form = page.locator('.commercial-panel-content form').filter({ has: page.locator('#bank-account-iban') });
    test.skip(await form.count() === 0, 'Test tenant has no legal entity; bank-account form is unavailable');
    await form.getByRole('button', { name: 'Додати' }).click();
    await expect(page.locator('#bank-account-label')).toBeFocused();
    await expectAccessibleError(page, '#bank-account-label');
    await expectAccessibleError(page, '#bank-account-iban');
    await page.locator('#bank-account-label').fill('Вигаданий рахунок');
    await expect(page.locator('#bank-account-label-error')).toHaveCount(0);
    await expectAccessibleError(page, '#bank-account-iban');
    await noDocumentOverflow(page);
  });

  test(`payment and shipment invalid states make no writes at ${width}px`, async ({ page }) => {
    test.skip(!ownerEmail || !ownerPassword || !safeOrderId, 'Authorized owner credentials and fictional safe order ID are required');
    let writes = 0;
    await page.route('**/api/orders/**', async (route) => {
      if (['POST', 'PATCH', 'DELETE'].includes(route.request().method())) { writes += 1; await route.abort(); return; }
      await route.continue();
    });
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    await page.goto(`/orders/${encodeURIComponent(safeOrderId!)}`);
    const paymentForm = page.getByRole('form', { name: 'Додати факт оплати' });
    test.skip(await paymentForm.count() === 0, 'Safe order does not expose payment entry; amount preview is required');
    await paymentForm.locator('#payment-amount').fill('');
    await paymentForm.getByRole('button', { name: 'Зафіксувати оплату' }).click();
    await expect(paymentForm.locator('#payment-amount')).toBeFocused();
    await expectAccessibleError(page, '#payment-amount');
    await noDocumentOverflow(page);

    const shipmentButton = page.getByRole('button', { name: /Оформити доставку|Продовжити оформлення/ });
    test.skip(await shipmentButton.count() === 0 || await shipmentButton.isDisabled(), 'Safe order is not eligible for a shipment draft');
    await shipmentButton.click();
    const dialog = page.getByRole('dialog', { name: 'Оформлення доставки' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Створити ТТН' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(shipmentButton).toBeFocused();
    expect(writes, 'invalid-submit and dialog navigation must not mutate data').toBe(0);
    await noDocumentOverflow(page);
  });
}
