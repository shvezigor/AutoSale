# TikTok Business Messaging channel design

**Date:** 2026-10-04
**Status:** Implementation in progress; contracts, tenant-safe persistence, strict provider client, and owner OAuth lifecycle are implemented, while the shared app webhook, message ingestion, UI, and live validation remain incomplete
**Owner:** Sales AITO social channels

## 1. Purpose

Add TikTok direct messages as a customer conversation channel in Sales AITO. A workspace owner connects one eligible TikTok Business Account, after which new customer messages appear in the existing inbox, may enter the existing AI order-recognition flow, and can receive manual manager replies from Sales AITO when TikTok permits the action.

TikTok is a separate provider. It must not reuse Meta credentials, webhook verification, token storage, or delivery assumptions. The shared conversation, attachment, order-recognition, tenant-isolation, lifecycle, and observability contracts remain authoritative after provider-specific normalization.

## 2. Terminology and provider boundary

- **TikTok Business Account** is the merchant's professional TikTok profile. It is not a paid Sales AITO feature or a blue-check subscription.
- **Verified Business Account** is a TikTok business-verification state based on provider-accepted registration documents. TikTok may require it for Business Messaging capabilities.
- **TikTok Business Center** manages business assets, users, and access.
- **Sales AITO developer app** is the single TikTok for Business application operated by Sales AITO. It requests Business Messaging API access and passes TikTok's security/privacy review once for the platform.
- **Messaging readiness** combines granted account-holder OAuth scopes with TikTok's conversation-specific capability result. Product behavior never assumes that every Business Account or conversation has identical send access.

The owner of Sales AITO is responsible for registering the developer app, configuring production URLs, and completing provider review. Each merchant remains responsible for signing in, accepting TikTok terms, authorizing its account, and supplying its own legal documents when TikTok requires business verification. Sales AITO never asks a merchant to paste an access token.

Primary provider references verified on 2026-10-04:

- [TikTok API for Business documentation](https://ads.tiktok.com/gateway/docs/index?doc_id=1772372080226305&identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&language=ENGLISH)
- [TikTok business verification](https://ads.tiktok.com/resources/help/article/how-to-register-a-business-account)
- [TikTok automatic messages](https://ads.tiktok.com/help/article/navigate-auto-message-business-accounts?lang=en)

Public documentation confirms real-time send/receive messaging, conversation and message retrieval, image upload, image/video download, webhooks, automatic messages, and an account-capability endpoint. It does not guarantee Business Messaging eligibility for a Ukrainian developer or merchant account. That remains a provider acceptance gate.

## 3. Approved delivery scope

The approved capability is delivered in two ordered slices behind one disabled-by-default feature flag.

### 3.1 Slice A: connection and inbound orders

- owner-only TikTok account authorization;
- encrypted access and refresh token storage;
- capability check before activation;
- verified callback handling through the single Business Messaging webhook subscription owned by the Sales AITO developer app;
- durable and idempotent ingestion of inbound text, image, video, link, and unsupported attachments;
- provider-neutral persistence into the existing conversation, message, attachment, and order-trigger flow with channel `TIKTOK`;
- TikTok-labelled conversations in the existing desktop and mobile inbox;
- collapsed TikTok row in `Settings -> Social networks / customers`;
- reconnect, disconnect, lifecycle freeze, cleanup, reconciliation, audit, and sanitized observability behavior consistent with existing social providers.

### 3.2 Slice B: manual outbound replies

- manager and owner text replies from the existing conversation screen;
- image replies only when the connected account capability and API contract permit them;
- durable queued delivery, retry classification, reconciliation, and visible delivery status;
- server-side enforcement of provider capability and current messaging limits;
- a localized blocked reason when TikTok does not permit a reply;
- no optimistic `SENT` state before TikTok confirms acceptance.

Slice A must be independently deployable and testable. Slice B reuses the durable outbound-delivery pattern already established for Instagram, but TikTok receives its own adapter, error taxonomy, eligibility checks, and provider message identifiers.

## 4. Explicit non-goals

The first release does not include:

- importing the full historical TikTok inbox;
- unsolicited bulk or promotional messages;
- AI-authored or automatically sent sales replies;
- welcome messages, keyword replies, suggested questions, chat prompts, or new-follower automations;
- Comment-to-Message automation;
- TikTok comments, mentions, posts, ads, leads, or TikTok Shop order synchronization;
- multiple TikTok accounts in one tenant;
- merging the same human's identity across TikTok, Instagram, and Facebook;
- bypassing provider capability, verification, region, review, or messaging-window restrictions;
- claiming production availability before TikTok grants access and a real-account acceptance test passes.

Automatic responses and Comment-to-Message remain later opt-in slices because they have additional account-entitlement and policy requirements.

## 5. Chosen architecture

Use a provider adapter connected to the existing provider-neutral social ingestion and conversation boundaries.

1. Keep TikTok OAuth, tokens, webhook verification, capability discovery, and send/download calls in a dedicated integration package and API module.
2. Register verified webhook payloads durably before queue dispatch.
3. Normalize supported TikTok events into the existing `NormalizedInboundMessage` contract extended with channel `TIKTOK`.
4. Reuse the shared social ingestion service for tenant-scoped conversation, message, attachment, and order-trigger persistence.
5. Route manual replies through the existing durable outbound message lifecycle while selecting a TikTok-specific sender adapter by channel.

Rejected alternatives:

- **Manual credentials or pasted access tokens:** faster for a private test but unsafe, difficult to rotate, and unacceptable for ordinary customers.
- **Copy the Instagram pipeline:** duplicates tenant, idempotency, attachment, order, retry, and recovery rules.
- **Build inbound only permanently:** needlessly limits the product when TikTok officially exposes send-message capabilities.
- **Ship automatic AI replies with the first connection:** combines provider approval risk with a higher customer-safety risk and obscures whether base transport is reliable.

## 6. Connection and authorization flow

### 6.1 Start

`POST /api/integrations/tiktok/authorize` is owner-only, CSRF-protected, feature-flagged, and lifecycle-aware. It creates a single-use, hashed, expiring OAuth attempt bound to tenant, user, and safe return path, then returns TikTok's authorization URL.

The merchant clicks `Connect TikTok`, signs in on TikTok, chooses the eligible account when offered, and grants only the approved Business Messaging permissions. Sales AITO never collects the merchant's TikTok password.

### 6.2 Callback and activation

The callback consumes OAuth state before external I/O, exchanges the authorization code server-side, validates granted scopes, encrypts credentials, resolves the authorized TikTok account, and verifies the token's `creator_id` against the returned `open_id`.

Activation succeeds only after:

1. the account identity is verified against the token;
2. the required inbound scopes are present;
3. the deployment-level Business Messaging webhook configuration is healthy;
4. the connection is atomically stored as active.

Missing optional outbound scope does not block inbound activation. It produces an inbound-only state with an explicit localized explanation. Missing inbound scopes fail safely with `TIKTOK_ACCOUNT_NOT_ELIGIBLE`. A send scope is not sufficient proof that a particular conversation accepts a reply; the outbound adapter checks TikTok's conversation-specific capability endpoint immediately before delivery.

### 6.3 Token refresh, reconnect, and disconnect

Access-token refresh is server-side and serialized per connection generation. A refresh failure fences outbound work and moves the connection to `RECONNECT_REQUIRED` without deleting already stored conversations.

Disconnect fences the credential generation first, revokes/destroys only that merchant's credentials, and records unresolved credential cleanup for retry. It must never delete or modify the shared developer-app webhook subscription. Reconnect cannot reactivate superseded credentials or allow old queued sends to use a new connection generation.

Only owners may connect, reconnect, or disconnect. Managers receive a read-only connection and capability summary.

## 7. Webhook and inbound processing

TikTok uses its own public callback route, for example `POST /webhooks/tiktok`. Exact challenge and signature fields are implemented from the provider contract available to the approved app; they are not inferred from Meta behavior.

Business Messaging webhook subscriptions are developer-app resources: Sales AITO owns one `DIRECT_MESSAGE` subscription for the production callback, not one subscription per merchant account. Deployment/startup verification creates or reconciles that shared subscription. Merchant OAuth activation only verifies that this platform-level prerequisite is healthy; merchant disconnect never deletes it.

Until that deployment-level reconciler is implemented and reports healthy, the OAuth module fails activation closed after safely revoking the newly issued merchant token. This prevents a workspace from appearing connected while its messages cannot reach Sales AITO.

Processing order:

1. Read the exact raw request body.
2. Verify TikTok's challenge/signature contract before business persistence.
3. Resolve the tenant only from the authoritative external TikTok account ID mapped to an active connection.
4. Persist a sanitized `WebhookEvent` using a TikTok namespace and provider event/message identifier, or a deterministic digest fallback.
5. Queue provider-specific normalization with at-least-once delivery.
6. Normalize to the shared inbound contract with channel `TIKTOK`.
7. Let shared ingestion create the conversation/message once, copy supported media into controlled storage, retain safe visible fallbacks, and invoke order recognition only for a newly created inbound message.

Unknown events are acknowledged and safely ignored. Malformed supported events receive a typed terminal outcome. Transient provider, broker, database, or object-storage failures retain retry and reconciliation behavior.

## 8. Message and attachment behavior

The channel contract expands additively to `INSTAGRAM | FACEBOOK | TIKTOK`.

Inbound representation:

- text is preserved as customer content;
- HTTP(S) links remain safe clickable links;
- supported images and videos are copied to controlled object storage before temporary provider URLs expire;
- mixed text and media remain one provider message with visible text and attachments;
- unsupported, unavailable, or failed media never becomes an empty bubble; it receives a localized placeholder and safe processing state;
- provider identifiers are scoped to channel and connected account.

TikTok display names and avatars are optional enrichment. Their absence cannot block message ingestion, order recognition, or rendering.

## 9. Outbound delivery rules

The API accepts a manual reply only when all are true:

- the authenticated user belongs to the conversation tenant and has an allowed role;
- the tenant and integration are operational;
- the conversation channel is `TIKTOK`;
- the connection generation is current and healthy;
- runtime account capability permits the requested message type;
- current TikTok messaging limits permit the send;
- the client-provided idempotency key has not already created the logical reply.

Accepted replies are stored as `PENDING` and dispatched through the queue. Provider success records TikTok's external message ID and transitions to `SENT`. Typed permanent rejection transitions to `FAILED`; ambiguous or transient outcomes are reconciled before another provider send is attempted. Browser retries and worker redelivery cannot create duplicate outbound messages.

Sales AITO does not hard-code an Instagram-style response window for TikTok. The adapter enforces the currently documented TikTok rule and capability response, while the UI uses provider-neutral blocked-reason contracts.

## 10. UI behavior

The social-channel hub keeps all channel rows collapsed by default and includes TikTok in the connected/total summary.

The TikTok row shows:

- account name and status;
- `Connect TikTok` when disconnected;
- granted capabilities after connection;
- inbound-only guidance when send capability is unavailable;
- reconnect guidance for expired/revoked credentials;
- owner-only reconnect and confirmed disconnect actions;
- read-only status for managers.

The conversation list and thread show a localized TikTok badge. The existing reply area selects capability by channel:

- enabled composer when a TikTok reply is allowed;
- disabled composer with a precise reason when authorization, entitlement, health, or provider rules block it;
- retry only for messages whose typed delivery state permits retry.

All actions use shared button variants and `LoadingButton`. Provider, permission, conflict, and outage failures stay at form level. Independently invalid controls use shared field validation, accessible error relationships, focus management, and value preservation. Desktop, mobile, keyboard, and screen-reader behavior follows the shared design system.

## 11. Data model and lifecycle

Add tenant-scoped models equivalent in lifecycle guarantees, not copied naming, to the existing social integrations:

- `TikTokConnection`: external account identity, encrypted credentials, expiry, capability snapshot, credential generation, status, health, and connected actor;
- `TikTokOAuthAttempt`: hashed state, tenant/user binding, expiry, consumption state, and safe return path;
- `TikTokCleanupOperation`: merchant credential revocation cleanup state and retry metadata. Shared webhook lifecycle does not belong to this tenant-scoped record.

Existing provider-neutral `Conversation`, `Message`, `Attachment`, `WebhookEvent`, and outbound delivery records remain canonical and gain `TIKTOK` channel support. Every new relation is tenant-scoped and covered by RLS/transaction-context tests.

Raw webhook retention, stored customer content, media objects, tenant export, tenant freeze, and eventual deletion follow the existing tenant lifecycle and EU data-protection contracts. Provider tokens and raw payloads never appear in exports, browser responses, metrics, or ordinary logs.

## 12. Security invariants

- OAuth state is random, hashed, short-lived, single-use, and consumed before token exchange.
- Access and refresh tokens are encrypted with the integration encryption facility and never exposed to the browser after callback.
- Tenant routing for a webhook comes only from an active external-account mapping, never a payload tenant field.
- Webhook authenticity is verified against the exact raw body before queueing.
- Provider responses are untrusted and parsed by strict boundary schemas.
- A connected external account can route to only one active tenant.
- Duplicate callbacks, callback races, refresh races, reconnect, and queue redelivery cannot duplicate messages, orders, or replies.
- Frozen tenants acknowledge authentic callbacks safely but create no new business side effects.
- Customer text, external user IDs, tokens, and raw provider errors are prohibited metric labels.
- Logs and user-facing errors use safe typed codes rather than provider payloads.

## 13. Observability and failure handling

Add low-cardinality metrics for authorization, capability checks, token refresh, verified/invalid callbacks, webhook registration, normalization, media copy, order triggering, reply acceptance, provider delivery, reconciliation, and connection state.

Safe error families include:

- `TIKTOK_AUTHORIZATION_DENIED`
- `TIKTOK_REQUIRED_SCOPES_MISSING`
- `TIKTOK_ACCOUNT_NOT_ELIGIBLE`
- `TIKTOK_INBOUND_CAPABILITY_MISSING`
- `TIKTOK_REPLY_NOT_PERMITTED`
- `TIKTOK_WEBHOOK_CONFIGURATION_FAILED`
- `TIKTOK_TOKEN_EXPIRED`
- `TIKTOK_RECONNECT_REQUIRED`
- `TIKTOK_DELIVERY_REJECTED`
- `TIKTOK_DISCONNECT_CLEANUP_FAILED`

Provider outages and unknown failures remain form- or operation-level errors. Raw TikTok messages are not surfaced. Operational dashboards report health and counts without customer content.

## 14. Verification

Implementation follows test-first, scoped increments and must include:

- contracts accepting `TIKTOK` while retaining Instagram and Facebook payloads;
- strict provider-client tests for authorization, token exchange/refresh/revoke, account identity, capability, app-level webhook configuration, conversation/message retrieval, media upload/download, and sending;
- OAuth owner/manager, state replay, expiry, missing scope, account collision, refresh race, reconnect, and cleanup tests;
- official or provider-console webhook fixtures for challenge, signature, duplicate registration, malformed supported events, and tenant isolation;
- normalizer coverage for text, link, image, video, mixed payload, unsupported attachment, echo/outbound event, and missing media;
- shared ingestion tests proving exactly one conversation, message, attachment set, and order trigger under duplicate delivery;
- outbound tests proving idempotent acceptance, one provider send, retry classification, reconciliation, stale credential fencing, and blocked capability behavior;
- RLS/transaction-context tests for every new tenant model and TikTok routing lookup;
- Ukrainian and English settings, inbox, thread, status, and error component tests;
- desktop, 390 px mobile, keyboard, and accessibility coverage;
- regression tests for Instagram and Facebook ingestion and Instagram replies;
- migration verification from current `master`, typecheck, production builds, full automated suite, and `git diff --check`.

No real tokens, business documents, customer messages, or production account identifiers may appear in fixtures or committed evidence.

## 15. Rollout and acceptance

Code ships behind disabled-by-default `TIKTOK_BUSINESS_MESSAGING_ENABLED`. Implementation completion changes the feature status to **Validation pending**, not **Available**.

Live enablement requires:

1. Sales AITO developer registration and Business Messaging API access;
2. TikTok security/privacy review completion;
3. production OAuth redirect and webhook URLs configured;
4. one controlled eligible Business Account authorized;
5. capability check evidence for inbound and, separately, outbound;
6. one real text and one real media message received exactly once;
7. one qualifying inbound message processed without duplicate order creation;
8. one manual text reply accepted and delivered exactly once when permitted;
9. reconnect and disconnect tested without credentials or personal content in evidence;
10. region/account eligibility confirmed in the provider console.

If TikTok withholds outbound capability, Slice A may proceed as inbound-only with truthful UI. If TikTok withholds inbound Business Messaging access, the channel remains disabled and **Planned** regardless of local implementation completeness.
