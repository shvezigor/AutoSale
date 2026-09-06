# Persistent App Shell Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перебудувати авторизовану частину AutoSale на постійну оболонку Next.js із плавними переходами, згортаним desktop-sidebar і mobile drawer без повного перезавантаження документа.

**Architecture:** Авторизовані маршрути живуть у route group `(workspace)` зі спільним server layout, який отримує сесію та один раз монтує client-компонент `AuthenticatedShell`. Сторінки рендерять лише власний контент; `template.tsx` анімує зміну контенту, а `PrimaryNavigation` визначає активний маршрут через `usePathname`. Стан sidebar зберігається в `localStorage`, а короткий ранній script виставляє HTML data-атрибут до першого кадру, щоб уникнути стрибка ширини.

**Tech Stack:** Next.js 16.3 App Router, React 19.2, TypeScript, CSS, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-06-persistent-app-shell-navigation-design.md`

## Global Constraints

- Публічні URL `/conversations`, `/orders`, `/catalogue`, `/team`, `/settings` не змінюються.
- Desktop-sidebar має ширину 240 px у розгорнутому стані й 72 px у згорнутому.
- За замовчуванням sidebar розгорнутий; вибір зберігається локально без персональних даних.
- Анімація контенту триває 150–180 мс і вимикається при `prefers-reduced-motion: reduce`.
- Внутрішні переходи не перезавантажують document; Google/Meta OAuth залишаються повною навігацією.
- Loading fallback замінює лише робочу область, не sidebar або header.
- Не додавати глобальний client store для замовлень, діалогів чи каталогу.

## File Structure

- Create `apps/web/app/(workspace)/layout.tsx`: server-boundary авторизованої оболонки.
- Create `apps/web/app/(workspace)/template.tsx`: анімаційна межа контенту між маршрутами.
- Create `apps/web/app/(workspace)/error.tsx`: локальна помилка контенту, яка не прибирає оболонку.
- Move `apps/web/app/{conversations,orders,catalogue,team,settings}` to `apps/web/app/(workspace)/...`: підключення існуючих сторінок і loading UI до спільного layout без зміни URL.
- Modify `apps/web/app/layout.tsx`: раннє відновлення sidebar preference до першого кадру.
- Modify `apps/web/src/auth/session.ts`: request-scoped memoization читання сесії.
- Modify `apps/web/src/components/authenticated-shell.tsx`: постійна оболонка, desktop collapse і mobile drawer.
- Modify `apps/web/src/components/primary-navigation.tsx`: конфігурація маршрутів, іконки, active state і доступність.
- Modify `apps/web/src/components/inbox-shell.tsx`: прибрати вкладений `AuthenticatedShell`.
- Modify `apps/web/app/globals.css`: дві ширини sidebar, drawer, transition, tooltips і reduced motion.
- Modify existing component/page specs and create layout/template tests for the new boundaries.

---

### Task 1: Request-scoped session and shared workspace layout

**Files:**
- Modify: `apps/web/src/auth/session.ts`
- Test: `apps/web/src/auth/session.spec.ts`
- Create: `apps/web/app/(workspace)/layout.tsx`
- Test: `apps/web/app/(workspace)/layout.spec.tsx`

**Interfaces:**
- Consumes: existing `getServerSession(): Promise<PublicSession | null>` behavior and `AuthenticatedShell`.
- Produces: memoized `getServerSession()` and `WorkspaceLayout({ children }): Promise<ReactNode>`.

- [ ] **Step 1: Write failing session memoization test**

Mock `next/headers`, call `getServerSession()` twice within the same cached render context, and assert the API session endpoint is requested once while both calls return the same public session.

```ts
it('deduplicates session reads during one server render', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(session), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const [first, second] = await Promise.all([getServerSession(), getServerSession()]);
  expect(first).toEqual(session);
  expect(second).toEqual(session);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `pnpm --filter @autosale/web test -- src/auth/session.spec.ts`

Expected: FAIL because two calls currently perform two fetches.

- [ ] **Step 3: Memoize the server session read**

Wrap the existing async reader with React `cache`, keeping the public signature unchanged:

```ts
import { cache } from 'react';

const readServerSession = cache(async (): Promise<PublicSession | null> => {
  // Existing cookies() + fetch implementation.
});

export function getServerSession() {
  return readServerSession();
}
```

Reset module state between tests so a cached value cannot leak across test cases.

- [ ] **Step 4: Write the workspace layout test**

Mock `getServerSession` and `AuthenticatedShell`. Verify an authenticated session wraps `children`, and a missing session produces no protected content.

```tsx
it('mounts the authenticated shell around workspace content', async () => {
  getServerSession.mockResolvedValue(session);
  render(await WorkspaceLayout({ children: <h1>Каталог</h1> }));
  expect(screen.getByTestId('authenticated-shell')).toHaveTextContent('Каталог');
});
```

- [ ] **Step 5: Implement the shared server layout**

```tsx
export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession();
  if (!session) return null;
  return <AuthenticatedShell session={session}>{children}</AuthenticatedShell>;
}
```

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```powershell
pnpm --filter @autosale/web test -- src/auth/session.spec.ts 'app/(workspace)/layout.spec.tsx'
pnpm --filter @autosale/web typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```powershell
git add apps/web/src/auth/session.ts apps/web/src/auth/session.spec.ts 'apps/web/app/(workspace)/layout.tsx' 'apps/web/app/(workspace)/layout.spec.tsx'
git commit -m "refactor: add shared authenticated workspace layout"
```

### Task 2: Move workspace routes under the shared layout

**Files:**
- Move: `apps/web/app/conversations/**` → `apps/web/app/(workspace)/conversations/**`
- Move: `apps/web/app/orders/**` → `apps/web/app/(workspace)/orders/**`
- Move: `apps/web/app/catalogue/**` → `apps/web/app/(workspace)/catalogue/**`
- Move: `apps/web/app/team/**` → `apps/web/app/(workspace)/team/**`
- Move: `apps/web/app/settings/**` → `apps/web/app/(workspace)/settings/**`
- Modify: all moved `page.tsx`, `loading.tsx`, and `*.spec.tsx` relative imports.
- Modify: `apps/web/src/components/inbox-shell.tsx`
- Test: `apps/web/src/components/inbox-shell.spec.tsx`

**Interfaces:**
- Consumes: `WorkspaceLayout` from Task 1.
- Produces: route pages that return only route content, plus `InboxShell` that renders only the three-column inbox content.

- [ ] **Step 1: Update the InboxShell test first**

Remove the expectation that `InboxShell` renders global navigation. Assert it renders its conversation rail and children without an additional `AuthenticatedShell`.

```tsx
it('renders inbox content without nesting the global shell', () => {
  render(<InboxShell conversations={[]}><div>Порожній діалог</div></InboxShell>);
  expect(screen.getByText('Порожній діалог')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'AutoSale' })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the InboxShell test and confirm failure**

Run: `pnpm --filter @autosale/web test -- src/components/inbox-shell.spec.tsx`

Expected: FAIL because `InboxShell` still mounts `AuthenticatedShell`.

- [ ] **Step 3: Remove shell ownership from route content**

Change `InboxShell` to return only:

```tsx
return (
  <main className="app-shell app-shell-content">
    <InboxSidebar conversations={conversations} selectedId={selectedId} />
    {children}
  </main>
);
```

Remove the obsolete `session` prop from `InboxShell`. In every moved page remove imports and JSX wrappers for `AuthenticatedShell`. Keep page-level `getServerSession()` only where the page needs membership role for business UI; request memoization prevents a duplicate API read.

- [ ] **Step 4: Move the five route trees into `(workspace)` and fix imports**

Preserve each route segment name so URLs stay unchanged. Relative imports gain one additional parent level; for example catalogue imports become:

```ts
import type { CatalogueProduct } from '../../../../../packages/contracts/src/catalogue';
import { authenticatedApiFetch, getServerSession } from '../../../src/auth/session';
```

Update moved specs to mock the corrected paths. Do not move `admin`, `(auth)`, `privacy`, `terms`, API routes, or the public root page.

- [ ] **Step 5: Replace the catalogue full reload link**

Import `Link` from `next/link` and replace:

```tsx
<a href="/settings?tab=data">Налаштування → Дані</a>
```

with:

```tsx
<Link href="/settings?tab=data">Налаштування → Дані</Link>
```

- [ ] **Step 6: Run route and component tests**

Run:

```powershell
pnpm --filter @autosale/web test -- src/components/inbox-shell.spec.tsx 'app/(workspace)'
pnpm --filter @autosale/web typecheck
```

Expected: PASS and no duplicate route collision.

- [ ] **Step 7: Commit Task 2**

```powershell
git add apps/web/app apps/web/src/components/inbox-shell.tsx apps/web/src/components/inbox-shell.spec.tsx
git commit -m "refactor: persist shell across workspace routes"
```

### Task 3: Accessible collapsible sidebar and active route detection

**Files:**
- Modify: `apps/web/src/components/primary-navigation.tsx`
- Test: `apps/web/src/components/primary-navigation.spec.tsx`
- Modify: `apps/web/src/components/authenticated-shell.tsx`
- Test: `apps/web/src/components/authenticated-shell.spec.tsx`
- Modify: `apps/web/app/layout.tsx`

**Interfaces:**
- Consumes: `usePathname(): string`, public membership role, `localStorage`.
- Produces: `isNavigationItemActive(pathname, href): boolean`, collapse control, root `data-sidebar-state` attribute, and existing mobile drawer behavior.

- [ ] **Step 1: Write failing navigation tests**

Mock `usePathname` and verify exact and nested matches, role filtering, and accessibility:

```tsx
it.each([
  ['/orders', 'Замовлення'],
  ['/orders/123', 'Замовлення'],
  ['/catalogue', 'Каталог'],
])('marks %s as current', (pathname, label) => {
  usePathname.mockReturnValue(pathname);
  render(<PrimaryNavigation session={ownerSession} />);
  expect(screen.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
});
```

- [ ] **Step 2: Run navigation tests and confirm failure**

Run: `pnpm --filter @autosale/web test -- src/components/primary-navigation.spec.tsx`

Expected: FAIL because active state currently comes from the `active` prop and links have no `aria-current`.

- [ ] **Step 3: Implement route configuration and icons**

Represent items as one typed array:

```tsx
const navigationItems = [
  { href: '/conversations', label: 'Діалоги', icon: ConversationIcon },
  { href: '/orders', label: 'Замовлення', icon: OrdersIcon },
  { href: '/catalogue', label: 'Каталог', icon: CatalogueIcon, requiresMembership: true },
  { href: '/team', label: 'Команда', icon: TeamIcon, ownerOnly: true },
  { href: '/settings', label: 'Налаштування', icon: SettingsIcon, requiresMembership: true },
] as const;

export function isNavigationItemActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
```

Each link renders an `aria-hidden` SVG, visible label, tooltip label, and `aria-current={active ? 'page' : undefined}`.

- [ ] **Step 4: Write failing shell preference tests**

Test default expanded state, saved collapsed state, toggle persistence, invalid stored value fallback, and mobile Escape behavior.

```tsx
it('persists desktop sidebar collapse preference', () => {
  render(<AuthenticatedShell session={ownerSession}><h1>Замовлення</h1></AuthenticatedShell>);
  fireEvent.click(screen.getByRole('button', { name: 'Згорнути меню' }));
  expect(document.documentElement).toHaveAttribute('data-sidebar-state', 'collapsed');
  expect(localStorage.getItem('autosale.sidebar')).toBe('collapsed');
});
```

- [ ] **Step 5: Implement sidebar state in AuthenticatedShell**

Read the already initialized HTML data attribute on mount. The desktop toggle updates React state, `document.documentElement.dataset.sidebarState`, and `localStorage`. Remove the `active` prop and close the mobile drawer when `pathname` changes.

```ts
const SIDEBAR_KEY = 'autosale.sidebar';

function setSidebarPreference(collapsed: boolean) {
  const value = collapsed ? 'collapsed' : 'expanded';
  document.documentElement.dataset.sidebarState = value;
  try { localStorage.setItem(SIDEBAR_KEY, value); } catch {}
}
```

- [ ] **Step 6: Restore preference before first paint**

Add a static inline script in the root layout `<head>` that accepts only `collapsed` or `expanded` and falls back safely:

```tsx
<script dangerouslySetInnerHTML={{ __html: `try{const v=localStorage.getItem('autosale.sidebar');document.documentElement.dataset.sidebarState=v==='collapsed'?'collapsed':'expanded'}catch{document.documentElement.dataset.sidebarState='expanded'}` }} />
```

- [ ] **Step 7: Run focused tests and typecheck**

Run:

```powershell
pnpm --filter @autosale/web test -- src/components/primary-navigation.spec.tsx src/components/authenticated-shell.spec.tsx
pnpm --filter @autosale/web typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```powershell
git add apps/web/app/layout.tsx apps/web/src/components/primary-navigation.tsx apps/web/src/components/primary-navigation.spec.tsx apps/web/src/components/authenticated-shell.tsx apps/web/src/components/authenticated-shell.spec.tsx
git commit -m "feat: add collapsible accessible workspace navigation"
```

### Task 4: Route content transition and persistent loading boundaries

**Files:**
- Create: `apps/web/app/(workspace)/template.tsx`
- Test: `apps/web/app/(workspace)/template.spec.tsx`
- Create: `apps/web/app/(workspace)/error.tsx`
- Test: `apps/web/app/(workspace)/error.spec.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: moved `apps/web/app/(workspace)/**/loading.tsx` only where wrappers conflict with the new content boundary.

**Interfaces:**
- Consumes: Next.js template remount semantics and existing `RouteSkeleton` variants.
- Produces: `.workspace-route-transition` wrapper around route content.

- [ ] **Step 1: Write the failing template test**

```tsx
it('wraps only route content in the transition boundary', () => {
  render(<WorkspaceTemplate><h1>Каталог</h1></WorkspaceTemplate>);
  expect(screen.getByText('Каталог').parentElement).toHaveClass('workspace-route-transition');
});
```

- [ ] **Step 2: Run the template test and confirm failure**

Run: `pnpm --filter @autosale/web test -- 'app/(workspace)/template.spec.tsx'`

Expected: FAIL because the template does not exist.

- [ ] **Step 3: Implement the route template**

```tsx
export default function WorkspaceTemplate({ children }: { children: ReactNode }) {
  return <div className="workspace-route-transition">{children}</div>;
}
```

- [ ] **Step 4: Add scoped transition CSS**

Use a 170 ms entry animation and ensure existing route layouts retain height and grid behavior through the wrapper:

```css
.workspace-route-transition { min-width: 0; min-height: calc(100vh - 56px); animation: workspace-enter 170ms ease-out both; }
@keyframes workspace-enter { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.workspace-route-transition > .app-shell-content { min-height: calc(100vh - 56px); }
@media (prefers-reduced-motion: reduce) { .workspace-route-transition { animation: none; } }
```

Update selectors that currently require `.authenticated-workspace > .app-shell-content` so they account for `.workspace-route-transition > .app-shell-content`.

- [ ] **Step 5: Add a local workspace error boundary**

Create a client error component that keeps the user inside the shared layout and exposes a retry action:

```tsx
'use client';

export default function WorkspaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="route-state" role="alert"><h1>Не вдалося завантажити розділ</h1><p>Спробуйте повторити запит.</p><button className="primary-button" type="button" onClick={reset}>Повторити</button></main>;
}
```

Test that the error copy is visible and clicking `Повторити` calls `reset` once.

- [ ] **Step 6: Verify loading files stay inside the shared shell**

Each moved route keeps its existing `loading.tsx` and `RouteSkeleton` variant. Confirm loading components contain no `AuthenticatedShell`, sidebar, or header markup.

- [ ] **Step 7: Run tests and production build**

Run:

```powershell
pnpm --filter @autosale/web test -- 'app/(workspace)/template.spec.tsx' 'app/(workspace)/error.spec.tsx' src/components/route-skeleton.spec.tsx
pnpm --filter @autosale/web build
```

Expected: PASS and a successful Next.js production build.

- [ ] **Step 8: Commit Task 4**

```powershell
git add 'apps/web/app/(workspace)/template.tsx' 'apps/web/app/(workspace)/template.spec.tsx' 'apps/web/app/(workspace)/error.tsx' 'apps/web/app/(workspace)/error.spec.tsx' apps/web/app/globals.css 'apps/web/app/(workspace)'
git commit -m "feat: animate workspace route content"
```

### Task 5: Responsive sidebar styling and reduced motion

**Files:**
- Modify: `apps/web/app/globals.css`
- Test: `apps/web/src/components/authenticated-shell.spec.tsx`

**Interfaces:**
- Consumes: `html[data-sidebar-state]`, `.sidebar-toggle`, `.nav-icon`, `.nav-label`, `.nav-tooltip`, existing mobile classes.
- Produces: stable desktop widths, sliding mobile drawer, keyboard-visible tooltips, and motion opt-out.

- [ ] **Step 1: Add structural assertions to the shell test**

Assert the desktop navigation has a collapse button, mobile navigation has no desktop collapse button, and tooltips remain present in the DOM for keyboard users.

```tsx
expect(screen.getByRole('button', { name: 'Згорнути меню' })).toHaveAttribute('aria-expanded', 'true');
expect(screen.getAllByText('Замовлення').length).toBeGreaterThan(0);
```

- [ ] **Step 2: Implement desktop width and content resizing**

```css
.authenticated-shell { --sidebar-width: 240px; grid-template-columns: var(--sidebar-width) minmax(0, 1fr); transition: grid-template-columns 180ms ease; }
html[data-sidebar-state="collapsed"] .authenticated-shell { --sidebar-width: 72px; }
.primary-nav { width: var(--sidebar-width); overflow: hidden; transition: width 180ms ease; }
html[data-sidebar-state="collapsed"] .primary-nav .nav-label,
html[data-sidebar-state="collapsed"] .primary-nav .brand-label { opacity: 0; pointer-events: none; }
```

Keep button and navigation rows at fixed heights so they do not jump during animation.

- [ ] **Step 3: Implement accessible collapsed tooltips**

Show `.nav-tooltip` only for the collapsed desktop sidebar on both `:hover` and `:focus-visible`. Tooltips use fixed positioning or a non-clipped layer so `overflow: hidden` does not cut them off.

- [ ] **Step 4: Preserve and improve mobile drawer**

Below 720 px, hide the desktop sidebar regardless of stored preference. Animate `.mobile-nav-drawer` from `translateX(-100%)` to `translateX(0)` and fade the backdrop; retain modal focus handling and background `inert` behavior.

- [ ] **Step 5: Add reduced-motion overrides**

```css
@media (prefers-reduced-motion: reduce) {
  .authenticated-shell,
  .primary-nav,
  .nav-label,
  .mobile-nav-backdrop,
  .mobile-nav-drawer,
  .workspace-route-transition { transition: none !important; animation: none !important; }
}
```

- [ ] **Step 6: Run component tests and build**

Run:

```powershell
pnpm --filter @autosale/web test -- src/components/authenticated-shell.spec.tsx src/components/primary-navigation.spec.tsx
pnpm --filter @autosale/web typecheck
pnpm --filter @autosale/web build
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```powershell
git add apps/web/app/globals.css apps/web/src/components/authenticated-shell.spec.tsx
git commit -m "style: add responsive sliding workspace navigation"
```

### Task 6: Full regression and browser acceptance

**Files:**
- Update: `todo.md` with the completed shell/navigation task and verification evidence.

**Interfaces:**
- Consumes: completed workspace shell.
- Produces: verified desktop, mobile, history, loading, and OAuth-safe behavior.

- [ ] **Step 1: Run the complete automated suite**

Run:

```powershell
pnpm test
pnpm typecheck
pnpm --filter @autosale/web build
git diff --check
```

Expected: all commands PASS with no whitespace errors.

- [ ] **Step 2: Rebuild and start the Docker stack**

Run from the active worktree using the root environment file:

```powershell
docker compose --env-file 'C:\Users\User\Documents\ChatGPT\AutoSales\.env' -p autosale up -d --build
docker compose --env-file 'C:\Users\User\Documents\ChatGPT\AutoSales\.env' -p autosale ps
```

Expected: web, API, worker, PostgreSQL and Redis containers are healthy/running.

- [ ] **Step 3: Verify desktop navigation in Chrome**

At `https://sales-aito.com`, sign in and navigate through Діалоги → Замовлення → Каталог → Налаштування. Confirm:

- URL changes while the document navigation entry is not recreated;
- header and sidebar remain visually stationary;
- content uses the 170 ms transition;
- active item and `aria-current` follow nested routes;
- browser Back/Forward restores the correct page;
- collapsed sidebar stays collapsed across route changes and page refresh.

- [ ] **Step 4: Verify mobile and accessibility behavior**

At a viewport at or below 720 px confirm drawer open/close, backdrop click, Escape, focus return, link selection close, and no horizontal overflow. Emulate reduced motion and confirm sidebar/content animations are disabled.

- [ ] **Step 5: Verify OAuth boundaries**

From Settings start (but do not unnecessarily complete) Google and Meta connection flows. Confirm they still use full external navigation and their callback URLs remain unchanged.

- [ ] **Step 6: Record completion and commit verification metadata**

Mark the task complete in `todo.md` with the exact test/build commands run.

```powershell
git add todo.md
git commit -m "docs: record persistent navigation completion"
git status --short
```

Expected: clean worktree.
