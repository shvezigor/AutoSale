# Spec: `demo-leads`

## Objective

Allow a prospective customer to submit a localized demo request without creating a tenant. The system must durably save the lead before attempting notification, resist common abuse, preserve privacy, and give the visitor a reliable success or retry experience.

Primary actor: prospective tenant owner. Secondary actor: platform operator receiving and processing the request.

## Tech Stack

- Existing Next.js frontend and NestJS API
- Zod contracts in `@autosale/contracts`
- PostgreSQL and Prisma in `@autosale/database`
- Existing Redis/BullMQ and Nodemailer infrastructure for retryable notification delivery
- Existing observability and structured logging package

## Commands

```powershell
pnpm --filter @autosale/contracts test
pnpm --filter @autosale/database test
pnpm --filter @autosale/api test
pnpm --filter @autosale/web test
pnpm typecheck
pnpm build
pnpm test:e2e
git diff --check
```

Database generation after an approved schema change:

```powershell
pnpm --filter @autosale/database generate
```

## Project Structure

```text
packages/contracts/src/demo-leads.ts
packages/database/prisma/schema.prisma
packages/database/prisma/migrations/

apps/api/src/demo-leads/
  demo-leads.module.ts
  demo-leads.controller.ts
  demo-leads.service.ts
  demo-lead-notification.service.ts
  *.spec.ts

apps/worker/src/demo-leads/
  demo-lead-notification.processor.ts
  demo-lead-notification.processor.spec.ts

apps/web/app/(marketing)/[locale]/demo/page.tsx
apps/web/src/marketing/components/demo-form.tsx
apps/web/src/marketing/components/demo-form.spec.tsx
```

The `DemoLead` record is platform-level and not tenant-owned. It stores normalized contact data, locale, order-volume range, optional note, consent timestamp/version, lifecycle status, notification state/attempts, and timestamps. It must not be exposed through tenant APIs.

## Code Style

Validate at the boundary, use explicit domain results, and avoid logging contact values.

```ts
export const demoLeadInputSchema = z.object({
  name: z.string().trim().min(2).max(100),
  company: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254).optional(),
  phone: z.string().trim().min(7).max(32).optional(),
  orderVolume: z.enum(['UNDER_50', '50_TO_300', '301_TO_1500', 'OVER_1500']),
  note: z.string().trim().max(1_000).optional(),
  locale: z.enum(['uk', 'en']),
  privacyConsent: z.literal(true),
}).refine((value) => value.email || value.phone, {
  message: 'Provide an email or phone number',
});
```

- Public error responses use stable codes and localized client copy.
- Logs contain lead id, correlation id, status, and error category, not email, phone, company, or note.
- Notification jobs reference the lead id and load the current record server-side.

## Testing Strategy

- Contract tests cover normalization, required contact, length bounds, invalid locale, invalid volume, and consent.
- PostgreSQL tests cover record creation, lifecycle transitions, notification retry state, and unique idempotency submission keys.
- API tests cover success, invalid input, oversized input, duplicate submission, rate limit, unavailable queue, and safe errors.
- Worker tests cover email success, temporary failure/backoff, permanent failure, retry exhaustion, and idempotent replay.
- Component tests cover field labels, validation summaries, pending state, success state, server error, preserved safe input, and keyboard focus.
- E2E submits Ukrainian and English forms and confirms exactly one durable record and one logical notification.

## Boundaries

- **Always:** save the lead transactionally before notification; require consent; validate server-side; rate-limit; make submission and notification idempotent; audit operator status changes; define retention and deletion handling.
- **Ask first:** add marketing enrichment, external CRM sync, SMS/Telegram delivery, CAPTCHA, or new personal-data fields.
- **Never:** create a tenant from a demo request; treat email delivery as the durable record; log personal form content; reveal whether a contact already exists; store raw IP addresses longer than operationally necessary; let the browser choose notification recipients.

## Success Criteria

1. A valid localized submission returns success only after a `DemoLead` record is committed.
2. Email failure does not lose or duplicate the lead and is retryable with bounded backoff.
3. Double clicks, browser retries, and worker replay create one logical lead and one logical notification attempt chain.
4. Invalid and abusive requests are rejected without exposing implementation details or other lead existence.
5. Visitors can complete the form by keyboard and screen reader and recover from field and server errors without re-entering all safe values.
6. Operator-visible status distinguishes new, contacted, qualified, closed, notification-pending, and notification-failed states without exposing leads to tenant users.
7. Logs and metrics contain no direct contact data.
8. Contracts, database, API, worker, web, typecheck, build, and E2E verification pass.

## Open Questions

The notification recipient is configured by environment for the first release. A lead-management admin UI is not required by this module.

