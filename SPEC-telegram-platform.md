# Spec: Telegram platform connection and durable delivery

## Objective

Build the shared Telegram foundation used by supplier-order delivery and personal notifications. A signed-in AutoSale user can link Telegram with one deliberate Start action, while the operator configures the shared bot once. AutoSale verifies every inbound update, stores no customer bot token, and delivers each requested message at most once from a durable PostgreSQL record.

Actors:

- Operator: configures the shared AutoSale bot token, public webhook URL, and webhook secret.
- Workspace member: links their Telegram identity through an expiring one-time deep link.
- Tenant owner: later uses the linked identity to connect supplier destinations.
- Worker: claims pending deliveries, sends them through Telegram, and records a safe result.

Observable success: a member clicks `Підключити Telegram`, presses Start in the shared bot, returns to AutoSale as connected, and a test notification is recorded and delivered once even if the API or worker retries.

## Scope

### In scope

- Optional environment configuration for one shared Telegram bot.
- Telegram webhook endpoint protected by Telegram's secret-token header.
- Expiring, hashed, single-use link attempts bound to tenant and user.
- Private `/start <token>` linking for personal identity.
- Group `/startgroup <token>` linking foundation for the supplier fallback.
- Business-connection update persistence foundation for later supplier dispatch.
- Tenant-safe Telegram chat summaries without message history.
- Durable outbox records with stable idempotency keys, retry state, provider message ID, and safe error code.
- Worker delivery through the Bot API with bounded retries and reconciliation after ambiguous failures.
- Audit events for link, unlink, destination changes, send, failure, and retry.
- Safe API summaries that never return the bot token, webhook secret, raw provider payload, or another tenant's chat.

### Out of scope

- Reading a user's full Telegram chat history.
- TDLib or storage of personal Telegram authorization sessions.
- Receiving customer orders through Telegram.
- AI-generated Telegram replies.
- Bulk broadcasts or marketing messages.
- Supplier-order formatting and event preference UI; those belong to downstream modules.

## Tech Stack

- NestJS API for webhook and authenticated integration endpoints.
- PostgreSQL and Prisma for bindings, chat summaries, attempts, deliveries, and audit state.
- BullMQ/Redis for wake-up and retry processing; PostgreSQL remains authoritative.
- Existing worker process for Bot API delivery and reconciliation.
- Next.js settings UI only after the platform contract is stable.
- Native `fetch` for the HTTPS Telegram Bot API; no Telegram SDK dependency is required.

## Commands

```powershell
pnpm --filter @autosale/contracts test
pnpm --filter @autosale/database test
pnpm --filter @autosale/api test
pnpm --filter @autosale/worker test
pnpm typecheck
pnpm build
docker compose -p autosale --env-file C:\Users\User\Documents\ChatGPT\AutoSales\.env up -d --build api worker web
```

## Project Structure

```text
packages/contracts/src/telegram.ts           shared request/response and event contracts
packages/database/prisma/schema.prisma       Telegram persistence and tenant relations
packages/database/prisma/migrations/         additive schema migration
packages/integrations/src/telegram-bot.ts    small Bot API adapter and error mapping
apps/api/src/integrations/telegram/           webhook, link, summary, and queue wake-up
apps/worker/src/telegram/                     delivery processor and reconciler
apps/web/src/components/                      downstream settings UI
docs/integrations/telegram.md                 operator and customer setup
```

## Domain Contract

### Link attempts

- Purpose: `PERSONAL` or `SUPPLIER_GROUP`.
- Store only a SHA-256 token hash; raw token is returned once in the deep link.
- Bind to tenant, user, purpose, safe return path, and a short expiry.
- Consumption is transactional and single-use.

### Bindings and chats

- A tenant/user binding stores Telegram user ID, private chat ID, safe display label, linked time, and revoked time.
- A business connection stores its opaque connection ID, Telegram user ID, granted rights, enabled state, and last update time.
- A chat summary stores external chat ID, type, title, route (`BOT` or `BUSINESS`), optional business connection ID, and last observed time.
- External numeric IDs are stored as strings to avoid JavaScript precision loss.

### Deliveries

- Purpose: `TEST`, `SUPPLIER_ORDER`, or `PERSONAL_ALERT`.
- State: `PENDING`, `PROCESSING`, `SUCCEEDED`, `RETRYABLE`, or `FAILED`.
- A unique idempotency key prevents duplicate logical delivery.
- The database record is committed before BullMQ is used as a wake-up signal.
- A due-delivery reconciler recovers missed queue wake-ups and expired processing leases.
- Raw Telegram error bodies are never persisted or returned; map them to bounded safe codes.

## API Contract

- `POST /api/integrations/telegram/webhook`: public Telegram update receiver; requires the configured secret-token header and returns quickly.
- `GET /api/integrations/telegram`: membership-scoped connection summary.
- `POST /api/integrations/telegram/link`: authenticated link attempt; personal linking is available to any member, supplier-group linking is owner-only.
- `DELETE /api/integrations/telegram/link`: unlinks the current member's private Telegram binding without deleting AutoSale data.
- `POST /api/integrations/telegram/test`: queues one idempotent privacy-safe test notification to the current member.

All mutating authenticated routes require the existing session, role checks, and CSRF protection.

## Code Style

```ts
const delivery = await prisma.telegramDelivery.upsert({
  where: { idempotencyKey },
  create: { tenantId, userId, purpose: 'TEST', idempotencyKey, status: 'PENDING' },
  update: {},
});

await queue.add('telegram.deliver', { deliveryId: delivery.id }, { jobId: `telegram:${delivery.id}` });
```

- Keep provider types at the integration boundary.
- Use explicit tenant IDs in every query and unique key.
- Store external IDs as strings and parse no Telegram-provided HTML.
- Keep user-facing errors Ukrainian and provider-safe.

## Testing Strategy

- Contract tests: strict schemas and safe public summaries.
- Integration adapter tests: success, invalid token, blocked bot, missing chat, rate limit, timeout, and malformed response.
- API tests: webhook secret, replay, expired token, cross-tenant access, role/CSRF, unlink, and queue wake-up failure.
- Database tests: single-use attempts, binding uniqueness, idempotent delivery, lease recovery, and tenant isolation.
- Worker tests: success, retry-after handling, bounded retries, duplicate jobs, ambiguous timeout, and safe error persistence.
- Browser tests are deferred until the downstream settings module renders the connection UI.

## Privacy, Security, and Operations

- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` are operator environment secrets and fail closed when partially configured.
- The webhook accepts only HTTPS in production documentation and verifies the secret header with constant-time comparison.
- Do not log raw updates, token parameters, message bodies containing order PII, chat IDs, or Telegram user IDs.
- Personal linking requires explicit Start consent. Automatic supplier sending requires a separate explicit owner setting downstream.
- Rate-limit link creation, webhook processing, tests, and manual retries.
- Retain delivery metadata for audit; do not retain unrelated Telegram messages.

## Boundaries

- Always: validate all update shapes, tenant-scope every read/write, persist before queueing, enforce idempotency, redact provider errors, and test retries.
- Ask first: destructive cleanup, adding TDLib, reading chat history, enabling automatic supplier sends, or changing production webhook configuration.
- Never: accept a bot token from a customer, expose platform secrets, store login codes or personal Telegram sessions, silently send as a user, or use Telegram data for AI training.

## Success Criteria

- A customer never visits BotFather or handles a bot token.
- One Start action links the correct Telegram user to the correct AutoSale tenant/user and cannot be replayed.
- An invalid webhook secret and malformed update cause no persistent side effect.
- A test delivery is stored before queueing and reaches one linked chat once.
- Retrying the API call, BullMQ job, worker, or reconciler does not create another logical delivery.
- Provider failures show a safe actionable state while preserving the pending business action.
- Disconnect stops later personal deliveries and does not remove AutoSale orders, users, or audit history.
- Tests, typecheck, production build, and container health checks pass.

## Open Questions

- The operator must create and configure the shared AutoSale bot once in BotFather; this is an infrastructure prerequisite, not a customer action.
- Live acceptance requires the final bot username, bot token, webhook secret, and permission to register the production webhook. No secret belongs in the repository.

