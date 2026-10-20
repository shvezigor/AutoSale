# Privacy-Minimal Conversion Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure anonymous marketing interest and real registered-account progress without cross-site visitor identity, and expose honest aggregate reports to platform administrators.

**Architecture:** Public page/click signals increment daily aggregate PostgreSQL counters through a bounded endpoint; no anonymous event rows or cookies exist. Registration and first confirmed order are derived from canonical tenant/order rows. An authenticated **Discuss a plan** dashboard action records a short-lived tenant-plan interest and opens a contact email action; only aggregate reporting is exposed to admins. This does not implement trial enforcement or billing.

**Tech Stack:** Zod contracts, NestJS, Prisma/PostgreSQL, Next.js/React, Redis short-lived abuse counters, Vitest, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-20-demo-lead-operations-and-private-conversion-design.md`

## Global Constraints

- Event names are `pricing_view`, `plan_interest`, `registration_arrival`, `account_registered`, `first_order_confirmed`, `demo_intent`; the last three are server-derived, not browser events.
- Anonymous counters contain only day, event, locale, approved plan ID (`none` for events without a plan) and count. No IP, email, phone, URL/query, user agent, message, provider ID, cookie or anonymous session identifier is stored.
- Tenant-plan interest may hold tenant ID for at most 90 days; daily aggregate counters may live for at most 13 months. Report only aggregates, suppress cells below 3, and label page views/clicks as counts rather than unique users.
- The dashboard action does not charge, subscribe, change access or promise a callback. It offers a clear email contact path even if measurement fails.
- Public collection remains disabled by default until the updated privacy notice, event contract and legal basis are approved for the target market. No live provider side effects in tests.

---

## File map

- `packages/contracts/src/conversion-events.ts`: fixed public event schema and approved plan IDs, exported by `index.ts`.
- `packages/database/prisma/schema.prisma` plus migration: `MarketingDailyCounter` and `TenantPlanInterest` with bounded indexes/uniqueness.
- `apps/api/src/conversion/conversion.controller.ts`, `conversion.service.ts`, `conversion.module.ts`: intake and atomic count writes; reporting methods have a separate admin boundary.
- `apps/api/src/admin/admin-conversion.controller.ts`, `admin-conversion.service.ts`, `admin.module.ts`: aggregate-only date-bounded report.
- `apps/web/src/marketing/components/conversion-signal.tsx`: anonymous page/click signals with no cookie.
- `apps/web/src/components/dashboard/plan-interest-card.tsx`: authenticated plan-choice/contact action.
- `apps/web/app/(workspace)/dashboard/page.tsx`, `apps/web/app/[locale]/pricing/page.tsx`, `apps/web/app/[locale]/demo/page.tsx`, registration page, `apps/web/app/admin/conversions/page.tsx`, admin shell/copy: integration points.
- `apps/web/app/privacy/page.tsx`, `docs/operations/marketing-release.md`, feature index and acceptance checklist: disclosure, switch and evidence.

## Task 1: Fixed, minimized event intake

**Files:** Create `packages/contracts/src/conversion-events.{ts,spec.ts}`, `apps/api/src/conversion/{conversion.controller,conversion.service,conversion.module}.ts` and tests; modify database schema/migration, API app module and config parser.

**Interfaces:** `POST /api/conversion/events` accepts only `{ event: 'pricing_view' | 'registration_arrival' | 'plan_interest'; locale: 'uk' | 'en'; planId?: 'start' | 'growth' | 'scale' }`. It returns `204` and never accepts identifiers. `ConversionService.recordAnonymous` atomically upserts one day/event/locale/plan count. `MARKETING_ANALYTICS_ENABLED=false` is the default switch.

- [ ] **Step 1: Write failing schema/API tests** rejecting `email`, `ip`, `url`, arbitrary plan ID, oversized body and server-only event names. Assert no persistence when disabled and bounded `204` when enabled. Example:

```ts
expect(conversionEventSchema.safeParse({ event: 'pricing_view', locale: 'uk', email: 'x@example.test' }).success).toBe(false);
expect(conversionEventSchema.safeParse({ event: 'plan_interest', locale: 'en', planId: 'start' }).success).toBe(true);
```

- [ ] **Step 2: Run red tests.** `pnpm --filter @autosale/contracts test -- conversion-events`; `pnpm --filter @autosale/api test -- conversion`.
- [ ] **Step 3: Implement** strict Zod parsing, default-disabled config, a Redis HMAC-IP short-window quota to keep public counters from becoming a trivial write-amplification endpoint, and one atomic SQL upsert. Normalize absent `planId` to the non-null `none` sentinel so the unique key also deduplicates no-plan rows. Store only approved fields. Date is server UTC, not browser-supplied. Deny direct tenant-role reads of platform aggregate tables; expose only fixed platform-admin aggregate functions.

```sql
INSERT INTO marketing_daily_counters (day, event, locale, plan_id, count)
VALUES ($1::date, $2, $3, $4, 1)
ON CONFLICT (day, event, locale, plan_id)
DO UPDATE SET count = marketing_daily_counters.count + 1;
```

- [ ] **Step 4: Run focused tests, typecheck and build.** `pnpm --filter @autosale/contracts test -- conversion-events`; `pnpm --filter @autosale/api test -- conversion`; `pnpm typecheck`; `pnpm build`. Document exact schema and disabled-by-default state in the canonical spec.
- [ ] **Step 5: Commit** `feat: add minimized conversion counters` after staging only named files and checking for personal data/secrets.

## Task 2: Public signals, canonical account/order counts and demo intent

**Files:** Create `apps/web/src/marketing/components/conversion-signal.tsx` and tests; modify localized pricing/demo pages, registration route, homepage pricing links, `apps/api/src/demo-leads/demo-leads.service.ts`, `apps/api/src/admin/admin-conversion.service.ts`, and focused tests.

**Interfaces:** `ConversionSignal` records `pricing_view` and `registration_arrival` once per mounted page and `plan_interest` on a specific plan CTA. `account_registered` is counted from successful tenant creation; `first_order_confirmed` from the first `APPROVED`/`AUTO_APPROVED` non-demo order per tenant. `demo_intent` increments once within the transaction that creates a new lead, never on idempotent replay.

- [ ] **Step 1: Write failing tests** for one mount signal, each distinct plan click, no URL query sent, idempotent lead replay counted once, registration transaction rollback not counted, and first-order status/repeated approval not double-counted. Example:

```ts
expect(fetchMock).toHaveBeenCalledWith('/api/conversion/events', expect.objectContaining({
  body: JSON.stringify({ event: 'pricing_view', locale: 'uk' }),
}));
expect(await report.firstOrders({ from, to })).toBe(1); // two approved orders, one tenant
```

- [ ] **Step 2: Run red tests.** `pnpm --filter @autosale/web test -- conversion-signal`; `pnpm --filter @autosale/api test -- demo-leads.service admin-conversion`.
- [ ] **Step 3: Implement** the tiny client signal with `keepalive` and strict payload, no storage or third-party script. Use existing `Tenant.createdAt` for registered counts and compute `MIN(Order.approvedAt)` across **all** approved orders per tenant before filtering that first timestamp into the requested date range. Exclude the existing built-in demo scenario by its `Conversation.externalConversationId` prefix `demo-client-`, which comes from `DemoScenarioService`; add a regression proving a later real order is still counted. Persist demo-intent daily count in the lead-create transaction, so a duplicate idempotency key is not a new intent. Keep failures best-effort without affecting lead, registration or order acceptance. Use a fixed, aggregate-only platform database function as the admin read boundary.

```sql
SELECT COUNT(*) FROM (
  SELECT o.tenant_id, MIN(o.approved_at) AS first_approved_at
  FROM orders o JOIN conversations c ON c.id = o.conversation_id AND c.tenant_id = o.tenant_id
  WHERE o.status IN ('APPROVED', 'AUTO_APPROVED')
    AND c.external_conversation_id NOT LIKE 'demo-client-%'
  GROUP BY o.tenant_id
) firsts WHERE first_approved_at >= $1 AND first_approved_at < $2;
```

- [ ] **Step 4: Run focused tests plus `pnpm typecheck` and `pnpm build`;** inspect generated requests in a browser network panel to prove payload minimization. Commit `feat: measure public interest and first order` with updated canonical docs.

## Task 3: Authenticated plan interest and honest admin report

**Files:** Create `apps/web/src/components/dashboard/plan-interest-card.tsx` and test, `apps/api/src/admin/admin-conversion.{controller,service}.ts` and tests, `apps/web/app/admin/conversions/page.tsx` and report component/tests; modify dashboard page, admin shell/copy and authenticated conversion route/service.

**Interfaces:** `POST /api/conversion/plan-interest` accepts `{ planId: 'start' | 'growth' | 'scale' }` under current tenant session and CSRF, deduplicated per tenant/plan/day. `GET /api/admin/conversions?from=YYYY-MM-DD&to=YYYY-MM-DD` returns suppressed aggregate counts/rates only; no tenant IDs or raw interests.

- [ ] **Step 1: Write failing tests** for owner/manager tenant scoping, unauthenticated denial, valid plan registry only, duplicate same-day interest, 90-day raw expiry, report suppression below 3, date bounds, and `no-store` response. Example:

```ts
await expect(service.recordPlanInterest(tenantId, 'growth', now)).resolves.toMatchObject({ recorded: true });
await expect(service.recordPlanInterest(tenantId, 'growth', now)).resolves.toMatchObject({ recorded: false });
expect(report.byDay[0].tenantIds).toBeUndefined();
```

- [ ] **Step 2: Run red tests.** `pnpm --filter @autosale/api test -- admin-conversion`; `pnpm --filter @autosale/web test -- plan-interest-card admin-conversion`.
- [ ] **Step 3: Implement** a small bilingual dashboard card with plan choices, **Discuss a plan** `LoadingButton`, explicit “no subscription or charge” copy and a `mailto:` action after an attempted event write. The email action stays available when analytics is disabled/offline. Add a bounded admin report: registration-to-first-order denominator is registered tenants in the selected cohort; first-order-to-plan-interest denominator is first-order tenants in the 90-day linkable window. Do not divide page views by registrations or infer unique visitors. Purge raw `TenantPlanInterest` rows after 90 days and aggregate rows after 13 months with a bounded worker sweep.

```ts
const rate = denominator >= 3 && numerator >= 3 ? numerator / denominator : null;
const contactHref = `mailto:shvezigor@gmail.com?subject=${encodeURIComponent(`Sales AITO ${planId}`)}`;
```

- [ ] **Step 4: Run focused tests, `pnpm typecheck`, `pnpm build` and browser checks** for dashboard action, persisted admin aggregate after reload, tenant denial and disabled-analytics email path. Commit `feat: report privacy-minimal conversion` with scoped docs.

## Task 4: Privacy disclosure, rollout and acceptance

**Files:** Modify `apps/web/app/privacy/page.tsx` and test, `docs/operations/marketing-release.md`, `docs/features/README.md`, the canonical spec and marketing acceptance checklist; add `tests/e2e/private-conversion-analytics.spec.ts`.

- [ ] **Step 1: Add a failing privacy/contract test** requiring stated purposes, event categories, 90-day tenant interest, 13-month aggregates, no third-party cookies, opt-out/disable route and no claim of current billing enforcement. Test disabled-by-default production config.
- [ ] **Step 2: Add a Playwright acceptance test** that visits `/uk/pricing`, clicks a plan, completes one fictional demo submission, then inspects `/admin/conversions` with an authorized admin account. Assert 204 for safe event intake and aggregate-only admin response; inspect network to ensure no contact in analytics payloads.

```ts
const eventBodies: unknown[] = [];
page.on('request', (request) => {
  if (request.url().endsWith('/api/conversion/events')) eventBodies.push(request.postDataJSON());
});
expect(JSON.stringify(eventBodies)).not.toMatch(/email|phone|message|https?:/i);
```

- [ ] **Step 3: Run `pnpm test`, `pnpm typecheck`, `pnpm build`, targeted Playwright and a production-equivalent browser pass.** Keep analytics disabled on production until the notice/event contract and legal basis are approved. If not approved, record the exact live analytics gate as pending; UI, account/order-derived metrics and email action may still ship.
- [ ] **Step 4: Update the feature index/acceptance evidence and commit.** After all plans pass, merge/push `master` and remove the short-lived branch only after confirming no unique work remains.
