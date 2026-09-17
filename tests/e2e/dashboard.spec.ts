import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const viewports = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'desktop', width: 1440, height: 1000 },
] as const;

for (const viewport of viewports) {
  test(`operational dashboard stays usable on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const styles = await readFile('apps/web/app/globals.css', 'utf8');
    const columns = Array.from({ length: 90 }, (_, index) => `<div class="dashboard-chart-column"><div class="dashboard-chart-bar" style="height:${20 + index % 80}%"><button aria-label="Day ${index + 1}: confirmed — 2" class="is-confirmed" data-tooltip="confirmed: 2" style="flex-grow:2"></button><button aria-label="Day ${index + 1}: needs review — 1" class="is-needsReview" data-tooltip="needs review: 1" style="flex-grow:1"></button></div><span>${index + 1}</span></div>`).join('');

    await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style>
      <main class="dashboard-page">
        <header class="dashboard-live-header"><div><h1>Операційний огляд</h1><p>Контролюйте замовлення та інтеграції.</p></div><nav class="dashboard-period-picker" aria-label="Період дашборду"><a href="/dashboard?period=7d">7 днів</a><a aria-current="page" href="/dashboard?period=30d">30 днів</a><a href="/dashboard?period=90d">90 днів</a></nav></header>
        <section class="dashboard-live-content">
          <section class="dashboard-overview is-clear"><div class="dashboard-live-metrics">${Array.from({ length: 4 }, (_, index) => `<article class="dashboard-live-metric"><span class="dashboard-live-metric-icon"></span><h2>Показник ${index + 1}</h2><strong>${index + 1}</strong><div class="dashboard-live-metric-foot"><span>Поточний стан</span></div></article>`).join('')}</div></section>
          <section class="dashboard-analytics-grid"><article class="dashboard-chart-card"><header class="dashboard-card-heading"><div><span>Період</span><h2>Динаміка замовлень</h2></div><a href="/orders">Усі замовлення</a></header><div class="dashboard-stacked-chart is-dense">${columns}</div></article><article class="dashboard-funnel-card"><header class="dashboard-card-heading"><div><span>Шлях</span><h2>Операційна воронка</h2></div></header></article></section>
          <section class="dashboard-actions-grid"><article class="dashboard-queue-card"><header class="dashboard-card-heading"><div><span>Пріоритет</span><h2>Черга на перевірку</h2></div><a href="/orders?status=NEEDS_REVIEW">Відкрити всі</a></header></article><div class="dashboard-side-stack"><article class="dashboard-issues-card"><div class="dashboard-issue"><span>!</span><div><strong>2</strong><small>помилки експорту</small></div><a href="/settings?tab=data">Перевірити експорт</a></div></article><article class="dashboard-integrations-card"><ul class="dashboard-integration-list"><li><a href="/settings?tab=social"><span class="dashboard-integration-mark">IG</span><span><strong>Instagram</strong></span><em class="is-active">Активне</em><span>›</span></a></li></ul></article></div></section>
        </section>
      </main>`);

    await expect(page.getByRole('heading', { name: 'Операційний огляд' })).toBeVisible();
    await expect(page.getByRole('link', { name: '30 днів' })).toHaveAttribute('href', '/dashboard?period=30d');
    await expect(page.getByRole('link', { name: 'Перевірити експорт' })).toHaveAttribute('href', '/settings?tab=data');
    const overflow = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('*')).filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.right > document.documentElement.clientWidth + 1 || rect.left < -1;
    }).map((element) => ({ className: element.className, left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, tag: element.tagName })));
    expect(overflow).toEqual([]);

    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).toBeVisible();
    expect(await focused.evaluate((element) => getComputedStyle(element).outlineStyle !== 'none')).toBe(true);
  });
}

test('desktop sidebar stays pinned while the dashboard scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  const styles = await readFile('apps/web/app/globals.css', 'utf8');

  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style>
    <div class="authenticated-shell">
      <aside class="primary-nav" data-testid="desktop-sidebar"><div class="primary-nav-brand-row"><span class="brand">AutoSale</span></div><nav><a class="nav-item active" href="#">Дашборд</a></nav></aside>
      <div class="authenticated-workspace"><header class="app-header">Header</header><main class="dashboard-page" style="min-height:2400px">Dashboard</main></div>
    </div>`);

  const sidebar = page.getByTestId('desktop-sidebar');
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveCSS('position', 'fixed');
  const before = await sidebar.evaluate((element) => element.getBoundingClientRect().top);
  await page.evaluate(() => window.scrollTo(0, 900));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const after = await sidebar.evaluate((element) => element.getBoundingClientRect().top);

  expect(before).toBe(0);
  expect(after).toBe(0);
});

test('authenticated dashboard renders the API snapshot and shareable period state', async ({ context, page }) => {
  const sessionToken = process.env.E2E_SESSION_TOKEN;
  test.skip(!sessionToken, 'An isolated dashboard session was not provided');
  await context.addCookies([{ domain: 'localhost', httpOnly: true, name: 'autosale_session', path: '/', sameSite: 'Lax', secure: false, value: sessionToken! }]);
  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  await page.goto('/dashboard?period=7d');

  await expect(page).toHaveURL(/\/dashboard\?period=7d$/);
  await expect(page.getByRole('heading', { name: /Операційний огляд|Operational overview/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /7 днів|7 days/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: /Динаміка замовлень|Order dynamics/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Операційна воронка|Operational funnel/ })).toBeVisible();
  await expect(page.getByText(/Демонстраційні дані|Demo data/)).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});
