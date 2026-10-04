# Catalogue-grounded AI reply drafts — design

**Date:** 2026-10-04  
**Status:** Approved design; implementation planned  
**Owner:** Sales AITO conversations and AI

## 1. Purpose

Let an owner or manager request an editable AI reply draft for the current customer conversation. The draft must use only tenant-owned catalogue facts and the tenant's communication style, expose its product sources, and remain a manager-controlled aid rather than an automatic message sender.

The first release is provider-neutral for Instagram, Facebook and TikTok conversations. It reuses the existing conversation, catalogue and durable outbound-delivery boundaries. Instagram and an eligible TikTok conversation may send the edited text through the existing delivery flow. Facebook remains copy-only until a separate outbound transport is approved and implemented.

## 2. Approved user flow

1. A manager opens a conversation and selects **Create AI draft**.
2. The API binds the request to the latest inbound message and durably creates one queued draft.
3. A worker loads bounded conversation context, the tenant communication style and tenant-scoped active catalogue candidates.
4. The worker creates and validates an `ANSWER`, `CLARIFY` or `HANDOFF` result.
5. The ready text appears in the existing reply editor with visible product sources.
6. The manager may edit the entire text.
7. Instagram or eligible TikTok conversations use the existing durable send action with the draft identity. Facebook offers **Copy reply** and explains that sending still happens in Meta.

Generation is manual. A new inbound message makes an older unused draft stale and requires a fresh generation. No draft is sent automatically.

## 3. Communication style

Add a tenant-owned communication profile containing:

- an explicit enabled flag, disabled by default;
- company display name;
- tone: `FRIENDLY`, `NEUTRAL` or `FORMAL`;
- address form: `FORMAL_YOU` or `INFORMAL_YOU`;
- optional tenant-authored guidance limited to 500 characters.

Owners may update the profile. Managers may read and use it but cannot change it. Custom guidance affects wording only; it cannot override catalogue truth, privacy rules, provider restrictions or system safety instructions.

The UI owns this profile under **Settings -> Orders -> AI reply style** as a collapsed-by-default row. The draft follows the language of the latest inbound customer message and does not mention AI unless the manager adds that text.

## 4. Chosen architecture

Use a durable asynchronous generation flow.

1. The API validates membership, conversation ownership, tenant lifecycle and an idempotency key.
2. It stores a queued draft before dispatching a BullMQ wake-up.
3. PostgreSQL is the source of truth; a bounded outbox scan recovers a missed Redis dispatch.
4. The worker leases one draft, loads all required data inside the job tenant context, performs bounded deterministic catalogue retrieval, then calls the AI provider.
5. A strict structured response is validated against the candidate set and persisted.
6. The conversation detail API returns safe draft state and sources. It never returns prompts, customer identifiers outside the existing conversation contract, model internals or credentials.
7. When a supported channel sends an edited draft, the existing message transaction links the outbound message to that draft and marks the draft used.

Rejected alternatives:

- **Synchronous generation in the request:** exposes the browser to provider latency and makes timeout/idempotency handling weaker.
- **Generate after every inbound message:** wastes provider spend and removes the agreed manager control.
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
- creator user and client idempotency key;
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

Conversation detail returns current draft summaries and source labels. A focused draft endpoint may be added only if polling the conversation payload proves wasteful.

The existing outbound message endpoint gains an optional tenant-bound `draftId`. When present, it atomically records the manager's final text and links the created outbound message. A stale, failed, blocked, already used or cross-conversation draft is rejected. A message without `draftId` remains a normal manual reply.

## 9. Lifecycle, recovery and concurrency

Only one active generation is allowed per tenant, conversation and anchor message. Browser double-clicks and request retries cannot create duplicate provider calls. Workers claim drafts with expiring leases; an expired `PROCESSING` lease is recoverable with bounded attempts.

Provider timeout, invalid structured output or temporary provider outage ends the attempt as `FAILED`; the system does not automatically spend another model request. The manager may explicitly retry, which creates a new audited attempt while preserving the failed record.

Before storing `READY`, the worker rechecks that the anchor remains the latest inbound message and that source products have not changed. Before use, the API repeats those checks. A mismatch produces `STALE`, preserves the draft for audit and requires regeneration.

## 10. UI behavior

The existing conversation composer adds:

- **Create AI draft** when no current generation exists;
- stable queued/processing feedback without blocking conversation navigation;
- **Retry** for a safe generation failure;
- a source list showing product name and SKU, with price/stock freshness where used;
- a clear warning for stale or blocked results;
- editable draft text in the ordinary reply field;
- normal **Send** for supported reply-capable channels;
- **Copy reply** for Facebook with explicit manual-send guidance.

The manager's typed text is never erased by polling, a generation failure or a stale result. A ready draft may fill an untouched editor; if the manager already typed, the UI asks before replacing it. Buttons use shared variants and `LoadingButton`; errors follow the field-validation contract. Desktop, 390 px mobile, keyboard and screen-reader behavior are required.

## 11. Security, privacy and observability

- Every operation is tenant-scoped and lifecycle-aware.
- Prompt and response boundaries use strict schemas and bounded sizes.
- Logs and metrics include IDs, controlled statuses, latency, model version and token counts, never customer text, generated text, custom guidance, product descriptions, personal data, prompts or raw provider failures.
- Model credentials remain worker-only.
- Rate limits apply per tenant and actor, with a separate tenant concurrency cap.
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
- new inbound messages during generation and before use;
- editor value preservation, source display, Facebook copy-only behavior and channel-specific send capability;
- one linked durable outbound message after double submit;
- regression protection for order recognition, inventory, payment, shipment and ordinary manual replies.

Controlled pilot evidence must use consenting stores and privacy-minimized metrics. Proposed success targets remain hypotheses: at least 70% of drafts accepted without factual correction, 30% lower median active manager time and zero critical factual, privacy or duplicate-send incidents. A critical incident disables the tenant flag and returns the workspace to manual replies.

## 13. Explicit non-goals

The first release does not include:

- automatic or scheduled customer replies;
- Facebook outbound API delivery;
- image understanding or product-by-photo search;
- discounts, delivery dates, payment promises or policy answers;
- edits to orders, stock, reservations, payments or shipments;
- autonomous multi-turn dialogue;
- identity merging across social channels;
- using conversation content to train a model;
- claiming a measured productivity or conversion improvement before a controlled pilot.
