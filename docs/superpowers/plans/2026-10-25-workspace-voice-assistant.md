# Workspace Voice Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Execution hold:** The owner explicitly requested preparation only on 2026-10-25. Do not execute implementation steps, install dependencies, create migrations, start provider sessions, change runtime settings or deploy until the owner explicitly authorizes implementation. The skill choice above is future guidance, not authorization to dispatch agents now. Use inline execution unless delegation is separately authorized by the applicable instructions.

**Goal:** Deliver optional owner voice-guided onboarding with a persisted personal switch, shared readiness and one confirmed mutation of the two existing order-processing mode fields.

**Architecture:** Browser audio uses OpenAI Realtime/WebRTC; the existing API owns session authority, a typed action registry and durable confirmation. Buttons and assistant mutations share domain validation, transaction preconditions and audit. Existing PostgreSQL/RLS, provider adapters and outboxes remain authoritative.

**Tech Stack:** Existing TypeScript, Next.js/React, NestJS, Zod, Prisma/PostgreSQL, Redis, Vitest and Playwright. Add a pinned Realtime SDK/transport only after the compatibility gate; no new microservice or workflow engine.

**Spec:** [Approved architecture](../specs/2026-10-25-workspace-voice-assistant-design.md), [accepted ADR](../../adr/0003-workspace-assistant-actions.md), [acceptance checklist](../../acceptance/workspace-voice-assistant-checklist.md).

## Global constraints

- Implementation is on hold until an explicit user instruction lifts it. Design approval alone is insufficient.
- First release: owners, UK/EN, read/explain/navigation and `intentDetectionMode`/`approvalMode` only. Orders/messages/payments/shipments are separate future slices.
- Personal preference defaults `false`; enable does not start recording, request permission or call OpenAI. Stop, mute and persistent disable have distinct semantics.
- Voice and button confirmations identify one immutable pending operation. No model-callable execute/confirm function.
- One active voice session per user; initial limits: 15 minutes, two-minute inactivity cutoff, five starts per user per hour, 120-second proposal lifetime and active authority heartbeat at most five seconds.
- Revalidate principal, current personal preference, rollout gates, lifecycle and resource ownership at mutation admission. Use one lock order for preference and settings changes.
- No raw audio/transcript persistence; no secrets, SDP, raw provider errors or customer content in logs. Profile preference is user-owned; session/operation rows are tenant-owned with forced RLS.
- Session metadata retention: 7 days after closure. Terminal operation payload retention: 30 days. Unresolved effects are quarantined, not silently purged.
- Preserve existing AI usage collection/retention OFF state and its separate activation gates. Missing usage is never numeric zero.
- Automated checks and deployed real-browser acceptance are both required. Fictional fixtures only unless a named test account and external effect are explicitly authorized.
- Read `DESIGN.md` and `docs/frontend/design-system.md` before UI implementation. Reuse shared variants, `LoadingButton`, field validation and focus handling.
- Start each implementation increment from current `master` in a short-lived `codex/*` branch; verify, commit scoped paths, merge/push, and remove only work proven merged and clean.

## Preparation status and remaining inputs

| Item | Current evidence | When needed / owner |
|---|---|---|
| Product scope and confirmation | Approved in the canonical spec | Ready for planning; owner controls implementation start |
| Profile/onboarding/settings/auth boundaries | Source paths inspected; no general assistant subsystem found | Recheck current source at implementation start |
| API credentials and model access | Not inspected or changed. Current Compose gives the existing OpenAI key to the worker; API config has no Realtime configuration | Before a real voice session: operator chooses an OpenAI project, confirms API billing/model access and supplies a server-side secret through approved key handling |
| Provider SDK/model/input transcription/voice | Official Realtime/WebRTC/transcription docs checked; no local/provider compatibility run | Task 5: record tested versions and Ukrainian/English results; do not infer account availability from documentation |
| Pilot spend | No amount approved; session/time quotas already specified | Before paid tests: owner approves total test spend; operator configures project alerts and application limits. A billing alert is not assumed to be a hard cap |
| Test environment | Existing app, database isolation harness and browser tests available in source | Before execution: local dependencies, Docker test DB, isolated owner/manager test users; before live acceptance: HTTPS staging or explicitly authorized target |
| Provider onboarding accounts | Not selected; no production account/customer interaction authorized | Before complete OAuth/Picker browser flow: explicitly authorized test Google/Meta accounts, existing provider access/approval |
| Data processing and metering | No audio stored by design; provider/account retention configuration unverified; current usage collection OFF | Before pilot activation: review disclosure and account processing/retention settings; follow existing privacy/accounting gate for metering |

None of the unavailable inputs prevents this planning artifact. Fictional/offline implementation can begin after the owner's go-ahead; paid provider calls and deployment have additional gates. Never ask the owner to paste a secret into chat. At authorized credential setup, use the installed OpenAI Platform key workflow and local-destination confirmation if applicable.

## File and responsibility map

Paths marked new are planned, not present runtime code. Existing files are reused rather than copied into a second feature service.

| Boundary | Files |
|---|---|
| Shared contracts/readiness | New `packages/contracts/src/assistant.ts`, `onboarding.ts`, `order-settings.ts` and focused specs; update `packages/contracts/package.json` exports |
| Profile switch | Existing `packages/contracts/src/profile.ts`, `apps/api/src/auth/profile.controller.ts`, `profile.service.ts`, `apps/web/src/components/profile-editor.tsx` and their tests |
| Persistence/authority | Existing `packages/database/prisma/schema.prisma`, `src/runtime-database-roles.ts`, `src/index.ts`; new `src/assistant-store.ts`, `src/assistant-store.postgres.spec.ts` |
| Readiness adapter | New `apps/api/src/assistant/onboarding-reader.ts`; existing `apps/web/app/(workspace)/onboarding/page.tsx` and `page.spec.tsx` |
| Domain write | Existing `apps/api/src/settings/order-settings.controller.ts`, `order-settings.service.ts`, `order-settings.module.ts`; new `order-settings.service.postgres.spec.ts`; existing web order-settings form/tests |
| Application orchestration | New `apps/api/src/assistant/assistant.module.ts`, `assistant.controller.ts`, `assistant.service.ts`, `assistant-actions.ts`, `confirmation.ts`, plus matching focused specs; existing `apps/api/src/app.module.ts` |
| Realtime boundary | New `apps/api/src/assistant/openai-realtime.ts`, `openai-realtime.spec.ts`, `session-authority.ts`, `session-authority.spec.ts`; existing config/Compose/API package |
| Workspace UI | New `apps/web/src/components/assistant/{assistant-provider,assistant-panel,assistant-preference,assistant-action-card}.tsx`, `voice-session.ts`, matching tests; existing authenticated shell, UK/EN messages, globals and shared UI contract tests |
| Lifecycle and usage | Existing `packages/database/src/ai-provider-usage.ts`, `ai-provider-usage.postgres.spec.ts`, worker AI usage report/reconciliation, tenant export datasets and tests; new narrowly scoped assistant maintenance and Realtime metering adapters |
| Browser acceptance | New `tests/e2e/workspace-voice-assistant.spec.ts`; checklist and evidence in `docs/acceptance/workspace-voice-assistant-checklist.md` |

## Task 1: Shared contracts and readiness parity

**Files:** New contract files/specs in the map; modify contracts exports, onboarding page/tests, settings controller and profile contract/tests.

**Interfaces produced:** `OrderModePatch` contains only the optional detection/approval enums (at least one required). `OrderSettingsSnapshot` adds `version` to the existing response. `AssistantPreference` is `{ enabled: boolean; version: number }`. `OnboardingSources` maps seven step IDs to `READY | INCOMPLETE | UNAVAILABLE`; `deriveOnboardingStatus(sources)` returns steps, required totals and next step without IO. Source adapters, not the pure function, evaluate existing integration records.

- [ ] Write strict-schema and readiness tests, including unknown actor/tenant fields and all existing channel/optional predicates. Example test intent:

```ts
it('rejects a model-supplied authority', () => {
  expect(orderModePatchSchema.safeParse({
    approvalMode: 'ALWAYS', tenantId: 'other-tenant',
  }).success).toBe(false);
});
it('keeps an unavailable source out of ready progress', () => {
  const sources: OnboardingSources = {
    catalogue: 'READY', channel: 'UNAVAILABLE', orders: 'READY',
    delivery: 'INCOMPLETE', suppliers: 'INCOMPLETE',
    notifications: 'INCOMPLETE', payments: 'INCOMPLETE',
  };
  expect(deriveOnboardingStatus(sources).requiredReady).toBe(2);
});
```

- [ ] Run `pnpm --filter @autosale/contracts exec vitest run src/assistant.spec.ts src/onboarding.spec.ts src/order-settings.spec.ts src/profile.spec.ts`; verify a meaningful failure before adding contracts.
- [ ] Implement/export schemas and pure predicates. Reuse enums from the existing settings controller, remove its independent copies, and preserve its full existing field support for normal settings writes. Restrict only the assistant patch to the two fields. `UNAVAILABLE` must not be described as disconnected; existing page core completion remains unchanged.

```ts
export const orderModePatchSchema = z.object({
  intentDetectionMode: z.enum(['PHRASE_ONLY', 'AI_SUGGESTION', 'AI_AUTOMATION']).optional(),
  approvalMode: z.enum(['ALWAYS', 'NEVER', 'ON_LOW_CONFIDENCE']).optional(),
}).strict().refine(value => Object.keys(value).length > 0);
export type OrderModePatch = z.infer<typeof orderModePatchSchema>;
export type StepState = 'READY' | 'INCOMPLETE' | 'UNAVAILABLE';
export type StepId = 'catalogue' | 'channel' | 'orders' | 'delivery' | 'suppliers' | 'notifications' | 'payments';
export type OnboardingSources = Record<StepId, StepState>;
export const assistantPreferencePatchSchema = z.object({
  enabled: z.boolean(), expectedVersion: z.number().int().nonnegative(),
}).strict();
```

- [ ] Move the current source-to-readiness rules to the shared contract projection; keep API/source loading separate and side-effect-free. Verify current active Facebook and inbound-only TikTok tests plus both locales. Do not make preview initialize settings as a hidden write.
- [ ] Run focused contracts and `pnpm --filter @autosale/web exec vitest run 'app/(workspace)/onboarding/page.spec.tsx'`; typecheck changed packages. Commit `refactor: share onboarding and assistant contracts` with scoped files and canonical doc updates.

## Task 2: Personal preference and durable assistant state

**Files:** Schema, runtime roles, database store/index/tests, profile controller/service/contracts/tests, auth module wiring, tenant lifecycle export datasets/tests. After execution is authorized, generate a migration named `workspace_assistant` in `packages/database/prisma/migrations`; Prisma supplies its execution-time timestamp. No migration is created during preparation.

**Interfaces produced:** Profile `PATCH /api/profile/assistant-preference` accepts `{ enabled, expectedVersion }`, returns `AssistantPreference`; profile GET adds its two fields. `AssistantStore` provides session/proposal insertion and authorized lookup through tenant transactions. Its transaction functions share the supplied `Prisma.TransactionClient` with domain work; they do not open nested transactions.

- [ ] Add controller tests for own-user-only edits, CSRF, stale versions and no mutation of name/phone/locale; add restricted-role PostgreSQL tests before schema changes. Test exact default values and two tenants using the existing Testcontainers/runtime-role harness.

```ts
it('requires a nonnegative preference version', () => {
  expect(assistantPreferencePatchSchema.safeParse({ enabled: false, expectedVersion: -1 }).success).toBe(false);
});
// Integration test assertions against the fictional user created by the harness:
expect(savedProfile.assistantEnabled).toBe(false);
expect(savedProfile.assistantPreferenceVersion).toBe(0);
// A cross-tenant operation lookup must return no record under the API runtime role.
expect(crossTenantOperation).toBeNull();
```

- [ ] Run profile contract/controller suites and the new database suite; confirm failures refer to the absent preference/state behavior, not missing Docker/configuration.
- [ ] Add user `assistantEnabled=false`, `assistantPreferenceVersion=0`; `AssistantSession` and `AssistantOperation` with actor/tenant ownership, immutable payload/hash, expiry, confirmation item ID, domain result reference and states from the spec. Enforce unique `(tenantId, sessionId, providerToolCallId)`, one pending operation per session and one active voice session per user. The provider's transport `providerCallId` identifies the session; it is not the tool-call identity. Limit payloads to registered enum settings. Session IDs are correlation fields, not cascade-delete authority for operations.
- [ ] Implement preference compare-and-set in the existing profile service; audit only changed field names/state. Do not accept a user ID in its payload. Share lock order `user -> assistant session -> operation -> tenant settings` with Task 3. Disabling advances the version; session authority observes the change even if notification fails.

```ts
const updated = await tx.user.updateMany({
  where: { id: principal.userId, assistantPreferenceVersion: expectedVersion },
  data: { assistantEnabled: enabled, assistantPreferenceVersion: { increment: 1 } },
});
if (updated.count !== 1) throw new ConflictException('ASSISTANT_PREFERENCE_CHANGED');
```

- [ ] Apply forced RLS and runtime grants to both new tenant tables; expose only bounded maintenance discovery, never payloads, outside tenant context. User-wide closure may discover opaque session/tenant routing IDs only through an authenticated own-user authority boundary, then close/cancel under each tenant context; never grant a global payload scan. Include stored assistant metadata in canonical lifecycle export, with account preference handled through existing user-profile export boundaries. Do not create tenant authority from model/session input.
- [ ] Run `pnpm --filter @autosale/database exec vitest run src/assistant-store.postgres.spec.ts`, profile suites and export tests. Commit `feat: persist assistant preference and operation state`; keep all runtime gates off.

## Task 3: Atomic settings updates and confirmed operations

**Files:** Settings service/controller/module and web form/tests; new assistant actions/service/confirmation files and specs; database store tests. Expose the settings provider through its module rather than constructing a duplicate service in assistant code.

**Interfaces produced:** `OrderSettingsService.updateInTransaction(tx, principal, input, expectedVersion)` returns `OrderSettingsSnapshot`; normal form and assistant both use it. `prepareOrderModes(principal, sessionId, patch)` returns an immutable `OperationPreview`. `confirmOperation(principal, operationId, evidence)` returns durable `OperationResult`. `classifyConfirmation(text)` returns `CONFIRM | CANCEL | AMBIGUOUS` only; it grants no authority.

`OperationPreview`: operation ID, action/version, old/new mode fields, settings/preference versions, payload hash and expiry. `OperationResult`: operation ID, state and optional settings result/version. `ConfirmationEvidence`: discriminated `BUTTON` with CSRF-validated request ID/preview hash or `VOICE` with provider input item ID, final-turn sequence and armed window ID; the VOICE form is internal-only.

- [ ] Add tests for stale settings, atomic audit, duplicate voice/button confirms, revoked membership, disabled preference, frozen tenant, cancel/expiry/disable races and crash rollback. Assert exact settings version and operation counts after concurrent calls.

```ts
it.each(['ні', 'не підтверджую', 'так, але зміни режим', 'так'])('does not approve %s', text => {
  expect(classifyConfirmation(text)).not.toBe('CONFIRM');
});
it.each(['Підтверджую', 'Так, зберегти', 'Confirm'])('recognizes explicit %s', text => {
  expect(classifyConfirmation(text)).toBe('CONFIRM');
});
```

- [ ] Run `pnpm --filter @autosale/api exec vitest run src/assistant/confirmation.spec.ts src/settings/order-settings.service.postgres.spec.ts`; validate meaningful failures.
- [ ] Add a settings version increment used by **every** settings writer. Normalize the immutable patch and hash it; preview reads cannot persist default records. Existing rows start at version 0. Serialize creation of absent defaults through the tenant authority row so the first confirmed save also has a precondition.
- [ ] Implement confirmation in one tenant transaction. Lock the user first, resolve current membership/login and preference, then session/operation/settings. Check the exact preview, expiry, confirmation source and flags; claim, invoke the transaction-aware domain method, audit and store success before commit. A domain failure rolls back the claim and mutation; record a safe failure separately only when its semantics are known. No provider/network call belongs inside this transaction.

```text
BEGIN tenant transaction
  lock current user's preference row
  verify live login, owner membership, enabled preference and lifecycle
  lock session and operation; return prior terminal result on a matching replay
  reject expired/cancelled/superseded or mismatched preview
  lock settings and compare expected version
  update modes + increment version
  append existing audit + store operation success/result
COMMIT
```

- [ ] Update the normal form to send its loaded version; a conflict preserves edits and offers a fresh comparison. Do not silently overwrite unsaved input after an assistant result. Extract shared validation and authorization currently owned only by the controller.
- [ ] Run settings controller/form suites plus database concurrency tests. Commit `feat: execute confirmed assistant settings atomically` with existing user-facing flow disabled for the assistant.

## Task 4: Application session authority and allowlisted actions

**Files:** New assistant module/controller/service/actions/reader/session-authority files and specs, existing app module/config/Compose. Introduce a fake transport in test files only.

**Interfaces produced:** `AssistantTransport` has `connect({ sessionId, offerSdp, locale }): Promise<{ answerSdp: string; providerCallId: string }>` and `close(sessionId): Promise<void>`. The application stores `providerCallId`; responses to the browser expose only application IDs/SDP. `readOnboarding(principal): Promise<OnboardingSources>` composes existing domain reads; `getAssistantAvailability(principal)` returns personal state plus effective availability/reason without secrets.

- [ ] Write HTTP/controller tests covering missing CSRF, nonowner, wrong session actor, freeze, flags off, invalid/bounded SDP, quota, provider failure and no provider call when disabled. Authoritative rate/concurrency reservations must work across processes, not just a local Map.

```ts
// With a fake transport injected through the test module and preference off:
await request(server).post('/api/assistant/sessions').set(authHeaders)
  .send({ offerSdp: 'fictional-sdp', locale: 'uk' }).expect(403);
expect(transport.connect).not.toHaveBeenCalled();
```

- [ ] Run `pnpm --filter @autosale/api exec vitest run src/assistant/assistant.controller.spec.ts src/assistant/session-authority.spec.ts` before implementing these routes.
- [ ] Wire only the spec endpoints, plus `GET /api/assistant/availability`, authenticated `POST /api/assistant/sessions/:id/heartbeat`, `POST .../:id/preview-ready`, and `POST .../:id/voice-confirmation-ready`. Availability is read-only; heartbeats refresh authority, never extend maximum session duration. The two ready acknowledgements carry operation/hash/context revision; the backend requires its own corresponding prompt/item/playback state before arming. Do not accept a final transcript from these requests.
- [ ] Register five named actions from the spec; refuse unknown tool names, arguments and caller-supplied tenant IDs. Load bounded reviewed help topics; local navigation uses registered step IDs, never arbitrary URLs. Resolve current resource ownership and context revision on each use. Forward browser result cards from durable application reads, not a model-generated success string.
- [ ] Reserve a user session slot and start quota before provider IO, with a short lease for failed startups. After connection, recheck preference/version, flags, login and lifecycle; close the new provider session if authority changed while connecting. Reuse a start request ID for duplicate HTTP requests without opening another paid session. Bound uncertainty from a provider timeout and expire the reservation without treating it as free.
- [ ] Heartbeat at most every five seconds, server revalidation before tools, graceful shutdown, inactivity/max duration, logout/tenant switch/revocation/disable closure and recovery of stale DB leases. Read-only operation lookup stays available for a disabled assistant's committed results. A process crash ends authority; reconnect is a fresh session with no prior confirmation.
- [ ] Run API/config tests. Commit `feat: gate assistant sessions and action registry` with no production feature activation.

## Task 5: OpenAI adapter and voice-confirmation evidence

**Files:** New `openai-realtime.ts`/spec and confirmation/session-authority specs; `apps/api/package.json`, lockfile, `packages/config/src/api-env.ts`/spec, `compose.yaml`, `packages/config/src/deployment-env.spec.ts`. Browser transport belongs in Task 6.

**Interfaces consumed:** Task 4 transport and session authority. **Produces:** provider event normalization into application-owned `ToolProposal` and `FinalUserInput` records. `FinalUserInput` contains provider item ID, session ID, input-turn sequence, final transcript and final flag in memory only. Turn sequence comes from server-observed input events, not completion-arrival order.

- [ ] After implementation authorization, verify SDK/API compatibility from official docs and the selected account. Pin the tested SDK, model, transcription model and voice in config/release evidence; use the installed OpenAI key workflow for authorized setup. Never install or open a session during this preparation turn.
- [ ] Write adapter contract tests with fictional recorded shapes: duplicate/out-of-order final inputs, assistant echo, malformed events, delayed final transcript from before preview, tool replay, missing usage, sideband failure and startup revoke/disable. No tests contact OpenAI by default.

```ts
// Given a window armed after input turn 8, a delayed transcript from turn 7 is not consent.
const window = { afterTurn: 8, operationId: 'fictional-operation', armed: true };
const lateInput = { turn: 7, final: true, text: 'Підтверджую' };
expect(lateInput.final && lateInput.turn > window.afterTurn && window.armed).toBe(false);
// Production confirmation additionally checks bound session/item, preview hash, expiry and authority.
```

- [ ] Run `pnpm --filter @autosale/api exec vitest run src/assistant/openai-realtime.spec.ts src/assistant/confirmation.spec.ts` to establish failures, then implement the adapter with fixed official endpoints, sanitized error categories and cancellation timeouts. Prefer server-mediated unified WebRTC negotiation; derive call identity from the authenticated provider response and attach the backend control connection before tools are enabled.

```text
browser SDP -> authenticated application POST -> official Realtime call creation
provider response -> persist bound application/provider IDs -> attach server control
authority recheck -> return browser answer -> enable registered tools
provider final input event -> match input item + turn -> restricted grammar
armed preview + current authority -> internal confirmOperation
```

- [ ] Configure input transcription explicitly; do not assume speech-to-speech inference yields reliable transcripts. Accept only backend-observed final user turns recorded after the window was armed; cancel on ambiguous/mixed input and require a button when evidence is missing. The browser never provides `confirmed=true` or an executable voice evidence payload. Suppress content logging by the SDK and application error handlers.
- [ ] Add validated configuration names: `ASSISTANT_ENABLED=false`, `ASSISTANT_MUTATIONS_ENABLED=false`, `ASSISTANT_TEST_TENANT_IDS` (empty by default), `OPENAI_REALTIME_API_KEY` (server-only), `OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_TRANSCRIPTION_MODEL`, `OPENAI_REALTIME_VOICE`; numeric limits use the spec defaults. Require provider settings only when the feature is enabled; do not break existing workers or expose a `NEXT_PUBLIC` secret. Allowlist flags belong to server configuration, not user input.
- [ ] After separate paid-test authorization, use a short approved test session to verify UK/EN audio, barge-in, input transcript ordering, sideband ownership and actual cleanup. Record exact model/SDK/browser versions. If unavailable, keep live gate open and proceed only with offline work.
- [ ] Run adapter/config suites and typecheck/build changed packages. Commit `feat: integrate server-controlled realtime voice` with all rollout switches still off.

## Task 6: Accessible workspace panel and personal switch

**Files:** New assistant UI files/specs listed in the map; existing authenticated shell, profile editor, order settings form, UK/EN messages, `app/globals.css`, `button-style-contract.spec.ts`, `form-validation-contract.spec.ts`; `DESIGN.md` and design-system doc remain the authority.

**Interfaces produced:** `AssistantProvider` owns the session lifecycle and current application operation. `AssistantPreference` control consumes profile state and the versioned preference endpoint. `VoiceSessionClient.start()` is called only by an explicit Start click; `stop()` stops every media track, playback and data/peer connection. `AssistantActionCard` takes `OperationPreview`/`OperationResult`, never freeform model state.

- [ ] Add component/media mock tests for default off, reload enabled-but-idle, failed preference save, hidden launcher with discoverable Profile switch, switching tabs, pending action disable, no lost form edits, captions/focus and localized errors.

```ts
// Render the new assistant with persisted preference enabled but no Start gesture:
expect(getUserMedia).not.toHaveBeenCalled();
expect(startProviderSession).not.toHaveBeenCalled();
// After disabling during a fictional call:
expect(track.stop).toHaveBeenCalledOnce();
expect(peer.close).toHaveBeenCalledOnce();
```

- [ ] Run `pnpm --filter @autosale/web exec vitest run src/components/assistant` before adding the UI, then use the existing workspace tokens and controls. Mount the provider once in the authenticated shell; lazy-load audio only on Start. Render off/idle/connecting/listening/speaking/processing/failed states, mute/end/disable, proposal preview and real result.
- [ ] Implement microphone cleanup independently of provider response and preference persistence; a save failure leaves the device stopped and exposes retry. Focus restoration and keyboard activation must work at 320 px. Other-tab changes refresh on focus/heartbeat; local broadcast is only an acceleration. Closing the visual panel does not silently mean persisted disable—give the user explicit controls.

```ts
function stopLocalAudio(stream: MediaStream | null, peer: RTCPeerConnection | null, player: HTMLAudioElement) {
  stream?.getTracks().forEach(track => track.stop());
  player.pause();
  player.srcObject = null;
  peer?.close();
}
```

- [ ] Add registered setup links and unsaved-edit protection; for OAuth/Picker/secret entry pause capture, return to the existing form and re-read stored status afterward. Never scrape DOM/credential fields into context. Ready acknowledgements occur only for the currently rendered preview and completed prompt playback; interruption disarms confirmation.
- [ ] Run assistant/profile/settings/shared UI/localization tests and web typecheck/build. Commit `feat: add optional onboarding voice interface`. Keep real-browser visual acceptance open until Task 8.

## Task 7: Lifecycle maintenance, metering and operations

**Files:** Existing AI usage database/store/runtime roles, worker usage report/reconciliation/export tests, `apps/worker/src/main.ts`, `packages/config/src/worker-env.ts`, Compose and data-protection runbook; new `apps/worker/src/assistant/assistant-maintenance.ts`/spec and `apps/api/src/assistant/realtime-usage.ts`/spec. Extend the existing usage-ledger canonical spec in this implementation increment.

**Interfaces produced:** `normalizeRealtimeUsage(event)` returns known/null token totals and audio/text/cached breakdown without content. Deduplicate by bound tenant/session/provider response ID. `maintainAssistantState(now, limit)` expires unclaimed proposals and purges eligible closed/terminal records through bounded tenant-aware operations; hard cap 100 rows per pass.

- [ ] Add tests for session cleanup at 7 days, operation payload cleanup at 30 days, exact boundaries, no cascade loss, unresolved quarantine, forced RLS, lifecycle export/freeze and late finalization. Add usage tests for duplicate response events, interrupted/missing usage, invalid negative/inconsistent counts, cached audio/text and response/session aggregate double counting.

```ts
expect(normalizeRealtimeUsage({ response: { id: 'fictional-response' } }).inputTokens).toBeNull();
expect(normalizeRealtimeUsage({ response: { id: 'fictional-response', usage: { input_tokens: 0, output_tokens: 0 } } }).inputTokens).toBe(0);
// An interrupted session without an observed response is reported as incomplete, not a free session.
```

- [ ] Run focused database/API/worker tests before implementation. Extend the existing ledger with an assistant purpose and nullable modality breakdown/provider correlation; keep existing worker callers valid and terminal records immutable. Use response-level attempts and explicit incomplete-session evidence; never add session totals to already counted responses. Separate transcription/model usage is counted only when provider evidence makes its scope explicit.
- [ ] Keep ordinary API direct ledger writes denied. Add narrow tenant-bound start/finalize authority functions restricted to the assistant purpose and a real bound assistant session, safe numeric/model fields and allowed transitions; runtime role tests must reject wrong-purpose/tenant/session calls. Preserve worker-only maintenance privileges. Do not route secrets/audio through a new queue to bypass these boundaries.
- [ ] Extend the existing report/export handling to treat onboarding setup usage separately from per-order cost. New modalities need reviewed effective tariffs before monetary calculations; unsupported or missing tariffs produce a provisional/unpriced result, never guessed pricing. Maintain current collection OFF until its formal gate is satisfied.

```text
response started -> one stable ledger attempt for bound session/response
response terminal -> finalize known usage once, before business parsing
duplicate terminal event -> same result, no extra charge row
disconnect with missing evidence -> charge/coverage unknown, never zero
maintenance -> discover bounded IDs -> tenant transaction -> expire/purge/audit
```

- [ ] Add server quotas, provider call timeouts, graceful shutdown and content-free health/error/latency counters. Document rollout/rollback in the checklist with exact switches; do not claim that quota time is an exact spend cap.
- [ ] Run real restricted-role database tests, lifecycle export/restore tests and usage tests. Commit `feat: bound assistant lifecycle and realtime usage`. Existing collection/retention production flags stay unchanged.

## Task 8: Release and full browser acceptance

**Files:** New `tests/e2e/workspace-voice-assistant.spec.ts`; acceptance checklist; canonical design/index/backlog and deployment documentation as needed. No release command is authorized by this plan alone.

**Interfaces consumed:** Actual profile, session, confirmation, domain status and browser media flows. **Produces:** dated evidence with commit, environment, model/SDK/browser, fictional account designation, scenario result and screenshots; precise blocked-step records.

- [ ] Build a fictional fixture mode which is available only in test/development, injects the fake transport and cannot accept real credentials. Add Playwright cases for normal form + assistant state agreement, duplicate confirms, reload, disable, validation, permission and provider failure. Do not add fixture endpoints to production.

```text
owner enables -> no microphone/provider call
owner presses Start -> permission -> onboarding status
owner proposes approval ALWAYS -> exact preview -> confirms by button -> one saved result
reload settings/onboarding -> same canonical value/progress
repeat with a real final voice turn in authorized live acceptance
disable while awaiting confirmation -> delayed confirm cannot mutate
```

- [ ] Run focused suites, then `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm exec playwright test tests/e2e/workspace-voice-assistant.spec.ts` against the configured isolated fixture environment. A mocked-media pass does not establish real microphone/audio quality.
- [ ] Use the production-deployment project skill only after release authorization: back up, apply additive migrations, build/deploy with assistant switches off, verify ordinary onboarding/profile/settings and service health. Enable only the approved test tenant/read stage, then the mutation stage after confirmation/concurrency checks pass.
- [ ] Complete every checklist row in the target real browser: UK/EN, 320/768/1024/1440 px, keyboard/200% zoom, voice/button confirmation, OAuth/Picker return, no secrets in context, saved state after reload, second-device disable, microphone denial and provider outage. Capture final panel/preview/result screenshots.
- [ ] Reconcile actual pilot usage with provider evidence before wider rollout; collect completion/time/correction metrics against baseline. No customer replies or shipments in Stage 1. On unintended write/tenant exposure stop the pilot, disable flags, close sessions and preserve audit/committed domain records.
- [ ] Update acceptance/status evidence, commit `test: verify onboarding voice acceptance` and mark Available only when all required gates pass. Otherwise use Validation pending with exact remaining steps.

## Dependency order and handoff

Implement 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8. Review each increment independently; the complete first release needs every gate. Do not expose the profile switch before its full disable semantics are wired; until then keep it behind the same assistant rollout gate.

The architecture's future orders/messages/other-action roadmap is intentionally outside this plan. No generic endpoint enumeration, mass migration of buttons or customer-message sending is part of Stage 1.

## Coverage review

| Spec requirement | Plan tasks |
|---|---|
| Shared domain/readiness, roles, no duplicate service | 1, 3, 4 |
| Personal off/on persistence and cross-device disable | 2, 4, 6, 8 |
| Immutable preview, voice/button confirmation, concurrency/recovery | 2, 3, 4, 5, 8 |
| Provider transport, explicit microphone, typed tools | 4, 5, 6 |
| RLS, lifecycle freeze/export/retention, redaction | 2, 3, 4, 7, 8 |
| Usage, quotas, missing costs and activation gates | 4, 5, 7, 8 |
| Localized/accessibility UI and deployed browser verification | 6, 8 |
| Future capability boundaries and message provenance | Excluded from implementation; retained in canonical roadmap |

Preparation verification: check local documentation links, existing source paths and spec/plan terminology; inspect the diff for documentation-only scope. Do not run implementation commands to validate a plan. This preparation turn creates no dependency/model access, runtime behavior or browser acceptance evidence.

## Official references checked during preparation

- [Realtime overview](https://developers.openai.com/api/docs/guides/realtime)
- [Browser WebRTC and server-mediated setup](https://developers.openai.com/api/docs/guides/voice-webrtc?voice-api=realtime)
- [Input transcription and final-event ordering](https://developers.openai.com/api/docs/guides/realtime-transcription)

These establish supported integration mechanisms, not access for the chosen account. Recheck them at the compatibility gate before committing a provider-specific implementation.
