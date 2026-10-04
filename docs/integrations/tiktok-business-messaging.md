# TikTok Business Messaging setup and recovery

## Current status

TikTok Business Messaging inbound is implemented behind
`TIKTOK_BUSINESS_MESSAGING_ENABLED=false` and remains **Validation pending**.
The current inbound slice receives new direct messages, normalizes supported text,
image, video and shared-post content into the shared inbox, and may invoke the
existing order-recognition flow. Outbound foundations now define the provider
send contract and accept tenant-safe, idempotent manual replies into durable
local `PENDING` state while pinning them to the current credential generation.
The worker now refreshes the pinned generation, rechecks outbound capability
and the 48-hour conversation window, then settles the durable delivery state.
Known-safe provider rejections may be retried within a fixed bound; timeouts,
5xx responses and expired in-flight leases become `UNKNOWN` and are never
automatically resent. The shared conversation composer now enables manual text
replies only when the API reports that the specific TikTok conversation is
eligible. It preserves the draft and reuses the same local idempotency key after
an uncertain browser failure. The integration does not
import message history, process comments or connect personal TikTok accounts.

Provider access, business/account eligibility and regional availability are
decided by TikTok. A Ukrainian FOP may apply using the documents offered by
TikTok, but Sales AITO must not promise approval or substitute its own
verification for the provider's decision.

## Responsibility split

Sales AITO's operator creates and owns one TikTok for Business developer app,
completes provider security/privacy review, configures production URLs and
stores the app credentials on the server. A workspace owner only clicks
**Connect TikTok**, signs in on TikTok and authorizes an eligible Business
Account. The merchant never pastes an access token or gives Sales AITO a
TikTok password.

## Developer app configuration

Configure the provider app with:

- OAuth callback: `<APP_PUBLIC_URL>/api/integrations/tiktok/callback`;
- Business Messaging webhook: `<APP_PUBLIC_URL>/webhooks/tiktok`;
- the provider-issued account-holder authorization URL;
- the minimum approved inbound Business Messaging scopes;
- the `DIRECT_MESSAGE` webhook event.

The webhook is app-scoped, not tenant-scoped. API startup reconciles the
registered callback with TikTok. Incoming callbacks are accepted only after
the timestamped `TikTok-Signature` HMAC is verified against the exact raw body.
Tenant identity is then resolved only from an active external TikTok account
mapping.

Set these secrets only in the deployment secret store or local uncommitted
environment file:

```text
TIKTOK_CLIENT_ID=<provider app id>
TIKTOK_CLIENT_SECRET=<provider app secret>
TIKTOK_AUTHORIZATION_URL=<provider-generated HTTPS authorization URL>
```

Set `TIKTOK_BUSINESS_MESSAGING_ENABLED=true` for both API and worker only in a
controlled environment after all three values are present. API and worker
deliberately refuse incomplete enabled configuration. Never include values,
OAuth codes, signatures, raw payloads or customer content in logs or evidence.

## Workspace owner flow

1. Open **Settings -> Social networks / customers -> TikTok**.
2. Choose **Connect TikTok** and complete authorization on TikTok.
3. Return to Sales AITO and confirm the safe account label and inbound status.
4. Send a new controlled direct message to the authorized Business Account.
5. Confirm it appears once in **Conversations** with the TikTok label.

Managers can read the connection state but cannot connect or disconnect an
account. When TikTok does not grant send capability, requires reconnect, or the
48-hour reply window is closed, the conversation shows a disabled composer with
a precise localized reason. The UI never implies that a reply was sent before
provider confirmation.

## Health, refresh and recovery

- A healthy API startup means the configured app-level webhook matches the
  expected public callback. Webhook reconciliation failure keeps the TikTok
  integration unhealthy instead of silently receiving nowhere.
- The worker reuses fresh encrypted credentials and refreshes before expiry
  under a database lease. Concurrent jobs must perform at most one refresh.
- A permanent refresh rejection moves the connection to reconnect-required;
  the owner must authorize it again from Settings.
- Reconnect creates a new credential generation. Stale jobs cannot overwrite
  or revive the previous generation.
- Disconnect revokes provider access where possible and removes local access.
  An ambiguous provider result remains a durable cleanup operation and exposes
  only a safe retry action to the owner.
- Durable `RECEIVED` webhook events are reconciled after queue outages; a
  duplicate provider delivery cannot create a second message or order trigger.

Use privacy-safe counters, lifecycle states and timestamps for diagnosis.
Never inspect or retain message text, account IDs, access tokens or raw
provider responses as routine operational evidence.

## Controlled acceptance

Use a dedicated fictional/test Business Account. The opt-in browser test needs
`E2E_TIKTOK_CONNECTED=1`, `E2E_TIKTOK_ACCOUNT_ID`, fictional owner credentials,
and the same test-app ID/secret used by the isolated stack. It posts a signed
fictional event twice and proves that the shared inbox stores one TikTok
message with tenant-safe reply capability. It must never target a production
customer account.

The live checks and safe evidence rules are maintained in
[`tiktok-business-messaging-checklist.md`](../acceptance/tiktok-business-messaging-checklist.md).

## Disable and rollback

Set `TIKTOK_BUSINESS_MESSAGING_ENABLED=false` in both API and worker and restart
them. This stops authorization and TikTok processing without deleting stored
conversations. Keep the provider webhook configured while diagnosing only if
the API remains able to authenticate and safely acknowledge callbacks; remove
or disable it in the TikTok console when the API endpoint is being retired.

For one tenant, disconnect the account in Settings and allow any durable
cleanup operation to finish before reconnecting. Do not delete connection or
event rows manually. Re-enable only after API/worker health, migrations and the
automated suite pass.

Do not claim general availability until TikTok grants the required access and
all inbound live checks pass. Outbound replies remain behind a separate
acceptance gate until automated end-to-end and controlled live checks are complete.
