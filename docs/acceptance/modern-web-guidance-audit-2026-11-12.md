# Modern Web Guidance site audit — 2026-11-12

## Scope and method

Review the production and source of the Sales AITO public site, login/workspace shell, global search, conversation list, forms, dialogs and client-side background work against the applicable [GoogleChrome Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance). The CLI `legacy-scan apps/web --json` applies 35 deterministic rules across 33 guides; it is not a complete audit of the guidance catalog. Search and retrieve focused guides for dialog modality, accessible errors, navigation, image priority and background work. Do not enable volatile or Origin Trial features.

## Findings and corrections

| Area | Evidence and effect | Correction |
|---|---|---|
| Global workspace search | On production `/dashboard`, opening search focused its input, then one `Tab` moved focus to the header language switcher behind the claimed modal. The background was still operable. | Use a native modal `<dialog>` with `showModal()`; preserve the existing search behavior, visual sheet, close button and focus return. Remove the redundant document Escape handler. |
| Profile disclosure | The popover claimed `menu`/`menuitem` roles but provided ordinary Tab navigation and no menu arrow-key handling. | Keep its disclosure behavior and render the actions with their native link/button semantics. Escape still closes and returns focus to the trigger. |
| Conversation list images | Every profile image in the scrollable list was eager, including rows below the viewport. | Give avatars fixed 40×40 dimensions and native lazy loading with asynchronous decoding. Keep the marketing hero image eager and high-priority. |
| Web release checks | The separately locked settings-assistant prototype was included in the main web TypeScript and Vitest projects, breaking the application gates before these changes. | Exclude only that independent fixture from the app projects; it retains its own `npm run typecheck`, `npm run build` and `npm test` commands. |

## Checks and limits

- The deterministic scan reports **0 findings** after the prior password-autofill correction. This does not certify the other guides.
- Source review found existing localized field errors with `aria-invalid`/`aria-describedby`, a high-priority non-lazy marketing hero, reduced-motion behavior, and polling that skips hidden documents in the inspected conversation components. No broad rewrite is justified by this audit.
- Local checks after the fixes: 17 focused component tests; 554 full web tests; web TypeScript check; optimized Next.js build. All passed.
- The pre-release dependency audit found three moderate and one low advisory in existing transitive packages (`qs`, `glob`, `minimatch`, `fast-xml-parser`); the production audit at the required high-severity threshold passed. No dependency was changed as part of this browser-platform audit.
- Read-only production browser checks passed for the Ukrainian hero image, no document overflow at 320/768/1024/1440 px in Ukrainian and English, touch navigation, enlarged-text layout, and the no-JavaScript example. These checks ran before the new workspace UI was deployed.
- The search modal, profile disclosure and avatar network behavior still require post-deployment browser acceptance in the authenticated workspace, including keyboard, mobile, 200% zoom, and both locales. A transient dashboard load error was observed during inspection while `/health/live` returned 200; its cause was not established by this audit and is tracked separately from the browser-platform corrections.
