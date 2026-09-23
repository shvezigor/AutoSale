import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('authenticated header stays inside the viewport at tablet width', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  const styles = await readFile('apps/web/app/globals.css', 'utf8');
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style>
    <div class="authenticated-shell">
      <aside class="primary-nav"></aside>
      <div class="authenticated-workspace">
        <header class="app-header">
          <div class="app-header-leading"><button class="mobile-menu-trigger" aria-label="Відкрити меню"></button><div class="app-header-search"><svg></svg><span>Пошук клієнта, товару, №</span><kbd>⌘ K</kbd></div></div>
          <div class="app-header-actions"><div class="locale-switcher"><button>UA</button><button>EN</button></div><div class="header-popover-root"><button class="header-icon-button" aria-label="Сповіщення"></button></div><div class="header-popover-root"><button class="profile-trigger" aria-label="Меню профілю"><span class="manager-avatar">І</span><span class="profile-trigger-copy"><strong>Ігор Швець</strong><small>owner@example.com</small></span></button></div></div>
        </header>
      </div>
    </div>`);

  await expect(page.getByRole('button', { name: 'Меню профілю' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
});
