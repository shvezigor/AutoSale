import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'acceptance.spec.ts', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4188', browserName: 'chromium', viewport: { width: 1440, height: 1080 } },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:4188', reuseExistingServer: true },
});
