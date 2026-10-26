import { expect, test } from '@playwright/test';

test.describe('Sales AITO marketing site', () => {
  test('serves indexable Ukrainian content and a complete hero image', async ({ page }) => {
    await page.goto('/uk');
    await expect(page).toHaveTitle(/AI-оператор продажів/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://sales-aito.com/uk');
    await expect(page.locator('link[hreflang="en"]')).toHaveAttribute('href', 'https://sales-aito.com/en');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Продажі з діалогів');
    const heroImage = page.locator('.marketing-hero__visual img');
    await expect(heroImage).toHaveJSProperty('complete', true);
    await expect(heroImage).toHaveCSS('object-fit', 'cover');
    await expect.poll(() => heroImage.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  });

  test('switches to equivalent English content', async ({ page }) => {
    await page.goto('/uk/pricing');
    await page.getByRole('link', { name: 'Switch to English' }).click();
    await expect(page).toHaveURL(/\/en\/pricing$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('30 days free');
  });

  test('keeps article browser titles concise without shortening editorial headings', async ({ page }) => {
    for (const [locale, heading] of [
      ['uk', 'Як автоматизувати замовлення з Instagram без втрати контролю'],
      ['en', 'How to automate Instagram orders without losing control'],
    ] as const) {
      await page.goto(`/${locale}/blog/how-to-automate-instagram-orders`);
      const title = await page.title();
      expect(title).toContain('Instagram');
      expect(title).toContain('Sales AITO');
      expect(title.length).toBeLessThanOrEqual(60);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    }
  });

  test('has no horizontal overflow across key viewports', async ({ page }) => {
    for (const locale of ['uk', 'en']) {
      await page.goto(`/${locale}`);
      for (const viewport of [{ width: 320, height: 812 }, { width: 768, height: 1024 }, { width: 1024, height: 900 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(viewport);
        const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      }
    }
  });

  test('keeps the example readable without JavaScript and supports touch and enlarged text', async ({ browser }) => {
    const staticContext = await browser.newContext({ javaScriptEnabled: false });
    const staticPage = await staticContext.newPage();
    await staticPage.goto(`${process.env.E2E_BASE_URL ?? 'http://localhost'}/uk`);
    await expect(staticPage.getByRole('figure').getByText('Очікує перевірки менеджером')).toBeVisible();
    await staticContext.close();

    const touchContext = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } });
    const page = await touchContext.newPage();
    await page.goto(`${process.env.E2E_BASE_URL ?? 'http://localhost'}/en`);
    await page.locator('.marketing-menu summary').tap();
    await expect(page.locator('.marketing-menu__panel')).toBeVisible();
    await page.locator('.marketing-menu summary').tap();
    await page.locator('.faq-list summary').first().tap();
    await expect(page.locator('.faq-list details').first()).toHaveAttribute('open', '');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => { document.body.style.zoom = '2'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await touchContext.close();
  });

  test('explains the illustrated order with manager control in both languages', async ({ page }) => {
    for (const [locale, caption, review] of [
      ['uk', 'Ілюстрація процесу · вигадані дані', 'Очікує перевірки менеджером'],
      ['en', 'Workflow illustration · fictional data', 'Waiting for manager review'],
    ] as const) {
      await page.goto(`/${locale}`);
      const story = page.getByRole('figure');
      await story.scrollIntoViewIfNeeded();
      await expect(story.getByText(caption)).toBeVisible();
      await expect(story.getByText(review)).toBeVisible();
      await expect(story).toHaveAttribute('data-playing', 'true');
      await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
      await expect(story).toHaveAttribute('data-playing', 'false');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await story.scrollIntoViewIfNeeded();
      expect(await story.locator('li').first().evaluate((element) => getComputedStyle(element, '::before').animationName)).toBe('none');
      await page.reload();
      await expect(story.getByText(review)).toBeVisible();
    }
  });

  test('keeps hero navigation and FAQ usable by keyboard', async ({ page }) => {
    await page.goto('/uk');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Перейти до вмісту' })).toBeFocused();
    await page.keyboard.press('Enter');
    const trial = page.locator('.marketing-hero').getByRole('link', { name: /Спробувати/ });
    await trial.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/register$/);
    await page.goto('/uk');
    await page.locator('.marketing-hero').getByRole('link', { name: 'Замовити демо' }).click();
    await expect(page).toHaveURL(/\/uk\/demo$/);
    await page.goto('/uk');
    const question = page.locator('.faq-list summary').first();
    await question.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.faq-list details').first()).toHaveAttribute('open', '');
  });

  test('submits the demo form with an idempotency key and shows success', async ({ page }) => {
    let receivedKey = '';
    await page.route('**/api/demo-leads', async (route) => { receivedKey = route.request().headers()['idempotency-key'] ?? ''; await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'lead', accepted: true }) }); });
    await page.goto('/en/demo');
    await page.getByLabel('Name').fill('Test User');
    await page.getByLabel('Company or store').fill('Test Store');
    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('Monthly orders').selectOption('50_TO_300');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Book a demo' }).click();
    await expect(page.getByRole('heading', { name: 'Request received' })).toBeVisible();
    expect(receivedKey.length).toBeGreaterThan(10);
  });

  test('explains invalid demo fields without overflow or losing entered values', async ({ page }) => {
    await page.goto('/uk/demo');
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 850 });
      await page.getByLabel('Ім’я').fill('А');
      await page.getByLabel('Компанія або магазин').fill('Тестовий магазин');
      await page.getByRole('button', { name: 'Замовити демо' }).click();
      await expect(page.getByLabel('Ім’я')).toBeFocused();
      await expect(page.getByLabel('Ім’я')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('#demo-name-error')).toBeVisible();
      await expect(page.locator('#demo-orderVolume-error')).toBeVisible();
      await expect(page.getByLabel('Компанія або магазин')).toHaveValue('Тестовий магазин');
      const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
      await page.getByLabel('Ім’я').fill('Олена');
      await expect(page.locator('#demo-name-error')).toHaveCount(0);
      await expect(page.locator('#demo-orderVolume-error')).toBeVisible();
    }
  });
});
