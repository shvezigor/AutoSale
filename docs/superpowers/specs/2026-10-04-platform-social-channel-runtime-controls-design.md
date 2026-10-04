# Platform social-channel runtime controls

**Status:** implemented; isolated live browser mutation acceptance pending

**Actor:** Sales AITO platform administrator

**Capability id:** `platform-social-channel-runtime-controls`

## Objective

Give a Sales AITO platform administrator one safe place to enable or pause the Facebook Messenger and TikTok Business Messaging channels for the whole installation. The control is operational: it must stop new provider side effects without deleting tenant connections, credentials, conversations or messages.

The administrator must be able to distinguish three states without seeing credentials:

1. **Active** — the deployment supports the provider and the runtime control is enabled.
2. **Disabled by administrator** — the deployment supports the provider, but the runtime control is paused.
3. **Unavailable in deployment** — required environment configuration or provider credentials are not available, so the administrator cannot enable the channel.

## Scope

### Included

- A new `/admin/integrations` page and **Integrations** item in the platform-admin sidebar.
- Global runtime controls for Facebook Messenger and TikTok Business Messaging.
- A persisted platform-level setting for each supported channel.
- Deployment capability checks that keep environment flags and credential presence as a hard safety ceiling.
- Enforcement at OAuth, webhook, authenticated API and worker/provider side-effect boundaries.
- Privacy-safe audit records for every successful or rejected state change.
- Localized Ukrainian and English states, warnings, confirmations and failure messages.
- Responsive, keyboard-accessible controls using the shared Sales AITO button system.

### Not included

- Per-tenant rollout controls, percentages, schedules or feature experiments.
- Editing provider credentials from the browser.
- Deleting or disconnecting tenant integrations when a channel is disabled.
- Replaying messages that providers delivered only while a channel was disabled.
- Enabling Instagram, Threads, Viber or future providers through this first slice.
- Provider approval, business verification or live acceptance itself.

## Information architecture

| Route | Navigation label | Responsibility |
|---|---|---|
| `/admin/integrations` | Integrations | Show deployment availability and effective runtime state; enable or disable supported social channels |

The page contains one compact row or card per channel. Each row shows the provider name, a short capability description, current state, last-change time when available and one explicit action. Disabling requires confirmation because the effect is installation-wide. Enabling does not require a second confirmation.

The page never renders environment variable names, credential values, provider identifiers, tenant identifiers or tenant connection counts.

## Persistence model

Add a platform-scoped table with one row per controlled channel:

```prisma
model PlatformFeatureFlag {
  key             String   @id
  enabled         Boolean  @default(false)
  updatedByUserId String?  @map("updated_by_user_id") @db.Uuid
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@map("platform_feature_flags")
}
```

Only the closed application enum `FACEBOOK_MESSENGER` and `TIKTOK_BUSINESS_MESSAGING` is accepted at API and service boundaries. A missing row means **disabled**, making migration and first deployment fail closed. The implementation may add a relation to `User` if it does not weaken the existing platform-admin deletion semantics; the audit log remains the authoritative actor history.

The table is platform-scoped and contains no tenant or customer data. Application database roles receive only the minimum read/write privileges required by the API and workers.

## Effective-state model

The effective state is calculated as:

```ts
effectiveEnabled = deploymentAvailable && runtimeEnabled;
```

`deploymentAvailable` is read-only application state derived from the existing deployment flag and the presence of required configuration:

- Facebook Messenger: `FACEBOOK_MESSENGER_ENABLED` plus dedicated Facebook app id and secret.
- TikTok Business Messaging: `TIKTOK_BUSINESS_MESSAGING_ENABLED` plus client id, client secret and authorization URL.

The browser receives only `deploymentAvailable`, not the individual reasons or values. The environment flag therefore remains an emergency and deployment-level kill switch. An administrator cannot override it from the UI.

Runtime state is read from PostgreSQL at every side-effect boundary. The first slice deliberately avoids Redis pub/sub and long-lived in-process caches; the two indexed rows are cheap to read and immediate propagation is safer than cache invalidation. Read-only admin rendering may reuse a request-local value, but mutations and provider side effects must obtain a fresh value.

## API contracts

Add platform-admin-only endpoints:

```text
GET   /api/admin/integrations
PATCH /api/admin/integrations/:key
```

The list response contains only:

```ts
type AdminIntegrationControl = {
  key: 'FACEBOOK_MESSENGER' | 'TIKTOK_BUSINESS_MESSAGING';
  deploymentAvailable: boolean;
  runtimeEnabled: boolean;
  effectiveEnabled: boolean;
  state: 'ACTIVE' | 'ADMIN_DISABLED' | 'DEPLOYMENT_UNAVAILABLE';
  updatedAt: string | null;
};
```

The mutation accepts `{ enabled: boolean }`, requires the existing platform-admin authorization and CSRF protections, and returns the updated control. Enabling an unavailable channel returns a stable conflict code and localized safe UI message. Extra keys and fields are rejected by strict shared contracts.

Every accepted mutation writes a `SecurityAuditLog` entry with actor/user id, action, success result and metadata limited to channel key plus previous and new booleans. Rejected attempts are audited with a stable reason. Credentials, provider ids and tenant data are never recorded.

## Runtime enforcement

The effective state must be checked as close as possible to every external or durable side effect.

### OAuth and tenant settings

- A disabled channel cannot start OAuth, finish a new OAuth connection or select a provider account/Page.
- Existing encrypted credentials and tenant connection rows remain intact.
- Tenant settings render a localized **Temporarily unavailable** state and disable connection actions while preserving existing connection information.
- A callback already in flight after an administrator disables the channel fails safely without persisting new credentials.

### Webhooks and inbound messages

- Provider signatures and verification handshakes remain valid so disabling a channel does not create retry storms or break shared endpoints.
- After signature verification and provider classification, disabled-channel business events are acknowledged without creating webhook-event, message, conversation, order or media-copy side effects.
- The shared Meta endpoint applies the Facebook control only to Facebook Page events. Instagram processing must remain unchanged.
- Safe aggregate telemetry records that an event was ignored because the channel was administratively disabled; it contains no payload or tenant/customer identifiers.
- Events ignored while disabled are not promised to be replayed. The admin confirmation explains this possible message gap.

### Outbound API and workers

- A disabled channel rejects new outbound-send acceptance with a stable safe error.
- Workers re-check the fresh effective state immediately before calling a provider.
- Work already queued is paused without being marked as a provider failure and without consuming an automatic resend attempt. Durable source records remain eligible for reconciliation after re-enable.
- Generation fencing, idempotency and ambiguous-delivery rules remain unchanged.
- Re-enabling allows normal reconciliation and new work to continue; it never blindly resends an `UNKNOWN` delivery.

## User experience

The admin page uses the existing shell and visual language:

- **Disable** uses `LoadingButton` with the shared `danger-button` variant and a confirmation dialog.
- **Enable** uses `LoadingButton` with the shared `primary-button` variant.
- Deployment-unavailable rows have no active mutation button and show a safe explanatory hint.
- Mutation failures remain at card/form level because there is no independently invalid user input.
- Focus returns predictably after confirmation, loading state prevents duplicate submission, and status is announced through an accessible live region.
- At 390 px the action moves below the description and status without horizontal overflow.

The disable confirmation states that existing data and connections are retained, but new messages and replies stop and messages received during the pause may not be recoverable.

## Security and privacy invariants

- Only `PLATFORM_ADMIN` can read or mutate global channel state.
- Tenant owners and members cannot discover or modify the platform control endpoint.
- No secret, environment-variable value, Page id, TikTok account id, tenant id or customer content crosses the admin API.
- The environment safety ceiling cannot be overridden from the database or browser.
- A state transition and its security audit are committed atomically.
- Disabling a channel never deletes credentials, messages, connections or audit history.
- Facebook control never disables or changes Instagram behavior on the shared Meta infrastructure.

## Failure handling

- A failed state read fails closed for mutations and provider side effects; the admin page shows a safe unavailable state rather than fabricating **Active**.
- A database failure during mutation leaves the previous state effective and returns a non-sensitive error.
- An audit-write failure rolls back the state change.
- Unknown keys return 404 or a closed-enum validation response without revealing internal feature names.
- Provider outages remain distinct from an administrator-disabled channel.

## Implementation locations

- `packages/database/prisma/schema.prisma` and a reversible migration — persisted controls and least-privilege grants.
- `packages/contracts/src/auth.ts` or a focused admin-integration contract module — strict API schemas.
- `apps/api/src/admin/**` — platform-admin list/mutation endpoint and audit transaction.
- `apps/api/src/integrations/**`, `apps/api/src/meta/**`, `apps/api/src/tiktok/**` — OAuth, webhook and outbound API gates.
- `apps/worker/src/facebook/**`, `apps/worker/src/tiktok/**`, shared social inbound/outbound boundaries — worker gates and pause semantics.
- `apps/web/app/admin/integrations/**`, `apps/web/src/components/admin-*.tsx`, `apps/web/src/components/admin-copy.ts` — route, navigation and controls.
- Facebook/TikTok tenant settings components — effective-unavailable presentation.

## Testing strategy

- Contract tests accept only the two public keys and reject extra/sensitive fields.
- Migration and database-role tests prove fail-closed defaults and least-privilege access.
- Admin controller/service tests prove `PLATFORM_ADMIN` authorization, unavailable-enable conflicts, atomic audit and immediate state changes.
- Facebook and TikTok OAuth tests prove start and callback persistence are both gated.
- Webhook tests prove signatures/handshakes still work, disabled provider events create no business side effects, and disabling Facebook does not affect Instagram.
- API and worker tests prove no provider call occurs while disabled, queued work remains recoverable and ambiguous deliveries are not resent.
- Admin component tests cover loading, confirmation, localized states, keyboard use, focus, mobile layout and shared button variants.
- Tenant settings tests cover the unavailable state without exposing platform configuration.
- Full typecheck, production build and regression tests remain mandatory.

## Deployment sequence

1. Apply the database migration with both runtime controls absent/disabled.
2. Deploy API, worker and web code while existing environment flags remain the hard ceiling.
3. Verify migrations, health endpoints, queues, Instagram regression and the admin page.
4. Enable a channel only after its provider credentials, approval and controlled acceptance are ready.
5. Verify inbound and outbound behavior with a clearly fictional/test account, then monitor safe telemetry.

The production deploy remains manual until the documented automated Hetzner deployment is commissioned. No credential is stored in Git or entered through this admin page.

## Verification evidence

- Shared contracts, database fail-closed behavior, role grants, audited admin mutations, API boundaries and worker pause behavior are covered by package tests.
- The admin and tenant interfaces are covered in Ukrainian and English, including confirmation, duplicate-submit protection, retained connection identity, unavailable deployment state and responsive layout contracts.
- `tests/e2e/admin-integrations.spec.ts` covers desktop, 390 x 844 mobile, keyboard focus, confirmation cancellation, enable/disable and state restoration. It is deliberately opt-in through `E2E_ADMIN_CHANNEL_CONTROLS_LIVE=1` because it mutates installation-wide state. The current local run discovered the scenario successfully and skipped it because isolated platform-admin credentials were not configured.
- Provider approval and controlled live message acceptance remain separate launch gates; implementation does not imply Facebook or TikTok general availability.

## Success criteria

1. `/admin/integrations` shows Facebook and TikTok with one truthful state each and no sensitive data.
2. A platform administrator can enable an available channel and disable an active one; other roles cannot access either endpoint.
3. An unavailable deployment cannot be enabled through the browser or API.
4. Disabling stops new OAuth, inbound persistence, outbound acceptance and provider sends while retaining existing tenant data.
5. Facebook disablement leaves Instagram webhook processing unchanged.
6. Queued work is paused recoverably and does not become a false provider failure or duplicate send.
7. Every state change is atomically and safely audited.
8. Desktop and 390 px mobile layouts are accessible and contain no browser-default buttons or unintended overflow.

## Future extensions

- Per-tenant allow/deny overrides layered below the global safety ceiling.
- Staged rollout percentages and scheduled maintenance windows.
- Additional channels reusing the same closed registry after their own provider designs and approvals.
- Safe operational metrics and alerts for ignored events during a maintenance pause.
