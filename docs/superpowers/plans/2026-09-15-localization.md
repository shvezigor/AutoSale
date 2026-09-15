# Ukrainian and English Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-grade Ukrainian/English interface whose language persists per user, applies without URL changes, and covers every user-visible AutoSale screen and feedback message.

**Architecture:** Add one typed dictionary shape with Ukrainian as the canonical resource, resolve locale on the server, and expose the same translator/formatters to client components through a provider. Persist authenticated choices through the existing profile API, use a secure locale cookie before authentication, and translate product areas incrementally without changing tenant or customer content.

**Tech Stack:** TypeScript, Next.js 16 App Router, React 19, NestJS 11, Zod 4, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-14-user-profile-localization-table-sorting-design.md`

## Global Constraints

- Supported locale identifiers are exactly `uk` and `en`; Ukrainian is the fallback.
- Authenticated `User.locale` is authoritative; the cookie is authoritative only before authentication.
- Do not add locale URL segments or duplicate pages.
- Preserve pathname, query parameters, filters, and selected records when switching languages.
- Translate application copy and stable status/error labels, never customer messages, product names, customer names, or tenant data.
- Keep the existing notification settings structure and behavior unchanged.
- Dates shown to workspace users retain the `Europe/Kyiv` time zone unless an existing domain contract explicitly uses UTC.
- Profile locale updates remain self-scoped, authenticated, CSRF-protected, and audit-safe.
- Every task follows red-green-refactor, focused verification, and a standalone commit.

---

## File map

### Localization core

- Create `apps/web/src/i18n/locales.ts`: supported locale type, parser, browser-language normalization, and cookie constant.
- Create `apps/web/src/i18n/messages/uk.ts`: canonical nested translation dictionary.
- Create `apps/web/src/i18n/messages/en.ts`: English dictionary constrained to the Ukrainian shape.
- Create `apps/web/src/i18n/translator.ts`: typed dotted-key lookup and safe Ukrainian fallback.
- Create `apps/web/src/i18n/server.ts`: authenticated/cookie/browser locale resolution for server rendering.
- Create `apps/web/src/i18n/i18n-provider.tsx`: client translator, formatters, and locale mutation.
- Create `apps/web/src/i18n/*.spec.tsx`: parser, completeness, fallback, formatter, and mutation coverage.

### Locale controls

- Create `apps/web/src/components/locale-switcher.tsx`: accessible `UA` / `EN` popover shared by header and profile.
- Modify `apps/web/src/components/app-header.tsx`: render the compact language control.
- Modify `apps/web/src/components/profile-editor.tsx`: render the same language control in the profile language section.
- Modify `apps/web/app/layout.tsx` and `apps/web/app/(workspace)/layout.tsx`: resolve and provide locale in initial HTML.

### Translation coverage

- Modify authentication routes and components under `apps/web/app/(auth)` and `apps/web/src/components/*auth*`.
- Modify workspace shell, conversations, orders, catalogue, team, settings, delivery, integration, notification, loading, error, and toast components under `apps/web/app/(workspace)` and `apps/web/src/components`.
- Modify public legal routes only for their AutoSale navigation/chrome; legal text remains semantically identical.
- Create `apps/web/src/i18n/error-message.ts`: stable API/domain code to translated message mapping.

---

### Task 1: Add typed dictionaries and deterministic locale resolution

**Files:**
- Create: `apps/web/src/i18n/locales.ts`
- Create: `apps/web/src/i18n/messages/uk.ts`
- Create: `apps/web/src/i18n/messages/en.ts`
- Create: `apps/web/src/i18n/translator.ts`
- Create: `apps/web/src/i18n/server.ts`
- Test: `apps/web/src/i18n/locales.spec.ts`
- Test: `apps/web/src/i18n/translator.spec.ts`
- Test: `apps/web/src/i18n/server.spec.ts`

**Interfaces:**
- Produces: `type AppLocale = 'uk' | 'en'`.
- Produces: `parseLocale(value: unknown): AppLocale | null`.
- Produces: `createTranslator(locale: AppLocale): (key: MessageKey, values?: MessageValues) => string`.
- Produces: `resolveServerLocale(sessionLocale?: unknown): Promise<AppLocale>`.

- [ ] **Step 1: Write failing locale and dictionary tests**

```ts
expect(parseLocale('uk')).toBe('uk');
expect(parseLocale('en-US')).toBeNull();
expect(createTranslator('en')('navigation.orders')).toBe('Orders');
expect(Object.keys(enMessages).sort()).toEqual(Object.keys(ukMessages).sort());
```

Add server-resolution cases proving `session locale > autosale_locale cookie > Accept-Language > uk`.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @autosale/web exec vitest run src/i18n/locales.spec.ts src/i18n/translator.spec.ts src/i18n/server.spec.ts`

Expected: FAIL because localization modules do not exist.

- [ ] **Step 3: Implement the minimal typed core**

```ts
export const supportedLocales = ['uk', 'en'] as const;
export type AppLocale = (typeof supportedLocales)[number];
export const LOCALE_COOKIE = 'autosale_locale';

export function parseLocale(value: unknown): AppLocale | null {
  return value === 'uk' || value === 'en' ? value : null;
}
```

Define `ukMessages` with product-area groups and constrain English recursively:

```ts
export const ukMessages = { common: { save: 'Зберегти' }, navigation: { orders: 'Замовлення' } } as const;
export type Messages = DeepStringShape<typeof ukMessages>;
export const enMessages: Messages = { common: { save: 'Save' }, navigation: { orders: 'Orders' } };
```

`createTranslator` must substitute `{name}` values and fall back to the Ukrainian value for an unavailable runtime entry without exposing the key to users.

- [ ] **Step 4: Verify the focused core**

Run: `pnpm --filter @autosale/web exec vitest run src/i18n/locales.spec.ts src/i18n/translator.spec.ts src/i18n/server.spec.ts && pnpm --filter @autosale/web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the localization core**

```powershell
git add -- apps/web/src/i18n
git commit -m "feat(i18n): add typed locale foundation"
```

---

### Task 2: Provide localized rendering and persist language changes

**Files:**
- Create: `apps/web/src/i18n/i18n-provider.tsx`
- Test: `apps/web/src/i18n/i18n-provider.spec.tsx`
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/app/(workspace)/layout.tsx`
- Modify: `apps/web/src/components/authenticated-shell.tsx`

**Interfaces:**
- Consumes: Task 1 locale resolution and translator.
- Produces: `I18nProvider({ locale, authenticated, children })`.
- Produces: `useI18n(): { locale; t; formatDate; formatNumber; setLocale }`.
- Produces: authenticated `PATCH /api/profile` locale persistence and unauthenticated cookie persistence.

- [ ] **Step 1: Write failing provider tests**

Assert English initial rendering, localized `Europe/Kyiv` dates, number formatting, successful authenticated `PATCH /api/profile` with the existing name/phone plus the new locale, cookie-only unauthenticated switching, rollback after mutation failure, right-side error toast, and `router.refresh()` only after success.

- [ ] **Step 2: Run the provider test and verify RED**

Run: `pnpm --filter @autosale/web exec vitest run src/i18n/i18n-provider.spec.tsx`

Expected: FAIL because the provider does not exist.

- [ ] **Step 3: Implement provider and initial server locale**

```tsx
const I18nContext = createContext<I18nValue | null>(null);

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('I18N_PROVIDER_MISSING');
  return value;
}
```

The root layout must set `<html lang={locale}>`. The authenticated layout passes `session.locale`; unauthenticated resolution uses the cookie/header chain. `setLocale` keeps the current URL, updates optimistically, persists, then refreshes server-rendered content. On failure it restores the prior locale.

- [ ] **Step 4: Verify provider and layouts**

Run: `pnpm --filter @autosale/web exec vitest run src/i18n/i18n-provider.spec.tsx 'app/(workspace)/layout.spec.tsx' && pnpm --filter @autosale/web typecheck`

Expected: PASS with no hydration mismatch.

- [ ] **Step 5: Commit localized rendering infrastructure**

```powershell
git add -- apps/web/app/layout.tsx 'apps/web/app/(workspace)/layout.tsx' apps/web/src/i18n apps/web/src/components/authenticated-shell.tsx
git commit -m "feat(i18n): provide persisted locale context"
```

---

### Task 3: Add accessible language controls to header and profile

**Files:**
- Create: `apps/web/src/components/locale-switcher.tsx`
- Create: `apps/web/src/components/locale-switcher.spec.tsx`
- Modify: `apps/web/src/components/app-header.tsx`
- Modify: `apps/web/src/components/app-header.spec.tsx`
- Modify: `apps/web/src/components/profile-editor.tsx`
- Modify: `apps/web/src/components/profile-editor.spec.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: `useI18n().locale` and `useI18n().setLocale`.
- Produces: compact header `UA` / `EN` control and a labelled profile language section.

- [ ] **Step 1: Write failing interaction tests**

```tsx
expect(screen.getByRole('button', { name: 'Мова інтерфейсу: Українська' })).toHaveTextContent('UA');
await user.click(screen.getByRole('button', { name: 'Мова інтерфейсу: Українська' }));
await user.click(screen.getByRole('menuitemradio', { name: 'English' }));
expect(setLocale).toHaveBeenCalledWith('en');
```

Also test Escape, outside click, checked state, focus restoration, disabled pending state, profile reuse, and a 40px minimum mobile target.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @autosale/web exec vitest run src/components/locale-switcher.spec.tsx src/components/app-header.spec.tsx src/components/profile-editor.spec.tsx`

Expected: FAIL on the missing controls.

- [ ] **Step 3: Implement one shared switcher**

Use a `menu` with two `menuitemradio` choices, stable `UA`/`EN` trigger width, `aria-expanded`, `aria-checked`, pending spinner, outside-click close, Escape close, and trigger-focus restoration. Profile renders the same component with a visible label and explanatory text; it does not duplicate locale mutation logic.

- [ ] **Step 4: Verify controls and responsive styling**

Run: `pnpm --filter @autosale/web exec vitest run src/components/locale-switcher.spec.tsx src/components/app-header.spec.tsx src/components/profile-editor.spec.tsx && pnpm --filter @autosale/web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit language controls**

```powershell
git add -- apps/web/src/components/locale-switcher* apps/web/src/components/app-header* apps/web/src/components/profile-editor* apps/web/app/globals.css
git commit -m "feat(i18n): add language switchers"
```

---

### Task 4: Translate authentication, navigation, profile, and common feedback

**Files:**
- Modify: `apps/web/src/i18n/messages/uk.ts`
- Modify: `apps/web/src/i18n/messages/en.ts`
- Modify: `apps/web/app/(auth)/**/*.tsx`
- Modify: `apps/web/src/components/auth-form.tsx`
- Modify: `apps/web/src/components/google-sign-in-button.tsx`
- Modify: `apps/web/src/components/google-onboarding-form.tsx`
- Modify: `apps/web/src/components/primary-navigation.tsx`
- Modify: `apps/web/src/components/app-header.tsx`
- Modify: `apps/web/src/components/profile-editor.tsx`
- Modify: `apps/web/src/components/activity-provider.tsx`
- Modify: `apps/web/src/components/confirm-provider.tsx`
- Modify: `apps/web/src/components/toast-provider.tsx`
- Test: corresponding existing component and route specs.

**Interfaces:**
- Consumes: `useI18n()` in client components and `createTranslator(locale)` in server routes.
- Produces: complete Ukrainian/English auth, shell, profile, confirmation, loading, and toast copy.

- [ ] **Step 1: Add English rendering assertions before changing components**

For each affected spec, render with `locale="en"` and assert meaningful headings, actions, empty/loading states, validation messages, and accessible labels. Keep existing Ukrainian assertions.

- [ ] **Step 2: Run the affected tests and verify RED**

Run: `pnpm --filter @autosale/web exec vitest run src/components/auth-form.spec.tsx src/components/app-header.spec.tsx src/components/primary-navigation.spec.tsx src/components/profile-editor.spec.tsx`

Expected: FAIL because components still contain Ukrainian literals.

- [ ] **Step 3: Move copy into product-area dictionaries**

Replace JSX literals with typed keys such as `authentication.login.title`, `navigation.catalogue`, `profile.personal.save`, and `common.actions.cancel`. Keep email addresses, role data, and user values unchanged. Route-level server errors use translated generic messages.

- [ ] **Step 4: Verify the first translated vertical slice**

Run: `pnpm --filter @autosale/web exec vitest run 'app/(auth)' src/components/auth-form.spec.tsx src/components/app-header.spec.tsx src/components/primary-navigation.spec.tsx src/components/profile-editor.spec.tsx src/components/activity-provider.spec.tsx src/components/confirm-provider.spec.tsx src/components/toast-provider.spec.tsx && pnpm --filter @autosale/web typecheck`

Expected: PASS in both locales.

- [ ] **Step 5: Commit auth and shell translations**

```powershell
git add -- 'apps/web/app/(auth)' apps/web/src/components apps/web/src/i18n/messages
git commit -m "feat(i18n): translate authentication and shell"
```

---

### Task 5: Translate conversations, catalogue, orders, and team

**Files:**
- Modify: `apps/web/app/(workspace)/conversations/**/*.tsx`
- Modify: `apps/web/app/(workspace)/catalogue/**/*.tsx`
- Modify: `apps/web/app/(workspace)/orders/**/*.tsx`
- Modify: `apps/web/app/(workspace)/team/**/*.tsx`
- Modify: related components and specs under `apps/web/src/components`.
- Modify: `apps/web/src/i18n/messages/uk.ts`
- Modify: `apps/web/src/i18n/messages/en.ts`

**Interfaces:**
- Produces: translated operational workflows while preserving customer and catalogue content verbatim.

- [ ] **Step 1: Add route-group English tests**

Cover list headings, searches, filters, pagination, empty/error/loading states, order review actions, procurement labels, shipment actions, chat composer controls, and team invitation controls. Include a customer Ukrainian message and product name assertion proving they remain unchanged in English UI.

- [ ] **Step 2: Run route-group tests and verify RED**

Run: `pnpm --filter @autosale/web exec vitest run 'app/(workspace)/conversations' 'app/(workspace)/catalogue' 'app/(workspace)/orders' src/components/team-management.spec.tsx`

Expected: FAIL on untranslated application copy.

- [ ] **Step 3: Translate components and replace fixed formatters**

Use `formatDate` and `formatNumber` from the localization context. Map stable values such as `AUTO_APPROVED`, `APPROVED`, `NOVA_POSHTA`, and procurement statuses through dictionary keys. Do not transform incoming messages, names, SKUs, product titles, addresses, or tracking numbers.

- [ ] **Step 4: Verify operational workflows**

Run: `pnpm --filter @autosale/web exec vitest run 'app/(workspace)/conversations' 'app/(workspace)/catalogue' 'app/(workspace)/orders' src/components/conversation-list.spec.tsx src/components/message-thread.spec.tsx src/components/catalogue-table.spec.tsx src/components/orders-table.spec.tsx src/components/order-review-panel.spec.tsx src/components/team-management.spec.tsx && pnpm --filter @autosale/web typecheck`

Expected: PASS in Ukrainian and English.

- [ ] **Step 5: Commit core workflow translations**

```powershell
git add -- 'apps/web/app/(workspace)' apps/web/src/components apps/web/src/i18n/messages
git commit -m "feat(i18n): translate core sales workflows"
```

---

### Task 6: Translate settings, delivery, integrations, and notifications

**Files:**
- Modify: `apps/web/app/(workspace)/settings/**/*.tsx`
- Modify: settings, delivery, Google, Instagram, Telegram, supplier, catalogue-import, and notification components/specs under `apps/web/src/components`.
- Modify: `apps/web/src/i18n/messages/uk.ts`
- Modify: `apps/web/src/i18n/messages/en.ts`

**Interfaces:**
- Produces: translated settings copy without changing accordion structure, connection behavior, provider identifiers, or notification preferences.

- [ ] **Step 1: Add English tests for each settings hub**

Assert translated tabs/accordions, connection statuses, setup instructions, validation, progress, toasts, and confirmation dialogs. Assert `Instagram`, `Telegram`, `Nova Poshta`, `Meest`, `Ukrposhta`, Google account identifiers, sheet names, and tenant data stay unchanged.

- [ ] **Step 2: Run settings tests and verify RED**

Run: `pnpm --filter @autosale/web exec vitest run 'app/(workspace)/settings/page.spec.tsx' src/components/*settings*.spec.tsx src/components/catalogue-import-wizard.spec.tsx src/components/delivery-carrier-hub.spec.tsx`

Expected: FAIL on untranslated settings copy.

- [ ] **Step 3: Translate settings in existing accordion boundaries**

Use typed keys grouped under `settings`, `delivery`, `integrations`, and `notifications`. Do not move the notifications section, add providers, alter connected-account state, or change mutation payloads.

- [ ] **Step 4: Verify settings and integrations**

Run: `pnpm --filter @autosale/web exec vitest run 'app/(workspace)/settings/page.spec.tsx' src/components/*settings*.spec.tsx src/components/catalogue-import-wizard.spec.tsx src/components/delivery-carrier-hub.spec.tsx src/components/notification-channel-hub.spec.tsx && pnpm --filter @autosale/web typecheck`

Expected: PASS in both locales.

- [ ] **Step 5: Commit settings translations**

```powershell
git add -- 'apps/web/app/(workspace)/settings' apps/web/src/components apps/web/src/i18n/messages
git commit -m "feat(i18n): translate settings and integrations"
```

---

### Task 7: Localize stable errors and close translation coverage gaps

**Files:**
- Create: `apps/web/src/i18n/error-message.ts`
- Create: `apps/web/src/i18n/error-message.spec.ts`
- Modify: affected API client/component catch paths.
- Modify: `apps/web/src/i18n/messages/uk.ts`
- Modify: `apps/web/src/i18n/messages/en.ts`
- Test: `apps/web/src/i18n/completeness.spec.ts`

**Interfaces:**
- Produces: `localizeApiError(error: unknown, t: Translator): string`.
- Produces: automated literal/completeness guard for supported application areas.

- [ ] **Step 1: Write failing error and completeness tests**

Assert known codes (`PROFILE_CURRENT_PASSWORD_INVALID`, `PROFILE_AVATAR_INVALID`, authorization, rate limit, catalogue import, delivery, Telegram, Google, and Instagram codes) map to user-safe messages in both locales. Unknown errors map to `errors.generic`; raw server text and stack details never render.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @autosale/web exec vitest run src/i18n/error-message.spec.ts src/i18n/completeness.spec.ts`

Expected: FAIL because mappings and coverage guard do not exist.

- [ ] **Step 3: Implement safe code mapping and remove remaining UI literals**

```ts
const codeKeys = {
  PROFILE_CURRENT_PASSWORD_INVALID: 'errors.profile.currentPasswordInvalid',
  PROFILE_AVATAR_INVALID: 'errors.profile.avatarInvalid',
} satisfies Record<string, MessageKey>;

export function localizeApiError(error: unknown, t: Translator): string {
  const code = readStableErrorCode(error);
  return t(code && codeKeys[code] ? codeKeys[code] : 'errors.generic');
}
```

The completeness test verifies equal dictionary leaf paths and scans designated UI files for newly introduced hard-coded Ukrainian/English action copy, with an explicit allowlist for tenant/customer content fixtures and product/provider names.

- [ ] **Step 4: Run the entire web suite**

Run: `pnpm --filter @autosale/web test -- --run && pnpm --filter @autosale/web typecheck && pnpm --filter @autosale/web build`

Expected: PASS.

- [ ] **Step 5: Commit localized error handling**

```powershell
git add -- apps/web/src/i18n apps/web/src/components 'apps/web/app/(workspace)' 'apps/web/app/(auth)'
git commit -m "feat(i18n): localize errors and enforce coverage"
```

---

### Task 8: Release checkpoint 2 and verify both languages

**Files:**
- Modify only if verification finds a regression.

**Interfaces:**
- Produces: deployed localization checkpoint on `sales-aito.com`.

- [ ] **Step 1: Run the full release gate**

```powershell
pnpm typecheck
pnpm test -- --run
pnpm build
git diff --check
```

Expected: all packages PASS, all dictionary checks PASS, and no whitespace errors.

- [ ] **Step 2: Verify desktop and 400px mobile flows**

In a real browser, verify login, profile, conversations, catalogue, orders, team, settings, toasts, dialogs, and loading/error states in both languages. Switching language must preserve the current pathname/query and must not translate tenant/customer content.

- [ ] **Step 3: Push, merge, and deploy**

```powershell
git push -u origin codex/localization
& .\scripts\deploy-local.ps1 -EnvFile 'C:\Users\User\Documents\ChatGPT\AutoSales\.env'
docker compose --env-file 'C:\Users\User\Documents\ChatGPT\AutoSales\.env' ps
```

Expected: API, worker, and web become healthy and the live site renders both locales.

- [ ] **Step 4: Verify live persistence**

Select English on an authenticated route, refresh, navigate to two other routes, sign out, and verify the appropriate authenticated/cookie resolution behavior. Restore the live account to the user's preferred locale after the test.

