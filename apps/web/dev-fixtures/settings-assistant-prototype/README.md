# Settings assistant comparison prototype

From the repository root: `pnpm prototype:settings`.

Open <http://127.0.0.1:4188/>. The launcher installs the separately locked prototype dependencies on first use. Node/npm are required. The prototype follows the existing isolated Vite-fixture convention; it is not a Next.js route and is not deployed with the application.

- `?variant=both` compares both cards; `react` or `a2ui` shows one.
- Submit a request about reviewing every order, or use either suggested example. The second example demonstrates an already configured setting.
- Confirm each card independently. Try cancellation and the 403, 409 and 503 server simulations, then select success and retry.
- Reload preserves fictional settings in the local server's memory; restart or **Скинути приклад** resets them. No disk/database persistence, real company, provider, microphone, AI inference or customer-message operation exists.
- **Повідомлення A2UI 1.0** exposes the real messages consumed by the official SDK. No custom protocol renderer is substituted. The catalog allows five product-owned component types; buttons dispatch only `confirm` and `cancel`. The mock API accepts an allowlisted scenario and revision, not model-supplied settings or URLs.

Dependencies are confined to this folder and its npm lock. The SDK version is `0.15.0`; the protocol version is `1.0`. npm currently reports an upstream peer mismatch: `@a2ui/markdown-it@0.2.2` expects web_core `^0.14.0`, while the renderer requires `^0.15.0`. This prototype uses no Markdown components; verify upstream resolution before production adoption.

The main web app excludes this independent prototype from its TypeScript and Vitest projects. Checks from this folder:

```sh
npm run typecheck
npm run build
npm test
```

Playwright requires its Chromium installation (`npx playwright install chromium` if absent). Tests run serially because both cards use one fictional in-memory server. Responsive screenshots are written under ignored `test-results/`; set `PROTOTYPE_EVIDENCE_DIR` to retain them elsewhere. `vite preview` is not a functional demo: the fictional API is a development-only plugin. Shared Next client components cause harmless Vite `use client` warnings, and the full application stylesheet references an unused marketing image absent in this fixture.

The question, measured comparison and browser evidence are owned by [the assessment](../../../../docs/research/2026-11-12-settings-assistant-a2ui-comparison.md). The production assistant remains planned.
