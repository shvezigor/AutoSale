# Facebook Messenger inbound channel design

**Date:** 2026-10-02  
**Status:** Implemented behind a disabled-by-default flag; live Meta validation pending
**Owner:** Sales AITO social channels

## 1. Purpose

Add Facebook Page Messenger as the second customer conversation channel in Sales AITO. A workspace owner connects one Facebook Page, after which new customer messages from that Page appear in the existing inbox and may enter the existing AI order-recognition flow.

The integration is for a Facebook **Page inbox**, not a person's private Facebook account. Instagram remains independently connectable and must continue to work when Facebook is disconnected, expired, or unavailable.

## 2. MVP scope

The first production slice includes:

- owner-only Facebook Login and selection of one manageable Facebook Page per tenant;
- encrypted storage of the selected Page access token and safe connection status;
- Page webhook subscription for Messenger message events;
- signed `object: page` callback validation and durable, idempotent registration;
- inbound text, image, video and safe HTTP(S) link normalization;
- a visible unsupported-attachment placeholder for other payload types instead of an empty message;
- provider-neutral persistence into the existing `Conversation`, `Message`, `Attachment` and order-trigger flow with channel `FACEBOOK`;
- Facebook-labelled conversations in the existing desktop and mobile inbox;
- a collapsed Facebook row beside Instagram in `Settings -> Social networks / customers`;
- reconnect, disconnect, audit, lifecycle-freeze and sanitized observability behavior consistent with Instagram.

## 3. Explicit non-goals

This slice does not include:

- sending or retrying Facebook replies from Sales AITO;
- importing historical Messenger conversations;
- comments, reactions, leads, posts, ads, Marketplace or personal Messenger chats;
- multiple Facebook Pages in one tenant;
- merging the same human's Facebook and Instagram profiles;
- automated customer responses;
- claiming live availability before Meta permissions, App Review and a real Page acceptance test pass.

Facebook conversations therefore expose a read-only reply capability with reason `CHANNEL_READ_ONLY`. The existing Instagram reply composer and delivery rules remain Instagram-only.

## 4. Provider constraints

Facebook Messenger uses Facebook Login and a Page access token. It cannot reuse the current Instagram Login token, whose authorization host, scopes and Graph base URL are Instagram-specific.

The implementation requests only the Page permissions needed for this slice: `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement` and `pages_messaging`. A connecting person must have a Page task that permits messaging. Production conversations with people who do not have an app or Page role require the relevant Meta Advanced Access/App Review approval.

The Graph API version remains centrally configured by `META_GRAPH_API_VERSION`. Provider responses are untrusted and are parsed by strict boundary schemas. Access tokens, signed callback material and raw provider errors never enter browser responses, metrics or ordinary logs.

Primary references verified on 2026-10-02:

- [Meta Messenger Platform API](https://www.postman.com/meta/messenger-platform-api/documentation/iyp204x/messenger-platform-api)
- [Meta Messenger Conversations API](https://www.postman.com/meta/messenger-platform-api/folder/22794852-255610cd-47f5-4f4d-b3fa-71aec360be9a)
- [Meta Messenger Platform samples](https://github.com/fbsamples/messenger-platform-samples)

## 5. Chosen architecture

Use a hybrid extension:

1. Keep Facebook authorization and credential lifecycle separate from Instagram because the providers issue different token types, permissions and product credentials. Facebook OAuth and Page webhook signatures use dedicated `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET`; Instagram continues to use `META_APP_ID` / `META_APP_SECRET`.
2. Extend the current Meta webhook boundary to route verified Instagram and Page entries by object type.
3. Convert both providers into one internal `NormalizedInboundMessage` contract.
4. Move shared conversation/message/attachment persistence and order triggering behind a provider-neutral ingestion service.

This avoids two rejected extremes:

- **Copy the Instagram pipeline:** fastest initially, but duplicates tenant, idempotency, attachment, order and recovery rules and makes future channels costly.
- **Replace every Instagram table and service with one generic Meta subsystem immediately:** architecturally tidy, but creates a high-risk migration unrelated to receiving the first Facebook messages.

The hybrid approach is additive. Existing Instagram stored data, event identities, prompts and delivery behavior keep their current meaning.

## 6. Connection and authorization flow

### 6.1 Start

`POST /api/integrations/facebook/authorize` is owner-only, CSRF-protected and lifecycle-aware. It creates a single-use, hashed, expiring OAuth attempt bound to tenant, user and return path, then returns the Facebook authorization URL.

### 6.2 Callback and Page selection

`GET /api/integrations/facebook/callback` consumes the state before provider exchange. It exchanges the code server-side, validates the granted permissions, obtains only Pages the user may message as, and never sends a user or Page access token to the browser.

- Zero eligible Pages: finish with safe error `FACEBOOK_NO_ELIGIBLE_PAGE`.
- One eligible Page: select it automatically.
- Multiple eligible Pages: store encrypted, short-lived candidate credentials in the OAuth attempt and redirect to the Facebook settings panel for explicit selection.

`POST /api/integrations/facebook/selection` accepts only a candidate Page ID from the current unexpired attempt. The API verifies membership in the server-side candidate set before activation.

### 6.3 Activation

Activation verifies Page identity and token usability, subscribes the Page to `messages`, and only then atomically replaces the active connection. A failed subscription cannot produce an `ACTIVE` local connection.

The connection stores the Page ID, Page name, encrypted Page token, token metadata when supplied, credential generation ID, connected user and safe health fields. One Page can route to only one active tenant.

### 6.4 Disconnect and reconnect

Disconnect first fences the local credential generation, then attempts Page unsubscribe and local credential destruction. Unknown provider outcomes use the existing durable cleanup pattern: no old token returns to an active row, retry progress is recorded per operation, and reconnect is blocked only while an unresolved cleanup can race with the new credential.

Managers receive a read-only connection summary. Only owners see connect, select, reconnect and disconnect actions.

## 7. Webhook and ingestion flow

The existing public `GET/POST /webhooks/meta` endpoint remains the single Meta callback.

1. Verify `X-Hub-Signature-256` against the exact raw body before parsing or persistence.
2. Reject payloads whose object is neither `instagram` nor `page`.
3. For each entry, resolve the tenant using the authoritative external account/Page ID and an active, non-expired connection.
4. Persist a sanitized `WebhookEvent` before queueing. Facebook event identities use the namespace `facebook:<mid>` or a deterministic `facebook:sha256:<digest>` fallback, avoiding collisions with legacy Instagram identities.
5. Dispatch to a provider-specific normalizer through the social inbound queue. Queue delivery is at-least-once; the database unique constraints remain the source of idempotency.
6. Normalize to:

```ts
interface NormalizedInboundMessage {
  channel: 'INSTAGRAM' | 'FACEBOOK';
  externalMessageId: string;
  externalConversationId: string;
  participantId: string;
  senderId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  text: string | null;
  sourceTimestamp: Date;
  attachments: Array<{
    type: 'IMAGE' | 'VIDEO' | 'LINK' | 'UNSUPPORTED';
    sourceUrl: string;
  }>;
}
```

7. The shared ingestion service upserts the channel-scoped conversation, creates the message once, copies supported media to controlled storage, records visible fallbacks for unsupported attachments, and invokes the existing order trigger only for a newly created inbound message.

Provider echoes and non-message events are ignored safely in the inbound-only Facebook slice. Malformed supported events fail with a safe terminal code; transient storage/media failures retain retry behavior.

## 8. Conversation and customer presentation

The public conversation contracts change additively from the Instagram literal to `INSTAGRAM | FACEBOOK`. The inbox displays a localized channel badge and preserves its current tenant-scoped pagination and sort order.

The provider-neutral conversation record remains the canonical thread. Facebook Page-scoped sender IDs are never treated as global Facebook identities. For MVP, a conversation may initially display the safe fallback `Facebook customer`; optional Page-scoped profile enrichment may update its display name later without blocking message ingestion. A missing profile or avatar never makes the message invisible.

The order-recognition boundary receives the channel as data. Existing Instagram prompt-version audit values remain unchanged; new evaluations use a provider-neutral social-order prompt version and retain the source message and channel.

## 9. UI behavior

The social-channel hub keeps all rows collapsed by default and reports `connected / total` across Instagram and Facebook.

The Facebook row shows:

- Page name and safe status when connected;
- `Connect Facebook` for an owner when disconnected;
- an accessible Page selector when an OAuth attempt has multiple eligible Pages;
- reconnect guidance for expired/revoked credentials;
- a confirmation step for disconnect;
- read-only status without mutation buttons for managers.

All actions use shared button variants and `LoadingButton`. Provider, permission, conflict and outage failures stay at form level with localized safe messages. The Page selector uses shared form controls, field-level validation, focus management and value preservation.

The inbox and settings must have no horizontal overflow at 390 px, work with keyboard navigation, and expose channel/status through text rather than color alone.

## 10. Security and tenancy invariants

- The authenticated principal supplies tenant and role; client-provided tenant IDs are never trusted.
- Webhook tenant resolution is derived only from the external Page ID mapped to an active connection.
- Every Facebook connection, OAuth attempt, cleanup, webhook, conversation, message and attachment relation is tenant-scoped and covered by RLS/transaction-context tests.
- OAuth state is single-use, hashed, short-lived and consumed before external I/O.
- Page candidate tokens and the selected Page token are encrypted with the existing integration encryption facility.
- Raw callbacks are signature-verified before registration against the matching Instagram or Facebook product secret and sanitized before persistence.
- Provider payloads, tokens, customer text, Page-scoped user IDs and personal profile data are prohibited metric labels.
- Frozen tenants acknowledge valid Meta callbacks without creating business side effects, consistent with the existing lifecycle contract.
- Disconnect, reconnect, callback races and duplicate callbacks cannot reactivate a superseded credential or create duplicate messages/orders.

## 11. Observability and recovery

Add low-cardinality metrics for verified/invalid Page callbacks, registration outcomes, normalization outcomes, attachment-copy outcomes and Facebook connection state. Reuse the webhook reconciliation mechanism so a durable `RECEIVED` event can be queued again after a broker failure.

Safe operational error codes include:

- `FACEBOOK_AUTHORIZATION_DENIED`
- `FACEBOOK_REQUIRED_SCOPES_MISSING`
- `FACEBOOK_NO_ELIGIBLE_PAGE`
- `FACEBOOK_PAGE_SELECTION_EXPIRED`
- `FACEBOOK_SUBSCRIPTION_FAILED`
- `FACEBOOK_TOKEN_EXPIRED`
- `FACEBOOK_RECONNECT_REQUIRED`
- `FACEBOOK_DISCONNECT_CLEANUP_FAILED`

Raw Meta error text stays internal and redacted. Retryability is derived from typed provider status/code information rather than user-visible strings.

## 12. Verification

Implementation follows test-first increments and must include:

- contracts accepting `FACEBOOK` while retaining existing Instagram payloads;
- Facebook client tests for URL/scopes, token exchange, strict response parsing, eligible Page discovery, subscription and unsubscribe;
- OAuth state, owner/manager authorization, multiple-Page selection, stale attempt, callback race and cleanup tests;
- signed `object: page` fixture acceptance, invalid signature rejection and deterministic duplicate registration;
- normalizer coverage for text, image, video, link, unsupported attachment, echo and malformed supported event;
- shared ingestion coverage proving one conversation/message/order trigger under duplicate delivery;
- tenant-isolation/RLS tests for every new table and Page routing lookup;
- inbox/settings component tests in Ukrainian and English;
- desktop, 390 px mobile and keyboard E2E coverage;
- regression tests for the existing Instagram webhook, inbox, media and order path;
- typecheck, production builds, migrations from current `master`, full automated suite and `git diff --check`.

## 13. Rollout and acceptance

The code may be merged behind a disabled-by-default `FACEBOOK_MESSENGER_ENABLED` flag. The feature-map status becomes **Validation pending** only after implementation and automated verification.

Live enablement requires all of the following:

1. exact production callback and OAuth redirect URLs configured in Meta;
2. required permissions and Advanced Access/App Review approved for the Sales AITO Meta app;
3. one controlled Facebook Page connected by an owner;
4. one real text and one real image message received exactly once;
5. one qualifying message processed by the order-intent flow without duplicate order creation;
6. reconnect and disconnect checked without tokens or personal message content in evidence.

Until those checks pass, UI and documentation must say validation is pending rather than generally available.

