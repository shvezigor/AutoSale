# Global Notifications UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Додати в AutoSale послідовні loading-стани, toast-повідомлення, постійний центр нотифікацій і доступне меню профілю на всіх авторизованих сторінках.

**Architecture:** Сервер зберігає важливі персональні нотифікації в PostgreSQL і віддає їх через tenant/user-scoped NestJS API. Клієнтський `AuthenticatedShell` надає спільний header, `ToastProvider` та `ActivityProvider`; локальні мутації використовують ці контексти, а центр нотифікацій оновлюється після фокусу вкладки й раз на 60 секунд.

**Tech Stack:** TypeScript 5.9, Next.js 16 App Router, React 19, NestJS 11, Prisma 7/PostgreSQL, Vitest, Testing Library, Playwright, CSS design tokens.

**Spec:** `docs/superpowers/specs/2026-09-04-global-notifications-ui-design.md`

## Global Constraints

- Не додавати UI-бібліотеку або глобальний state store; використовувати React context і наявні CSS tokens.
- Toast stack розташовується зверху зліва у робочій області; error toast не закривається автоматично.
- Постійні нотифікації належать конкретному `tenantId + userId`; platform admin не бачить клієнтські записи.
- `actionUrl` допускає лише внутрішні шляхи `/conversations`, `/orders`, `/catalogue`, `/team`, `/settings` та їх query/path suffixes.
- Перша версія не використовує WebSocket/SSE: refetch після фокусу вкладки та кожні 60 секунд лише в активній вкладці.
- Усі popover-компоненти підтримують `Escape`, клік поза областю, повернення фокуса та клавіатурну навігацію.
- Перевірити 320, 768, 1024 і 1440 px, `prefers-reduced-motion`, WCAG 2.1 AA.

---

## File Map

**Database/API**

- `packages/database/prisma/schema.prisma` — enum і модель персональної нотифікації.
- `packages/database/prisma/migrations/20260904150000_user_notifications/migration.sql` — таблиця, зовнішні ключі та індекси.
- `apps/api/src/notifications/notifications.service.ts` — створення, список, read і read-all з tenant/user isolation.
- `apps/api/src/notifications/notifications.controller.ts` — HTTP endpoints поточного principal.
- `apps/api/src/notifications/notifications.module.ts` — NestJS wiring і exported service.
- `apps/api/src/notifications/*.spec.ts` — unit/controller coverage.
- `apps/api/src/app.module.ts` — реєстрація модуля.

**Web foundation**

- `apps/web/src/components/toast-provider.tsx` — toast context, timers і accessible live region.
- `apps/web/src/components/activity-provider.tsx` — reference-counted global activity state.
- `apps/web/src/components/loading-button.tsx` — стандартизована кнопка з локальним progress.
- `apps/web/src/components/app-header.tsx` — bell, notification popover і profile menu.
- `apps/web/src/components/authenticated-shell.tsx` — providers, navigation, header і content composition.
- `apps/web/src/api/notifications.ts` — browser fetch contracts.
- `apps/web/src/components/*.spec.tsx` — component tests.
- `apps/web/app/globals.css` — header, popover, toast, progress, skeleton і responsive rules.

**Page adoption/integrations**

- `apps/web/src/components/primary-navigation.tsx` — лише navigation; прибрати profile/logout.
- `apps/web/app/{settings,catalogue,orders,team}/page.tsx`, `apps/web/app/orders/[id]/page.tsx`, `apps/web/src/components/inbox-shell.tsx` — перейти на `AuthenticatedShell`.
- `apps/web/src/components/google-sheets-settings-form.tsx` — activity + toast + loading copy.
- `apps/web/src/components/catalogue-source-settings.tsx` — activity + toast для Google/import flows.
- `apps/web/src/components/order-settings-form.tsx`, `instagram-settings-form.tsx`, `google-connection-settings.tsx` — однаковий mutation feedback.
- `apps/web/app/*/loading.tsx` і новий `apps/web/src/components/route-skeleton.tsx` — skeleton states.

---

### Task 1: Persisted Notification Model

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260904150000_user_notifications/migration.sql`
- Test: `packages/database/src/notifications.postgres.spec.ts`
- Modify generated Prisma client via: `pnpm --filter @autosale/database generate`

**Interfaces:**
- Produces: Prisma delegate `prisma.userNotification` with `NotificationType = SUCCESS | ERROR | WARNING | INFO`.
- Consumes: existing `Tenant` and `User` UUID primary keys.

- [ ] **Step 1: Write the failing persistence test**

Create an integration test using the repository’s existing PostgreSQL testcontainer pattern. Assert that two users in one tenant can own separate notifications, `readAt` is nullable, and deleting a user or tenant cascades its rows.

```ts
const created = await prisma.userNotification.create({
  data: {
    tenantId,
    userId,
    type: 'SUCCESS',
    category: 'CATALOGUE_IMPORT_COMPLETED',
    title: 'Каталог оновлено',
    actionUrl: '/catalogue',
  },
});
expect(created).toMatchObject({ tenantId, userId, readAt: null });
```

- [ ] **Step 2: Run the test and verify the model is absent**

Run: `pnpm --filter @autosale/database test -- notifications.postgres.spec.ts`  
Expected: FAIL because `userNotification` is not generated.

- [ ] **Step 3: Add schema and SQL migration**

Add relations `notifications UserNotification[]` to both `Tenant` and `User`, then add:

```prisma
enum NotificationType {
  SUCCESS
  ERROR
  WARNING
  INFO
}

model UserNotification {
  id        String           @id @default(uuid()) @db.Uuid
  tenantId  String           @map("tenant_id") @db.Uuid
  userId    String           @map("user_id") @db.Uuid
  type      NotificationType
  category  String
  title     String
  message   String?
  actionUrl String?          @map("action_url")
  readAt    DateTime?        @map("read_at")
  createdAt DateTime         @default(now()) @map("created_at")
  tenant    Tenant           @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user      User             @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([tenantId, userId, createdAt(sort: Desc)])
  @@index([tenantId, userId, readAt])
  @@map("user_notifications")
}
```

The SQL creates the enum, table, two foreign keys with `ON DELETE CASCADE`, and the two matching indexes.

- [ ] **Step 4: Generate client and run database tests**

Run: `pnpm --filter @autosale/database generate && pnpm --filter @autosale/database test`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/database
git commit -m "feat(database): add user notifications"
```

### Task 2: Tenant-Isolated Notifications API

**Files:**
- Create: `apps/api/src/notifications/notifications.service.ts`
- Create: `apps/api/src/notifications/notifications.service.spec.ts`
- Create: `apps/api/src/notifications/notifications.controller.ts`
- Create: `apps/api/src/notifications/notifications.controller.spec.ts`
- Create: `apps/api/src/notifications/notifications.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces: `NotificationService.create(input): Promise<void>`, `list(tenantId, userId, limit)`, `markRead(tenantId, userId, id)`, `markAllRead(tenantId, userId)`.
- Produces API: `GET /api/notifications?limit=20`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`.
- Consumes: `CurrentPrincipal()` with non-null tenant membership and global CSRF guard for POST.

- [ ] **Step 1: Write failing service tests**

Cover limit clamping `1..50`, descending order, unread count across the full user scope, tenant/user filters on both mutations, and safe URL validation.

```ts
await service.markRead('tenant-a', 'user-a', 'notification-id');
expect(prisma.userNotification.updateMany).toHaveBeenCalledWith({
  where: { id: 'notification-id', tenantId: 'tenant-a', userId: 'user-a', readAt: null },
  data: { readAt: expect.any(Date) },
});
```

Assert `create()` rejects `https://evil.example`, `//evil.example`, and `/admin`, while accepting `/orders/uuid` and `/settings?tab=data`.

- [ ] **Step 2: Verify service tests fail**

Run: `pnpm --filter @autosale/api test -- notifications.service.spec.ts`  
Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement service and contracts**

Use this public type:

```ts
export type CreateNotificationInput = {
  tenantId: string;
  userId: string;
  type: 'SUCCESS' | 'ERROR' | 'WARNING' | 'INFO';
  category: string;
  title: string;
  message?: string;
  actionUrl?: string;
};
```

`create()` validates the internal URL before writing. `list()` returns `{ items, unreadCount }`; it never accepts tenant/user values from HTTP input.

- [ ] **Step 4: Run service tests**

Run: `pnpm --filter @autosale/api test -- notifications.service.spec.ts`  
Expected: PASS.

- [ ] **Step 5: Write failing controller tests**

Use the existing `AuthGuard`/Supertest pattern. Verify GET passes principal scope, POST routes do the same, invalid UUID returns 400, and an unauthenticated request returns 401.

- [ ] **Step 6: Implement controller/module and register it**

```ts
@Controller('api/notifications')
@RequireMembership('MANAGER')
export class NotificationsController {
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query('limit') limit?: string) {
    const parsed = Number.parseInt(limit ?? '20', 10);
    return this.notifications.list(principal.tenantId!, principal.userId, Number.isFinite(parsed) ? parsed : 20);
  }

  @Post('read-all')
  markAllRead(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.notifications.markAllRead(principal.tenantId!, principal.userId);
  }

  @Post(':id/read')
  markRead(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.notifications.markRead(principal.tenantId!, principal.userId, id);
  }
}
```

Export `NotificationService` from the dynamic module so later business modules can inject it.

- [ ] **Step 7: Run API tests and typecheck**

Run: `pnpm --filter @autosale/api test && pnpm --filter @autosale/api typecheck`  
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/notifications apps/api/src/app.module.ts
git commit -m "feat(api): add notification center endpoints"
```

### Task 3: Toast and Activity Foundations

**Files:**
- Create: `apps/web/src/components/toast-provider.tsx`
- Create: `apps/web/src/components/toast-provider.spec.tsx`
- Create: `apps/web/src/components/activity-provider.tsx`
- Create: `apps/web/src/components/activity-provider.spec.tsx`
- Create: `apps/web/src/components/loading-button.tsx`
- Create: `apps/web/src/components/loading-button.spec.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Produces: `useToast().show({ type, title, message? }): string`, `dismiss(id)`.
- Produces: `useActivity().run<T>(label, operation): Promise<T>` and `activeCount`.
- Produces: `<LoadingButton pending pendingLabel="Перевіряємо…">Перевірити</LoadingButton>`.

- [ ] **Step 1: Write failing toast tests**

Use fake timers. Test stacked rendering, 5-second success timeout, 8-second warning timeout, persistent error, pause on mouse/focus, close button, and accessible roles.

```tsx
render(<ToastProvider><ToastHarness /></ToastProvider>);
fireEvent.click(screen.getByRole('button', { name: 'Success' }));
expect(screen.getByRole('status')).toHaveTextContent('Готово');
vi.advanceTimersByTime(5_000);
expect(screen.queryByText('Готово')).not.toBeInTheDocument();
```

- [ ] **Step 2: Verify toast tests fail**

Run: `pnpm --filter @autosale/web test -- toast-provider.spec.tsx`  
Expected: FAIL because provider is absent.

- [ ] **Step 3: Implement toast provider**

Keep IDs in a ref-backed counter, cap visible toasts at four, clean timers on unmount, and render `.toast-viewport` after children. Error uses `role="alert"`; other types use `role="status"` in a polite live region.

- [ ] **Step 4: Write failing activity/loading tests**

Run two deferred promises and verify `activeCount` stays non-zero until both settle, including rejection. Verify `LoadingButton` has `aria-busy`, is disabled, displays pending copy, and keeps its width stable.

- [ ] **Step 5: Implement activity provider and loading button**

```ts
async function run<T>(label: string, operation: () => Promise<T>): Promise<T> {
  setActivities((value) => value + 1);
  try { return await operation(); }
  finally { setActivities((value) => Math.max(0, value - 1)); }
}
```

Render a global `.activity-bar` only when `activeCount > 0`; include screen-reader text with the current operation label.

- [ ] **Step 6: Add semantic CSS and reduced-motion rules**

Use existing `--accent`, `--surface`, `--border`, `--ink`, and `--muted`; add semantic success/warning/error tokens. Position desktop toast viewport at `top: 72px; left: 176px`; mobile uses `inset: 70px 12px auto`.

- [ ] **Step 7: Run component tests and typecheck**

Run: `pnpm --filter @autosale/web test -- toast-provider.spec.tsx activity-provider.spec.tsx loading-button.spec.tsx && pnpm --filter @autosale/web typecheck`  
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components apps/web/app/globals.css
git commit -m "feat(web): add toast and activity feedback"
```

### Task 4: Header, Notification Center, and Profile Menu

**Files:**
- Create: `apps/web/src/api/notifications.ts`
- Create: `apps/web/src/components/app-header.tsx`
- Create: `apps/web/src/components/app-header.spec.tsx`
- Create: `apps/web/src/components/authenticated-shell.tsx`
- Create: `apps/web/src/components/authenticated-shell.spec.tsx`
- Modify: `apps/web/src/components/primary-navigation.tsx`
- Modify: `apps/web/src/components/primary-navigation.spec.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes API response `{ items: NotificationItem[]; unreadCount: number }`.
- Produces: `<AuthenticatedShell active session>{children}</AuthenticatedShell>`.
- Produces internal `NotificationCenter` and `ProfileMenu` controlled by `AppHeader`.

- [ ] **Step 1: Add typed browser API functions**

```ts
export type NotificationItem = {
  id: string;
  type: 'SUCCESS' | 'ERROR' | 'WARNING' | 'INFO';
  category: string;
  title: string;
  message: string | null;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
};
export function getNotifications(): Promise<NotificationList>;
export function markNotificationRead(id: string): Promise<void>;
export function markAllNotificationsRead(): Promise<void>;
```

GET uses ordinary `fetch`; mutations use `mutatingFetch`.

- [ ] **Step 2: Write failing header tests**

Verify unread badge label, empty/loading/error/retry states, `read-all`, action link, owner-only Team item, manager omission, Escape/outside-click close, and focus return to the trigger.

- [ ] **Step 3: Implement AppHeader without external UI libraries**

Use buttons with `aria-expanded`, `aria-controls`, `aria-haspopup="menu"`. Fetch immediately, on `visibilitychange` to visible, and every 60 seconds only while `document.visibilityState === 'visible'`. Abort on unmount.

- [ ] **Step 4: Write failing shell/navigation tests**

Assert providers wrap content, the progress bar responds to activity context, navigation no longer renders duplicated profile/logout, and profile logout still calls `/api/auth/logout` then refreshes.

- [ ] **Step 5: Implement AuthenticatedShell and simplify navigation**

```tsx
export function AuthenticatedShell({ active, session, children }: Props) {
  return <ToastProvider><ActivityProvider>
    <div className="authenticated-shell">
      <PrimaryNavigation active={active} session={session} />
      <div className="authenticated-workspace">
        <AppHeader session={session} />
        {children}
      </div>
    </div>
  </ActivityProvider></ToastProvider>;
}
```

- [ ] **Step 6: Add header/popover/profile responsive CSS**

Use a 56px header, subtle bottom border, 40px minimum icon targets, 360px notification popover max width, and no heavy shadows. At 320px, clamp the panel to `calc(100vw - 24px)`.

- [ ] **Step 7: Run tests and typecheck**

Run: `pnpm --filter @autosale/web test -- app-header.spec.tsx authenticated-shell.spec.tsx primary-navigation.spec.tsx && pnpm --filter @autosale/web typecheck`  
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/api/notifications.ts apps/web/src/components apps/web/app/globals.css
git commit -m "feat(web): add app header and notification center"
```

### Task 5: Adopt the Authenticated Shell and Skeletons

**Files:**
- Modify: `apps/web/app/settings/page.tsx`
- Modify: `apps/web/app/catalogue/page.tsx`
- Modify: `apps/web/app/orders/page.tsx`
- Modify: `apps/web/app/orders/[id]/page.tsx`
- Modify: `apps/web/app/team/page.tsx`
- Modify: `apps/web/src/components/inbox-shell.tsx`
- Create: `apps/web/src/components/route-skeleton.tsx`
- Create: `apps/web/src/components/route-skeleton.spec.tsx`
- Modify/Create: `apps/web/app/{settings,orders,team}/loading.tsx`
- Modify: `apps/web/app/catalogue/loading.tsx`
- Modify: `apps/web/app/conversations/loading.tsx`
- Modify page/component specs for each converted layout.

**Interfaces:**
- Consumes: `AuthenticatedShell` from Task 4.
- Produces: consistent DOM structure `.authenticated-shell > nav + .authenticated-workspace > header + content`.
- Produces: `<RouteSkeleton variant="table|settings|conversation|detail" />`.

- [ ] **Step 1: Write failing shell adoption tests**

For each page/component spec, assert the bell and profile trigger appear exactly once and the main page heading remains correctly nested. Add a route skeleton test for `aria-busy="true"` and no interactive controls.

- [ ] **Step 2: Verify tests fail**

Run: `pnpm --filter @autosale/web test -- page.spec.tsx inbox-shell.spec.tsx route-skeleton.spec.tsx`  
Expected: FAIL because pages still render `PrimaryNavigation` directly.

- [ ] **Step 3: Convert layouts incrementally**

Replace each direct navigation use with `AuthenticatedShell`, preserving existing layout-specific classes on a child `<main>` or `<section>`. Do not change data-fetching behavior.

- [ ] **Step 4: Implement shared route skeletons**

Skeletons mirror the page hierarchy with three to eight restrained blocks, include an `.sr-only` loading label, and do not use spinner-only full-screen states.

- [ ] **Step 5: Run all web tests and build**

Run: `pnpm --filter @autosale/web test && pnpm --filter @autosale/web typecheck && pnpm --filter @autosale/web build`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app apps/web/src/components/inbox-shell.tsx apps/web/src/components/route-skeleton*
git commit -m "refactor(web): adopt authenticated application shell"
```

### Task 6: Integrate Loading and Toast Feedback into Mutations

**Files:**
- Modify/Test: `apps/web/src/components/google-sheets-settings-form.tsx`
- Modify/Test: `apps/web/src/components/catalogue-source-settings.tsx`
- Modify/Test: `apps/web/src/components/order-settings-form.tsx`
- Modify/Test: `apps/web/src/components/instagram-settings-form.tsx`
- Modify/Test: `apps/web/src/components/google-connection-settings.tsx`
- Modify/Test: `apps/web/src/components/product-editor.tsx`
- Modify/Test: `apps/web/src/components/team-management.tsx`

**Interfaces:**
- Consumes: `useActivity()`, `useToast()`, and `LoadingButton`.
- Produces: consistent pending copy and success/error feedback while retaining field-level errors.

- [ ] **Step 1: Write failing Google Sheets feedback tests**

Assert «Перевіряємо…» appears during the pending promise, the global activity bar is visible, success produces «Шаблон AutoSale створено», error produces a persistent toast and retains the inline message.

- [ ] **Step 2: Implement Google Sheets feedback**

Wrap each network sequence once with `activity.run()`, use `LoadingButton`, and call `toast.show()` after the final state is known. Avoid nested activity counters between `saveDestination()` and `validateDestination()` by extracting a private untracked request helper.

- [ ] **Step 3: Run Google Sheets tests**

Run: `pnpm --filter @autosale/web test -- google-sheets-settings-form.spec.tsx`  
Expected: PASS.

- [ ] **Step 4: Write failing tests for remaining mutation components**

For each component, cover one success, one API error, disabled duplicate submission, and correct Ukrainian pending verb: «Завантажуємо…», «Зберігаємо…», «Підключаємо…», «Відключаємо…», «Надсилаємо…».

- [ ] **Step 5: Implement shared mutation pattern**

Keep inline validation errors beside fields. Use toast only for operation outcome. Do not persist ordinary form-save notifications.

- [ ] **Step 6: Run targeted and full web tests**

Run: `pnpm --filter @autosale/web test && pnpm --filter @autosale/web typecheck`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components
git commit -m "feat(web): surface background operation feedback"
```

### Task 7: Create Persistent Notifications from Business Outcomes

**Files:**
- Modify/Test: `apps/api/src/catalogue-import/catalogue-import.service.ts`
- Modify/Test: `apps/api/src/catalogue-sources/catalogue-sources.service.ts`
- Modify/Test: `apps/api/src/settings/google-sheets-settings.service.ts`
- Modify/Test: `apps/api/src/integrations/google-oauth.service.ts`
- Modify/Test: `apps/api/src/integrations/instagram-oauth.service.ts`
- Modify: respective modules to inject `NotificationService`.
- Create/Test: `apps/worker/src/notifications/worker-notification.service.ts`
- Modify/Test: `apps/worker/src/google-sheets/google-sheets-sync.processor.ts`
- Modify: `apps/worker/src/main.ts`

**Interfaces:**
- Consumes: `NotificationService.create()` from Task 2.
- Produces categories: `CATALOGUE_IMPORT_COMPLETED`, `CATALOGUE_IMPORT_FAILED`, `CATALOGUE_SYNC_COMPLETED`, `CATALOGUE_SYNC_FAILED`, `ORDER_SHEET_TEMPLATE_CREATED`, `ORDER_EXPORT_FAILED`, `GOOGLE_REAUTHORIZATION_REQUIRED`, `INSTAGRAM_REAUTHORIZATION_REQUIRED`.

- [ ] **Step 1: Write failing outcome tests**

For each API service, mock `NotificationService`. For the worker, mock `WorkerNotificationService`, which writes the same `UserNotification` model through Prisma. Verify exact recipient user, type, category, safe title/message, and internal action URL. For operations without a known initiating user, do not create a guessed notification.

```ts
expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({
  tenantId,
  userId,
  type: 'SUCCESS',
  category: 'ORDER_SHEET_TEMPLATE_CREATED',
  actionUrl: '/settings?tab=data',
}));
```

- [ ] **Step 2: Add best-effort notification helper**

Within each business service, isolate notification delivery:

```ts
private async notify(input: CreateNotificationInput): Promise<void> {
  try { await this.notifications?.create(input); }
  catch { this.logger.warn('notification_create_failed', { category: input.category }); }
}
```

Never include tokens, raw third-party payloads, full customer data, or stack traces.

- [ ] **Step 3: Wire initiating user IDs through existing flows**

Reuse `requestedByUserId`, `connectedByUserId`, and controller principal IDs already present. Extend only method signatures that currently discard an available user ID; update their tests and callers in the same step.

For Google Sheets export failure, load `order.approvedBy` together with the export. Create `ORDER_EXPORT_FAILED` only when `approvedBy` is a UUID belonging to an active membership in the same tenant; otherwise log the failure without a user notification. Use `/orders/{orderId}` as `actionUrl`.

- [ ] **Step 4: Run targeted API tests**

Run: `pnpm --filter @autosale/api test -- catalogue-import.service.spec.ts catalogue-sources.service.spec.ts google-sheets-settings.service.spec.ts google-oauth.service.spec.ts instagram-oauth.service.spec.ts`  
Expected: PASS.

Run: `pnpm --filter @autosale/worker test -- google-sheets-sync.processor.spec.ts worker-notification.service.spec.ts`  
Expected: PASS.

- [ ] **Step 5: Run full API tests and typecheck**

Run: `pnpm --filter @autosale/api test && pnpm --filter @autosale/api typecheck && pnpm --filter @autosale/worker test && pnpm --filter @autosale/worker typecheck`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src apps/worker/src
git commit -m "feat(api): notify users about integration outcomes"
```

### Task 8: Retention, Accessibility, Browser Verification, and Release

**Files:**
- Create: `apps/worker/src/notifications/notification-retention.reconciler.ts`
- Create: `apps/worker/src/notifications/notification-retention.reconciler.spec.ts`
- Modify: `apps/worker/src/main.ts`
- Create/Modify: `tests/notifications-ui.spec.ts`
- Modify: `todo.md` if the repository tracks completed feature work there.

**Interfaces:**
- Consumes: notifications older than 90 days.
- Produces: bounded `NotificationRetentionReconciler.reconcile(now = new Date()): Promise<number>` invoked on worker startup and by a 24-hour `setInterval`, matching the existing catalogue/profile reconciliation pattern.

- [ ] **Step 1: Write failing retention test**

Assert the delete condition is `createdAt < now - 90 days` and that newer rows remain. Assert deletion is bounded to exactly 1,000 IDs per pass to avoid long locks.

- [ ] **Step 2: Implement retention cleanup**

Select up to 1,000 expired IDs, then `deleteMany({ where: { id: { in: ids } } })`. In `main.ts`, call `reconcile()` once after bootstrap, schedule `setInterval(..., 24 * 60 * 60_000)`, log only counts, and clear the timer in the existing shutdown handler.

- [ ] **Step 3: Write Playwright user journeys**

Cover:

1. settings validation shows pending state then toast;
2. bell opens, marks a notification read, updates badge;
3. read-all clears badge after reload;
4. profile menu navigates to settings and logs out;
5. keyboard `Tab`, `Enter`, `Escape` and focus return;
6. screenshots/visibility at 320, 768, 1024 and 1440 px;
7. no console errors.

- [ ] **Step 4: Run focused browser tests**

Run: `pnpm test:e2e -- tests/notifications-ui.spec.ts`  
Expected: PASS.

- [ ] **Step 5: Run complete verification**

Run: `pnpm test && pnpm typecheck && pnpm build`  
Expected: all workspaces PASS.

- [ ] **Step 6: Build and smoke-test Docker deployment**

Run: `docker compose up -d --build`  
Then verify `docker compose ps`, API health endpoint, login, settings, catalogue, orders, team, conversations, bell, profile menu, toast stack, and database migration status.

- [ ] **Step 7: Commit verification artifacts**

```bash
git add apps/worker/src/notifications apps/worker/src/main.ts tests todo.md
git commit -m "test: verify notifications user experience"
```

- [ ] **Step 8: Final branch review**

Run: `git diff --check master...HEAD && git log --oneline master..HEAD`  
Review for secrets, raw customer data, duplicated loaders, inaccessible clickable divs, and unrelated worktree changes. Only then merge to `master`, push `origin/master`, rebuild Docker, and verify production at `https://sales-aito.com`.
