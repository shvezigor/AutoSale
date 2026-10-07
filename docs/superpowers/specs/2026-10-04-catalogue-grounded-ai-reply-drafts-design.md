# Catalogue-grounded AI reply drafts — design

**Date:** 2026-10-04  
**Updated:** 2026-10-07
**Status:** Automatic preparation implemented behind a tenant switch; partial production-browser evidence recorded; remaining live provider validation pending
**Owner:** Sales AITO conversations and AI

## 1. Purpose

Prepare an editable AI reply draft after a customer finishes a short block of inbound messages. The draft must use only tenant-owned catalogue facts and the tenant's communication style, expose its product sources, and remain a manager-controlled aid rather than an automatic message sender. The system may prepare and place text in an untouched editor, but only a manager may send it.

The first release is provider-neutral for Instagram, Facebook and TikTok conversations. It reuses the existing conversation, catalogue and durable outbound-delivery boundaries. Instagram and an eligible TikTok conversation may send the edited text through the existing delivery flow. Facebook remains copy-only until a separate outbound transport is approved and implemented.

## 2. Approved user flow

1. Each newly persisted inbound message starts or restarts a durable ten-second quiet-period countdown for that tenant and conversation.
2. When ten seconds pass without a newer inbound message, the worker binds one system-triggered draft to the latest inbound message. Its bounded recent context includes the preceding messages in the customer block.
3. A worker loads that context, the tenant communication style and tenant-scoped active catalogue candidates.
4. The worker creates and validates an `ANSWER`, `CLARIFY` or `HANDOFF` result.
5. The ready text appears with visible product sources and is placed in the ordinary reply editor only when that editor is still untouched. Text already entered or cleared by a manager is never silently replaced; in that case the ready draft remains visible but is not inserted.
6. The manager may edit the entire text and explicitly sends it.
7. Instagram or eligible TikTok conversations use the existing durable send action with the draft identity. Facebook offers **Copy reply** and explains that sending still happens in Meta.

A new inbound message makes an older unused draft stale and restarts the quiet-period countdown. Duplicate provider events and out-of-order older events do not restart it or create another active draft. No draft is ever sent automatically. A manual retry remains available after a safe generation failure; normal successful use requires no **Create AI draft** action.

Automatic scheduling occurs only while the tenant reply-style switch is enabled. A block with no usable text is not sent to the model because image understanding is outside this release; the conversation remains available for manual review.

Implementation notes (2026-10-05): the owner-controlled switch and communication profile live under **Settings → Social / customers → AI reply style** and are disabled by default. A manager may view but not edit that profile. The worker currently ranks at most the first 2,000 active products in SKU order per generation; this is a controlled-pilot ceiling, not a scale guarantee. Retrieval for larger catalogues must be redesigned and measured before general availability. See the [acceptance checklist](../../acceptance/ai-reply-drafts-checklist.md) for live provider, privacy and UX validation.

## 3. Communication style

Add a tenant-owned communication profile containing:

- an explicit enabled flag, disabled by default;
- company display name;
- tone: `FRIENDLY`, `NEUTRAL` or `FORMAL`;
- address form: `FORMAL_YOU` or `INFORMAL_YOU`;
- optional tenant-authored guidance limited to 500 characters.

Owners may update the profile. Managers may read and use it but cannot change it. Custom guidance affects wording only; it cannot override catalogue truth, privacy rules, provider restrictions or system safety instructions.

The UI owns this profile under **Settings → Social / customers → AI reply style** as a collapsed-by-default row. Its editable controls use the shared workspace field dimensions, borders, focus and validation states; the enable control is presented as a full-width settings toggle, and the form collapses to one column on mobile. The draft follows the language of the latest inbound customer message and does not mention AI unless the manager adds that text.

## 4. Chosen architecture

Use the existing durable asynchronous generation flow with an inbound debounce stage.

1. The provider-neutral social inbound ingestion boundary acts only after an inbound message resolves to a durable row. It never schedules from outbound echoes; a duplicate webhook replays the same deterministic automatic draft so a missed queue wake-up can recover without another row or model call.
2. When the tenant reply-style switch is enabled and the latest block has usable text, the same tenant context marks older active drafts stale and stores a system-triggered `QUEUED` draft for the latest inbound anchor with `availableAt = persistedAt + 10 seconds`.
3. After commit, it adds a delayed `ai-replies.generate` job. PostgreSQL remains the source of truth; reconciliation dispatches only queued rows whose `availableAt` has passed, so a missed Redis wake-up is recoverable without bypassing the quiet period.
4. A newer inbound message creates a newer scheduled row and stales the previous one. An older delayed job becomes a no-op. Before model spend, the worker verifies that the draft is active, its anchor is still the latest inbound message and the quiet period has elapsed.
5. The worker leases one draft, loads all required data inside the job tenant context, performs bounded deterministic catalogue retrieval, then calls the AI provider.
6. A strict structured response is validated against the candidate set and persisted. The existing post-generation anchor and catalogue rechecks remain mandatory.
7. The conversation detail API returns safe draft state and sources. It never returns prompts, customer identifiers outside the existing conversation contract, model internals or credentials.
8. When a supported channel sends an edited draft, the existing message transaction links the outbound message to that draft and marks the draft used.

Rejected alternatives:

- **Synchronous generation in the request:** exposes the browser to provider latency and makes timeout/idempotency handling weaker.
- **Generate immediately after every inbound message:** produces multiple drafts for one customer thought and wastes provider spend.
- **Browser-only debounce:** fails when no manager has the conversation open and is not a durable automation boundary.
- **Periodic conversation scanning without a durable scheduled row:** adds database load and makes recovery and exact ownership harder to audit.
- **A separate AI chat or delivery pipeline:** duplicates tenant, conversation, catalogue and exactly-once delivery invariants.
- **Send the complete catalogue to the model:** increases cost, disclosure and selection ambiguity.

## 5. Catalogue retrieval and factual grounding

Catalogue retrieval is deterministic and tenant-scoped. It considers only active products and uses the latest inbound message plus a bounded recent context to find candidate SKU, name, alias, brand, category, colour, size and attributes. The worker passes only the top bounded candidates to the model.

Allowed product facts are:

- product name and SKU;
- variant attributes;
- price and currency when both are present;
- stock quantity when explicitly present.

`stockQuantity = 0` means out of stock. `stockQuantity = null` means unknown and must never be presented as available or unavailable. Missing currency makes price unavailable for a factual reply. Discounts, delivery promises, payment terms and other commercial claims are outside the first release.

The structured AI result includes outcome, reply text, referenced product IDs and an exhaustive claim manifest whose spans identify every SKU, variant, price, currency, stock or availability statement in the draft. Every referenced ID must belong to the supplied candidate set. The validator rejects uncovered numbers, currencies, stock/availability language and prohibited commercial promise language, then compares every manifest claim with a generation-time source snapshot. If the result cannot be proven from allowed facts, it becomes `BLOCKED` with a safe reason instead of a ready draft. Ambiguous product selection produces a clarifying question; absence of a safe response produces handoff guidance.

## 6. Untrusted input and prompt boundary

Customer messages, attachment descriptions and tenant-authored style guidance are untrusted data. They are delimited from system instructions and cannot request secrets, cross-tenant data, arbitrary tools, policy changes or actions outside reply drafting.

The worker excludes phone numbers, delivery addresses, payment details and other unrelated personal data from model input. It includes only the bounded message text required to understand the product question. Attachments are not sent in the first release; their existing visible fallback may indicate that manager review is required.

## 7. Data model

### `TenantReplyStyle`

- `tenantId` unique tenant relation;
- company display name;
- enabled state;
- tone and address-form enums;
- optional bounded guidance;
- created and updated timestamps.

### `AiReplyDraft`

- tenant, conversation and anchor inbound message relations;
- trigger source: `MANUAL` or `AUTOMATIC`;
- optional creator user for manager-triggered retries; system-triggered drafts must not impersonate an owner or manager;
- client idempotency key for manual requests and a deterministic automatic key derived from the tenant, conversation and inbound anchor;
- `availableAt` timestamp for the quiet-period deadline;
- lifecycle status: `QUEUED`, `PROCESSING`, `READY`, `USED`, `STALE`, `BLOCKED` or `FAILED`;
- outcome: `ANSWER`, `CLARIFY` or `HANDOFF` when available;
- generated text and final used text;
- structured source snapshot with product IDs and only the factual fields supplied to the model;
- prompt, schema and model versions;
- provider latency and token counts;
- lease, attempt, safe error and timestamps;
- optional outbound message relation after use.

All relations use tenant-composite constraints and row-level security. Tenant export includes the communication profile and draft audit records but excludes hidden prompts, provider credentials and raw provider responses. Tenant freeze blocks new generations and use while preserving read-only history.

## 8. API contracts

`GET /api/settings/reply-style`

- owner and manager;
- returns the tenant profile or safe defaults.

`PATCH /api/settings/reply-style`

- owner only and CSRF-protected;
- uses shared field validation for company name, enum values and bounded guidance;
- preserves values and reports localized field errors.

`POST /api/conversations/:conversationId/reply-drafts`

- owner or manager, CSRF-protected and rate-limited;
- body contains only a UUID idempotency key;
- binds server-side to the current latest inbound message;
- replays the same logical draft for the same tenant, conversation, anchor and key;
- returns the durable queued/current record.

This endpoint remains for explicit retry and recovery. Ordinary automatic preparation is initiated by durable inbound ingestion, not by the browser and not by an unauthenticated HTTP callback.

Conversation detail returns current draft summaries and source labels. A focused draft endpoint may be added only if polling the conversation payload proves wasteful.

The existing outbound message endpoint gains an optional tenant-bound `draftId`. When present, it atomically records the manager's final text and links the created outbound message. A stale, failed, blocked, already used or cross-conversation draft is rejected. A message without `draftId` remains a normal manual reply.

## 9. Lifecycle, recovery and concurrency

Only one active generation is allowed per tenant, conversation and anchor message. Browser double-clicks, duplicate webhooks, delayed-job retries and reconciliation cannot create duplicate provider calls. Workers claim drafts with expiring leases; an expired `PROCESSING` lease is recoverable with bounded attempts.

The ten-second interval is measured from durable persistence of the newest inbound message, not from browser polling or an untrusted provider timestamp. A delayed job that runs early must reschedule for the remaining interval without calling the model. An out-of-order event whose source message is not the latest inbound anchor is persisted for history but does not replace the pending anchor. If a newer message arrives after model work starts, the final anchor recheck makes the result stale; it is never offered for sending.

Provider timeout, invalid structured output or temporary provider outage ends the attempt as `FAILED`; the system does not automatically spend another model request. The manager may explicitly retry, which creates a new audited attempt while preserving the failed record.

If an automatically triggered model result fails factual grounding or does not match the strict structured-response schema, the unsafe or malformed model text is discarded. For a customer block that explicitly asks for options and names a model, deterministic retrieval keeps products whose primary catalogue name contains that model; references found only inside a parenthetical compatibility list do not qualify. The worker then constructs an `ANSWER` from up to four exact source names with its own exhaustive claim offsets. If no such grounded options exist, it stores a localized, fact-free `CLARIFY` draft asking which exact product or model the customer means. Both fallbacks are limited to automatic preparation and are never sent automatically; neither may add inferred availability, price, delivery or payment claims. A provider outage still remains `FAILED`; explicit manual retries keep the original strict blocked/failed behavior so an operator can see that the requested generation did not pass validation.

Before storing `READY`, the worker rechecks that the anchor remains the latest inbound message and that source products have not changed. Before use, the API repeats those checks. A mismatch produces `STALE`, preserves the draft for audit and requires regeneration.

## 10. UI behavior

The existing conversation composer adds:

- stable quiet-period, queued and processing feedback without blocking conversation navigation;
- no generation button during the normal success path;
- automatic insertion into an untouched editor exactly once per ready draft;
- no separate full-size ready-draft card: an automatically inserted draft is shown only in the ordinary reply editor, with a compact status and collapsed catalogue sources;
- visible ready-draft context in a compact collapsed disclosure without insertion when the manager already touched the editor;
- **Retry** for a safe generation failure;
- a source list showing product name and SKU, with price/stock freshness where used;
- a clear warning for stale or blocked results;
- editable draft text in the ordinary reply field;
- a vertically resizable reply field bounded to the conversation viewport, so enlarging the editor reduces the internally scrollable message history without introducing document scroll;
- normal **Send** for supported reply-capable channels;
- **Copy reply** for Facebook with explicit manual-send guidance.

The manager's typed text is never erased by polling, a generation failure or a stale result. Clearing or editing an automatically inserted draft counts as manager interaction and the same draft is not inserted again. Buttons use shared variants and `LoadingButton`; errors follow the field-validation contract. Desktop, 390 px mobile, keyboard and screen-reader behavior are required.

When several attempts share the latest inbound anchor, the interface prefers an available `READY` draft over newer blocked or failed retries. An unsuccessful retry therefore cannot hide a previously safe, usable draft for the same customer message.

## 11. Security, privacy and observability

- Every operation is tenant-scoped and lifecycle-aware.
- Prompt and response boundaries use strict schemas and bounded sizes.
- Logs and metrics include IDs, controlled statuses, latency, model version and token counts, never customer text, generated text, custom guidance, product descriptions, personal data, prompts or raw provider failures.
- Model credentials remain worker-only.
- Rate limits apply per tenant and actor, with a separate tenant concurrency cap.
- Automatic generation has tenant and conversation ceilings separate from manual actor limits; duplicate and superseded scheduled rows never consume a model request.
- Draft generation cannot create an order, reserve inventory, modify price, record payment, create shipment or contact a provider.
- AI-authored text never uses Instagram's manual-only `HUMAN_AGENT` exception. If the channel requires that exception, the draft may be copied but cannot be sent through AI-draft use.
- Manager edits are authoritative manual content and remain auditable as the final used text.

## 12. Rollout and acceptance

The capability is protected by a tenant feature flag and starts disabled. An owner enables it only after saving the communication profile. Disabling prevents new generation and use but preserves existing drafts for audit.

Automated verification covers:

- tenant isolation and RLS for style, drafts and source snapshots;
- owner/manager settings permissions and localized field validation;
- idempotent acceptance, queue wake-up failure and lease recovery;
- deterministic tenant catalogue retrieval and bounded candidates;
- prompt injection attempts in customer text and custom guidance;
- exact and ambiguous product matching;
- current, changed and deleted product facts;
- null versus zero stock, missing currency and stale price;
- invalid product references and unsupported factual claims;
- provider timeout, invalid schema and explicit manager retry;
- deterministic fact-free clarification when an automatic model result fails factual grounding or structured parsing, while provider outages and manual unsafe retries remain strict;
- deterministic exact catalogue-option fallback for explicit model requests, including exclusion of compatibility-only parenthetical matches;
- new inbound messages during generation and before use;
- editor value preservation, source display, Facebook copy-only behavior and channel-specific send capability;
- one linked durable outbound message after double submit;
- ten-second debounce across message bursts, duplicate webhooks and out-of-order events;
- recovery of a missed delayed job without early generation or duplicate model spend;
- system attribution for automatic drafts and user attribution for manual retries;
- automatic editor insertion only while untouched, without reinsertion after manager edits or clearing;
- regression protection for order recognition, inventory, payment, shipment and ordinary manual replies.

Controlled pilot evidence must use consenting stores and privacy-minimized metrics. Proposed success targets remain hypotheses: at least 70% of drafts accepted without factual correction, 30% lower median active manager time and zero critical factual, privacy or duplicate-send incidents. A critical incident disables the tenant flag and returns the workspace to manual replies.

## 13. Explicit non-goals

The first release does not include:

- automatic or scheduled sending of customer replies;
- Facebook outbound API delivery;
- image understanding or product-by-photo search;
- discounts, delivery dates, payment promises or policy answers;
- edits to orders, stock, reservations, payments or shipments;
- autonomous multi-turn dialogue;
- identity merging across social channels;
- using conversation content to train a model;
- claiming a measured productivity or conversion improvement before a controlled pilot.
