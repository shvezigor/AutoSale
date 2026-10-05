# Catalogue-Grounded AI Reply Drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a manager request, inspect, edit and use a catalogue-grounded reply draft inside an Instagram, Facebook or TikTok conversation.

**Architecture:** The API stores a tenant-scoped request and returns immediately. A dedicated BullMQ worker retrieves bounded catalogue candidates, calls the model, validates every factual claim and persists an auditable draft; PostgreSQL reconciliation recovers missed queue dispatches. Supported channels use the existing durable outbound message path, while Facebook offers copying for manual sending.

**Tech Stack:** TypeScript, Zod, NestJS, Prisma/PostgreSQL with RLS, BullMQ/Redis, OpenAI Responses, Next.js/React, Vitest and Playwright.

**Spec:** `docs/superpowers/specs/2026-10-04-catalogue-grounded-ai-reply-drafts-design.md`

## Global Constraints

- Manager requests generation manually; the system never sends or changes orders automatically.
- Instagram and eligible TikTok can send through existing delivery; Facebook is copy-only.
- Only active products and their name, SKU, variant, price with currency, and explicit stock can ground claims. Null stock means unknown; zero means unavailable.
- The owner controls a disabled-by-default tenant flag, company name, tone (`FRIENDLY`, `NEUTRAL`, `FORMAL`), address (`FORMAL_YOU`, `INFORMAL_YOU`) and guidance of at most 500 characters.
- Statuses are `QUEUED`, `PROCESSING`, `READY`, `USED`, `STALE`, `BLOCKED`, `FAILED`; outcomes are `ANSWER`, `CLARIFY`, `HANDOFF`.
- No automatic paid-model retry. One active generation per tenant/conversation/latest inbound anchor; explicit retry creates a new audited attempt.
- Generation and use require current tenant state, membership, channel capability and current source facts. AI drafts cannot use Instagram's `HUMAN_AGENT` exception.
- Prompt/model secrets and raw provider responses stay out of logs, APIs and tenant exports; exports include the style, safe source snapshot and draft audit.
- All action buttons use shared variants and `LoadingButton`; all editable fields use the shared validation contract and Ukrainian/English copy.
- Work from current `master` on the existing short-lived `codex/ai-reply-drafts-design` branch. Keep `artifacts/` untouched. Commit each verified unit; after complete acceptance merge, push master, remove the branch and clean only its unique-free worktree.

## File map

| Responsibility | Files |
|---|---|
| Shared request/response and persisted source shapes | `packages/contracts/src/reply-drafts.ts` (new), `packages/contracts/src/conversations.ts`, `packages/contracts/src/index.ts`, `packages/contracts/package.json` |
| Tenant records and protection | `packages/database/prisma/schema.prisma`, new `packages/database/prisma/migrations/<timestamp>_ai_reply_drafts/migration.sql`, `packages/database/src/ai-reply-drafts-rls.postgres.spec.ts`, `apps/worker/src/tenant-lifecycle/tenant-export-datasets.ts` |
| Owner profile | `apps/api/src/settings/reply-style.controller.ts` and `.service.ts` (new), `apps/api/src/settings/settings.module.ts` or its actual module registration, matching specs |
| Generation acceptance and draft use | `apps/api/src/conversations/reply-drafts.service.ts` (new), existing controller/module/service and matching specs, `apps/api/src/queue/queue.module.ts` |
| Catalogue grounding | `apps/worker/src/reply-drafts/catalogue-candidates.ts`, `claim-validator.ts`, `input-sanitizer.ts` and colocated specs (new) |
| Model boundary and durable worker | `apps/worker/src/reply-drafts/openai-reply-draft-generator.ts`, `reply-draft.processor.ts`, `reply-draft.reconciler.ts` and specs (new), `apps/worker/src/main.ts` |
| Operations visibility | `apps/api/src/admin/admin.module.ts`, admin queue tests, `docs/operations/deployment.md` |
| Owner form and manager composer | `apps/web/src/api/reply-drafts.ts` (new), `apps/web/src/components/reply-style-form.tsx` (new), `social-reply-composer.tsx`, conversation/settings pages, i18n files, component specs and `apps/web/app/globals.css` |
| Acceptance and product knowledge | `tests/e2e/ai-reply-drafts.spec.ts` (new), `docs/acceptance/ai-reply-drafts-checklist.md` (new), canonical spec, `docs/features/README.md`, `tasks/todo.md` |

Use the existing migration timestamp naming convention after checking `packages/database/prisma/migrations`. Preserve tenant-composite foreign keys and RLS conventions from the adjacent conversation and catalogue migrations.

### Task 1: Contracts and safe public shapes

**Files:** Create `packages/contracts/src/reply-drafts.ts` and its spec; modify `packages/contracts/src/conversations.ts`, `packages/contracts/src/index.ts`, `packages/contracts/package.json`.

**Interfaces:** Produce `replyStyleSchema`, `replyStylePatchSchema`, `createReplyDraftSchema`, `replyDraftSummarySchema`, `replyDraftJobSchema`, `replyDraftSourceSchema`, and `ReplyDraftSummary`. Extend `outboundMessageInputSchema` with optional `draftId: z.uuid()`. Conversation detail gains `replyDrafts: ReplyDraftSummary[]`; the array contains only safe state, text and source labels.

- [ ] **Step 1: Write failing contract tests.** Assert `guidance` length 501 fails, a missing company name cannot enable the feature, a creation body accepts only UUID idempotency, a source omits product description, and outbound `draftId` is optional.
- [ ] **Step 2: Run** `pnpm --filter @autosale/contracts test -- reply-drafts.spec.ts`; expect red imports/schema assertions.
- [ ] **Step 3: Implement schemas.** Example: `const createReplyDraftSchema = z.strictObject({ idempotencyKey: z.uuid() }); const replyDraftStatusSchema = z.enum(['QUEUED','PROCESSING','READY','USED','STALE','BLOCKED','FAILED']);` Include bounded lengths for public text and sources, exported inferred types, and safe error codes rather than provider strings.
- [ ] **Step 4: Re-run targeted test, then** `pnpm --filter @autosale/contracts typecheck`; expect pass. Commit with `git add` of only these files and `git commit -m "feat: define reply draft contracts"`.

### Task 2: Tenant schema, RLS and export

**Files:** Modify `packages/database/prisma/schema.prisma`; create one SQL migration and `packages/database/src/ai-reply-drafts-rls.postgres.spec.ts`; modify `apps/worker/src/tenant-lifecycle/tenant-export-datasets.ts` and its spec.

**Interfaces:** `TenantReplyStyle` is unique by `tenantId`. `AiReplyDraft` stores tenant/conversation/anchor/creator/key, status/outcome, generated/final text, safe JSON source snapshot, prompt/schema/model metadata, latency/tokens, lease/attempt/error, optional outbound `Message` relation and timestamps. Unique `(tenantId, conversationId, anchorMessageId, idempotencyKey)` plus a partial index for one `QUEUED`/`PROCESSING` generation per anchor. Add a narrowly scoped `worker_due_ai_reply_drafts(now,limit)` function returning tenant ID and draft ID only to the worker DB identity.

- [ ] **Step 1: Write failing database tests.** With two fictional tenants, verify cross-tenant style/draft reads, writes and relation links fail; worker-only due scan excludes frozen tenants and contains no text; export dataset includes safe fields and omits hidden prompts/provider response.
- [ ] **Step 2: Run** `pnpm --filter @autosale/database test -- ai-reply-drafts-rls.postgres.spec.ts` and the tenant export dataset spec; expect missing tables/datasets.
- [ ] **Step 3: Add Prisma models and migration.** Follow `Conversation`/`Message` composite keys and RLS setup. The queue scan predicate is `status = 'QUEUED' OR (status = 'PROCESSING' AND lease_expires_at < now)` with bounded `LIMIT`; revoke public execution and grant only the worker role. Add the tenant lifecycle export datasets with exact safe field selects.
- [ ] **Step 4: Run** `pnpm --filter @autosale/database generate`, targeted tests and database typecheck; expect pass. Commit schema, SQL and tests as `feat: persist tenant reply drafts securely`.

### Task 3: Communication profile API

**Files:** Create `apps/api/src/settings/reply-style.controller.ts`, `.service.ts` and specs; modify the actual settings module registration discovered in `apps/api/src/settings`.

**Interfaces:** `GET /api/settings/reply-style` returns safe defaults to owner/manager. `PATCH` is owner-only, CSRF-protected, validates the shared patch contract and returns the saved profile. Enabling requires a nonempty company name. Both methods use tenant transaction context and reject frozen tenants on mutation.

- [ ] **Step 1: Write controller/service tests.** Manager GET succeeds and PATCH is forbidden; owner PATCH with 501-character guidance returns a safe field issue; enabling with blank company name fails; a valid update persists for only its tenant.
- [ ] **Step 2: Run** `pnpm --filter @autosale/api test -- reply-style`; expect failing imports/routes.
- [ ] **Step 3: Implement through existing authentication/validation patterns.** The core write should resemble `tx.tenantReplyStyle.upsert({ where: { tenantId }, create: { tenantId, ...validated }, update: validated })` inside `withTenantTransaction`, with lifecycle guard before write. Register the controller/service in settings module.
- [ ] **Step 4: Run targeted tests and API typecheck;** expect pass. Commit `feat: add tenant reply style settings`.

### Task 4: Idempotent generation acceptance and reading

**Files:** Create `apps/api/src/conversations/reply-drafts.service.ts` and spec; modify `apps/api/src/conversations/{conversations.controller,conversations.module,conversations.service}.ts`, matching specs, and `apps/api/src/queue/queue.module.ts`.

**Interfaces:** `POST /api/conversations/:id/reply-drafts` takes `{idempotencyKey}` and returns `ReplyDraftSummary`. The service checks manager membership, enabled style, lifecycle, latest inbound anchor, per-actor/tenant limits, then creates or replays the draft in one tenant transaction. It enqueues `ai-replies.generate` on the dedicated `AI_REPLY_QUEUE` after commit; queue failure leaves `QUEUED` for reconciliation. Conversation detail returns only the latest bounded draft summaries. Explicit retry uses the same POST with a new key after a terminal failed/blocked/stale draft.

- [ ] **Step 1: Write failing service tests.** Double submission returns one ID and one active record; disabled style/no inbound/frozen tenant fail safely; a queue outage still returns queued; a manager cannot access another tenant's conversation; new inbound marks older unused draft stale.
- [ ] **Step 2: Run** `pnpm --filter @autosale/api test -- reply-drafts.service.spec.ts`; expect red.
- [ ] **Step 3: Implement acceptance.** Use an atomic transaction/unique constraint, not a read-then-create race. Example queue data: `{ tenantId, draftId }`; `jobId` includes draft ID. Do not include message text in Redis. Register a separate `Queue('ai-replies')` with `attempts: 1` to avoid duplicate model spend.
- [ ] **Step 4: Run targeted tests and API typecheck;** expect pass. Commit `feat: accept audited reply draft requests`.

### Task 5: Deterministic catalogue retrieval and prompt input

**Files:** Create `apps/worker/src/reply-drafts/{catalogue-candidates,input-sanitizer}.ts` and colocated specs.

**Interfaces:** `selectCatalogueCandidates(products, inboundText, recentContext, limit)` returns at most 8 active tenant products, ranked by exact SKU, then name/alias, then variant/brand/category token overlap with stable SKU/ID ties. `buildSafeReplyInput` strips phone, address and payment data and bounds input length/context count; attachment contents never enter model input.

- [ ] **Step 1: Write failing pure tests.** Fictional products from two tenants prove tenant prefiltering, inactive exclusion, exact SKU preference, ambiguous tie, stable order, `stockQuantity: null` versus `0`, and maximum eight candidates. Fictional customer text with a phone/address/payment card proves removal and size bounds.
- [ ] **Step 2: Run** `pnpm --filter @autosale/worker test -- catalogue-candidates.spec.ts input-sanitizer.spec.ts`; expect red.
- [ ] **Step 3: Implement pure functions.** The DB query applies `tenantId` and `active: true` before ranking; in-memory ranking does not accept an unscoped product collection from another tenant. Pass only name, SKU, allowed variants, price+currency together and explicit stock to the model.
- [ ] **Step 4: Run targeted tests and worker typecheck;** expect pass. Commit `feat: retrieve bounded catalogue facts for drafts`.

### Task 6: Strict claim validation and model adapter

**Files:** Create `apps/worker/src/reply-drafts/{claim-validator,openai-reply-draft-generator}.ts` and specs.

**Interfaces:** `validateReplyDraft(result, sourceSnapshot)` returns either validated `ANSWER|CLARIFY|HANDOFF` or safe `BLOCKED` reason. The model result has exhaustive claim spans with type, exact text, product ID and source field; all supported numeric/currency/availability claims must be covered and match snapshots. `OpenAiReplyDraftGenerator.generate(input)` sends a strict JSON schema with `store:false` and returns parsed structured output plus model/latency/token metadata or sanitized failure.

- [ ] **Step 1: Write failing validator tests.** Accept exact SKU/variant/price+currency/zero stock claims; reject unknown product IDs, uncovered numbers, missing currency, null-stock availability, stale price, discounts, delivery/payment guarantees and ungrounded stock language. Include customer and guidance prompt-injection strings as data, asserting they cannot add tools or secrets.
- [ ] **Step 2: Run** `pnpm --filter @autosale/worker test -- claim-validator.spec.ts openai-reply-draft-generator.spec.ts`; expect red.
- [ ] **Step 3: Implement validation and adapter.** Follow `apps/worker/src/orders/openai-order-recognizer.ts` for Responses strict JSON schema and provider error handling. Keep prompt/schema versions constants; bind source IDs to the candidate set; reject all structured output with missing or overlapping claim spans rather than repairing claims silently.
- [ ] **Step 4: Run targeted tests and worker typecheck;** expect pass. Commit `feat: validate grounded AI reply claims`.

### Task 7: Durable processing, recovery and monitoring

**Files:** Create `apps/worker/src/reply-drafts/{reply-draft.processor,reply-draft.reconciler}.ts` and specs; modify `apps/worker/src/main.ts`, `apps/api/src/admin/admin.module.ts` and admin queue specs.

**Interfaces:** Worker claims one queued/expired leased draft by ID; an expiring lease permits bounded recovery before the provider call only. Once a call may have spent tokens, an ambiguous timeout is `FAILED` and requires an explicit new request. The processor rechecks latest inbound, tenant enablement/freeze and source product `updatedAt` before storing `READY`. Reconciler uses `worker_due_ai_reply_drafts` to wake missed jobs. Admin operations lists `ai-replies` queue counts.

- [ ] **Step 1: Write failing processor/reconciler tests.** Concurrent workers yield one claim; new inbound and changed/deleted product yield `STALE`; invalid output is `BLOCKED`; provider timeout is `FAILED` without retry; queue outage is recovered by due scan; frozen tenant causes no provider call. Admin queue test expects `ai-replies` summary.
- [ ] **Step 2: Run** `pnpm --filter @autosale/worker test -- reply-draft.processor.spec.ts reply-draft.reconciler.spec.ts` and targeted admin test; expect red.
- [ ] **Step 3: Implement processor and wire queue.** Use tenant-scoped transactions for reads/writes; keep the external model call outside a DB transaction; claim by conditional status/lease update; fence completion by attempt/lease token. Instantiate `Queue('ai-replies')` and `Worker('ai-replies', ...)` in `main.ts`, close both on shutdown, and schedule a bounded reconciler like existing worker reconcilers. Include safe status/latency/count metrics only.
- [ ] **Step 4: Run targeted tests, worker/API typechecks and build;** expect pass. Commit `feat: process and monitor durable reply drafts`.

### Task 8: Audited use in existing outbound flow

**Files:** Modify `apps/api/src/conversations/conversations.service.ts`, its controller tests and `packages/contracts/src/conversations.ts` if the Task 1 shape needs final alignment.

**Interfaces:** Existing `POST /api/conversations/:id/messages` accepts optional `draftId`; in the same tenant transaction that creates one outbound message, it checks `READY`, conversation, current inbound anchor, enabled style, unchanged sources and channel reply capability; writes `finalText`, `outboundMessageId`, `USED`. The same idempotency key replays the same message/draft association. Facebook remains rejected by the outbound endpoint; the UI copies text only. AI drafts cannot use Instagram `HUMAN_AGENT`, even if an ordinary manual reply can.

- [ ] **Step 1: Write failing send tests.** Valid IG/TikTok draft creates one linked message; double submit creates one; stale/used/cross-conversation/cross-tenant/disabled draft rejects; new inbound and changed product reject; Facebook and Instagram HUMAN_AGENT conditions reject draft use; manual text without draft remains unchanged.
- [ ] **Step 2: Run** `pnpm --filter @autosale/api test -- conversations.service.spec.ts`; expect red for draft cases.
- [ ] **Step 3: Implement atomic use.** Retrieve and conditionally update draft within the existing send transaction. Compare product facts from stored safe snapshot to current product records; never trust browser-supplied sources or model status. Preserve current outbound queue idempotency and delivery reconciliation.
- [ ] **Step 4: Run targeted tests and API typecheck;** expect pass. Commit `feat: link reviewed drafts to durable replies`.

### Task 9: Owner settings UI

**Files:** Create `apps/web/src/api/reply-drafts.ts`, `apps/web/src/components/reply-style-form.tsx` and spec; modify `apps/web/app/(workspace)/settings/page.tsx`, `apps/web/src/i18n/messages/{uk,en}.ts`, and contextual CSS in `apps/web/app/globals.css`.

**Interfaces:** A collapsed-by-default **AI reply style** row under Settings → Orders exposes enabled, company name, tone, address and guidance. Owner saves; manager sees read-only values. Field errors appear beside controls, focus first invalid, clear only edited error, preserve values, and never show raw API/Zod text.

- [ ] **Step 1: Write failing component tests.** Row starts closed; owner opens, edits and saves; blank company on enable and >500 guidance focus and label the field; API permission error stays at form level; manager cannot mutate; Ukrainian/English labels render.
- [ ] **Step 2: Run** `pnpm --filter @autosale/web test -- reply-style-form.spec.tsx`; expect red.
- [ ] **Step 3: Implement form.** Use `FormField`, `FieldError`, `form-validation.ts`, `LoadingButton` and shared button variants. Read profile on settings page using the authenticated API fetch pattern already used for order settings. Preserve accessibility IDs and 390 px layout.
- [ ] **Step 4: Run component, button and form-validation contract tests, web typecheck;** expect pass. Commit `feat: configure AI reply style in settings`.

### Task 10: Conversation draft UI and Facebook copy

**Files:** Modify `apps/web/src/components/social-reply-composer.tsx`, its spec, `apps/web/app/(workspace)/conversations/[id]/page.tsx`, `apps/web/src/api/conversations.ts`, i18n messages and CSS.

**Interfaces:** Manager may create/retry a draft, observe queue/processing/terminal state, see source SKU/name and stale/block reasons, review text in the existing editor and send with `draftId` on capable channels. Facebook has a copy action and manual Meta guidance. Polling never overwrites typed text; ready text fills only an untouched editor, otherwise asks before replacement.

- [ ] **Step 1: Write failing UI tests.** Generate sends UUID key once; polling updates status without replacing typed text; ready draft lists sources and requires explicit replacement when editor is dirty; IG/TikTok send includes `draftId`; Facebook copies text without calling send; stale/blocked/failed states guide regeneration; keyboard and mobile controls remain usable.
- [ ] **Step 2: Run** `pnpm --filter @autosale/web test -- social-reply-composer.spec.tsx`; expect red.
- [ ] **Step 3: Extend the shared composer and conversation page.** Feed safe `replyDrafts` from conversation detail. Use `LoadingButton`, shared secondary/copy buttons, `aria-live` for job state, and localized copy. Keep ordinary manual reply available if drafting is disabled. Use `navigator.clipboard.writeText` only on direct manager action, with a safe failure message.
- [ ] **Step 4: Run component tests, web typecheck and build;** expect pass. Commit `feat: review and use AI drafts in conversations`.

### Task 11: Cross-service acceptance, documentation and release

**Files:** Create `tests/e2e/ai-reply-drafts.spec.ts`, `docs/acceptance/ai-reply-drafts-checklist.md`; update canonical spec, `docs/features/README.md`, `tasks/todo.md`, and deployment operations guide if queue/runtime setup changes.

**Interfaces:** Automated journey covers an enabled fictional tenant, exact and ambiguous catalogue questions, owner settings, one queued/ready/used draft, copy-only Facebook, tenant isolation, new inbound staleness, ordinary manual send and no order/payment/shipment mutations. Rollout is disabled by default; pilot requires explicit owner enablement and controlled provider validation.

- [ ] **Step 1: Write the end-to-end scenario.** Seed fictional tenant/products/conversation and deterministic model adapter; assert `READY` source labels, manager edit, one outbound message and no new order/payment/shipment rows. Add 390 px viewport and Facebook copy assertion.
- [ ] **Step 2: Run the focused E2E suite;** expect red until wiring/fixtures are complete. Fix only failures tied to this feature.
- [ ] **Step 3: Update product knowledge.** Mark the feature **Validation pending** once code and automated checks pass, link actual source/test paths, record operator queue monitoring, disabled-by-default rollout, privacy boundaries and the still-open controlled live pilot. Keep the canonical spec and acceptance checklist consistent.
- [ ] **Step 4: Run** `pnpm typecheck`, `pnpm test`, `pnpm build` and the focused E2E command from `playwright.config.ts`; inspect failures and rerun only affected gates. Check `git diff --check` and `git status --short`; stage no credentials, `artifacts/`, dumps or build outputs. Commit `test: cover AI reply draft journey and document rollout`.
- [ ] **Step 5: Complete the authorized repository handoff.** Verify branch diff against current master, merge the verified short-lived branch, push master, prove no unique tracked/untracked branch work, remove the merged branch and clean its worktree. Deploy only after confirming current production procedure and health checks; record exact deployed commit and any live validation limits.

## Plan self-check

- Spec sections 1–3: Tasks 3, 9 and 10.
- Sections 4–6: Tasks 4–7.
- Sections 7–9: Tasks 1, 2, 4, 7 and 8.
- Sections 10–12: Tasks 8–11.
- Section 13 exclusions are enforced by Tasks 4, 6, 8 and 11.
- Before execution, resolve only actual repository naming in module registration, migration timestamp and test command selectors; no contract or behavior decision remains open.
