# Conversational order-intent detection

**Status:** Available, owner opt-in
**Updated:** 2026-09-24

## Objective

Recognize a completed purchase agreement from a new inbound Instagram message without requiring one exact manager phrase. This extends the existing order-recognition pipeline; it does not add automated customer replies and does not change the public marketing-site routes or design.

## Owner modes

The workspace owner selects one mode in **Settings → Orders**:

- `PHRASE_ONLY` (default): only the configured deterministic manager phrase or the existing manual action starts recognition.
- `AI_SUGGESTION`: each new inbound text revision may produce a `NEEDS_REVIEW` proposal, but never an automatically approved order.
- `AI_AUTOMATION`: a complete, explicit and high-confidence purchase may become `AUTO_APPROVED`; incomplete or uncertain results remain `NEEDS_REVIEW` proposals.

The deterministic phrase and manual action remain available in every mode. Changing a mode affects future inbound messages only.

## Decision policy

AI output is first validated through the existing structured order-recognition contract and catalogue matcher. The policy then applies these gates in order:

1. The new inbound anchor message itself must express explicit purchase intent. An older product discussion or completed order in the bounded context cannot make an unrelated greeting, thanks, reaction, link, media share, or informational question into a new order.
2. At least one usable product description must exist; AI cannot invent a SKU.
3. Suggestion mode always requires manager review.
4. Automation mode requires no validation issues and confidence at or above the tenant threshold.
5. Any incomplete or low-confidence result becomes a manager proposal rather than an automatic order.

The order review displays a localized, bounded explanation: manager-review mode, incomplete data, low confidence, or complete high-confidence automation. Internal schema paths and raw model output are never shown.

## Idempotency and recovery

`OrderIntentEvaluation` is keyed uniquely by the inbound anchor message. The worker claims that row before calling the model, uses a five-minute processing lease, and stores a terminal `IGNORED`, `PROPOSED`, or `AUTO_CREATED` state. A replay returns the already linked order or no result and never calls the model twice. Failed or expired claims can be reclaimed safely and increment `attempts`.

The evaluated context is bounded to the latest 50 messages at or before the anchor timestamp and active tenant products. Context may resolve references in an explicit purchase commitment, but it is not independent proof of intent. The structured model result therefore includes an anchor-specific purchase-intent gate that is checked again by deterministic policy. A later inbound message is a new revision with its own evaluation; older messages are never re-evaluated as anchors.

## Data, audit and observability

Each evaluation stores the safe reason, mode, attempts, response/model identifiers, input/output token counts, latency, completion time and safe failure code. The existing order audit log records manager corrections, approval and cancellation; because the evaluation links to its order, corrections and rejected proposals can be used to calculate false-positive and correction rates without storing extra conversation content in telemetry.

Operational telemetry emits `ai_order_intent_evaluated` with correlation ID, resulting order or anchor ID, and bounded result reason. Automatic mode remains opt-in; `PHRASE_ONLY` is the database and UI default.

## Verification ownership

- Policy: `apps/worker/src/orders/order-intent-policy.spec.ts`
- Durable migration and uniqueness: `apps/worker/src/orders/order-intent-evaluation-migration.spec.ts`
- Worker proposal/replay integration: `apps/worker/src/orders/triggered-order.processor.spec.ts`
- Settings API and tenant scope: `apps/api/src/settings/*order-settings*.spec.ts`
- Order read model: `apps/api/src/orders/orders.service.spec.ts`
- Owner settings and review explanation: `apps/web/src/components/order-settings-form.spec.tsx`, `apps/web/src/components/order-review-panel.spec.tsx`

Live Meta validation remains part of the Instagram acceptance checklist; automated tests use fictional data and fake model responses.
