# Meta Facebook Messenger setup and acceptance

## Current status

Facebook Page Messenger inbound is implemented behind
`FACEBOOK_MESSENGER_ENABLED=false` and remains **Validation pending**. The
current slice receives new Page messages, stores them in the shared inbox and
may invoke the existing order-recognition flow. It does not send Facebook
replies, import history, process comments/Marketplace, or connect personal
Messenger accounts.

Production onboarding of Pages owned by customer business portfolios is
blocked until the business portfolio that owns the Sales AITO Meta app passes
Meta Business Verification and the app receives the applicable App Review /
Advanced Access approvals. Verification of a customer's business portfolio
does not replace verification and review of the Sales AITO app owner.

## Meta application configuration

Use the shared Sales AITO Meta application and configure:

- Facebook Login redirect URI:
  `<APP_PUBLIC_URL>/api/integrations/facebook/callback`;
- Messenger webhook callback: `<APP_PUBLIC_URL>/webhooks/meta`;
- the shared `META_VERIFY_TOKEN` and `META_GRAPH_API_VERSION` used by the
  deployed API/worker;
- dedicated `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET` from the Meta app's
  Facebook Login/Messenger configuration. Do not reuse the Instagram Login
  product credentials stored in `META_APP_ID` / `META_APP_SECRET`;
- permissions `pages_show_list`, `pages_manage_metadata` and
  `pages_messaging`; `pages_read_engagement` is intentionally not requested
  because the inbound Messenger slice does not read Page posts or engagement;
- the Page `messages` webhook subscription.

The connecting owner must have a Page task that permits messaging. Page
discovery accepts both Meta's classic `MESSAGING` task and the New Pages
Experience `PROFILE_PLUS_MESSAGING` task; other Page tasks remain ineligible.
Live messages from people without an app/Page role require the applicable Meta
Advanced Access/App Review approval. Provider requirements can change; verify
the current [Messenger Platform documentation](https://developers.facebook.com/docs/messenger-platform/)
before production enablement.

Meta Standard Access is suitable only for controlled development with app-role
users and assets eligible for that app. A Page merely shared to the app owner's
portfolio by a partner business can still be visible in the authorization UI
while remaining absent from Graph `/me/accounts`; do not treat the OAuth asset
picker as proof that the Page is API-eligible. For a pre-review live test, use a
dedicated fictional Page owned directly by the same business portfolio as the
Meta app. This test does not prove that external customer Pages can connect.

### Business verification evidence

Meta verifies the registered business behind the app-owner portfolio rather
than the legal form implied by the product name. A registered sole proprietor
may attempt verification using current official evidence that matches the
legal name and official address or phone number. Meta currently lists business
registration/licence documents, government-issued business tax documents,
business bank statements and limited-purpose utility bills as supported
evidence. Provider acceptance remains case-specific; never promise approval.

The current Meta help list does not include Ukrainian among supported document
languages. Ukrainian evidence therefore needs an English translation carrying
the official stamp of a translation agency. Keep the portfolio's legal details
aligned with the evidence; a similarly named company discovered in public
sources must not be selected when it is not the app owner's legal business.
See [Meta's accepted business verification documents](https://www.facebook.com/business/help/159334372093366).

## Owner flow

1. Set the dedicated Facebook credentials, then enable
   `FACEBOOK_MESSENGER_ENABLED=true` in API and worker only for the controlled
   environment. Restart both and confirm health. The API deliberately refuses
   to start with the feature enabled and missing/partial Facebook credentials.
2. As a platform administrator, open **Admin -> Integrations** and enable
   **Facebook Messenger**. The deployment flag is a hard ceiling: the browser
   cannot enable a deployment whose app configuration is unavailable.
3. Open **Settings -> Social networks / customers -> Facebook** as an owner.
4. Choose **Connect Facebook** and authorize the requested Page permissions.
5. If more than one eligible Page exists, select one. Sales AITO activates it
   only after the Page token resolves its own identity through Graph `/me`,
   that identity matches the selected Page, and webhook subscription succeeds.
6. Return to Settings and verify the safe Page name and active status.

Managers see connection status without mutation controls. OAuth state is
single-use and hashed. Candidate Page tokens live encrypted for at most ten
minutes; the selected Page token remains encrypted and never reaches the
browser, normal logs or metrics.

Callback failures are recorded as safe stage-level audit codes without Page
tokens or provider response bodies. `FACEBOOK_PAGE_VERIFICATION_FAILED`
identifies failure while verifying the selected Page and
`FACEBOOK_SUBSCRIPTION_FAILED` identifies failure while subscribing that Page
to the `messages` webhook. Use these codes for controlled troubleshooting;
the failure audit and operational warning may additionally include only the
Meta stage, HTTP status and numeric provider code/subcode. Never add OAuth
codes, access tokens or raw Meta payloads to logs.

## Controlled acceptance

Use a fictional or dedicated test Page and retain only status/count/timestamp
evidence. Never retain access tokens, callback signatures, message text,
Page-scoped user IDs or raw provider payloads.

- [ ] Owner connects exactly one Page; manager sees read-only status.
- [ ] One real text message appears once with a Facebook channel label.
- [ ] One real image message appears once and media is copied to controlled
      storage.
- [ ] Re-delivering the same signed event creates no second message.
- [ ] One explicit purchase message invokes order recognition once and creates
      no duplicate order.
- [ ] The conversation explains that Facebook replies are not available in
      this slice and renders no Instagram reply composer.
- [ ] Reconnect replaces the credential generation without reviving the old
      token.
- [ ] Disconnect removes local access; any ambiguous unsubscribe is completed
      by durable cleanup without exposing provider data.

The opt-in browser scenario uses `E2E_FACEBOOK_CONNECTED=1`,
`E2E_FACEBOOK_PAGE_ID`, fictional owner credentials and `META_APP_SECRET`
against an isolated environment where that Page is already connected. It must
never target a production customer Page.

## Rollback and recovery

For an operational pause, first disable **Facebook Messenger** in **Admin ->
Integrations**. Existing encrypted credentials, Page identity, conversations
and messages remain stored. New OAuth activation and Facebook event persistence
stop immediately; correctly signed callbacks are still acknowledged to avoid
provider retry storms. Events received only during the pause are not guaranteed
to be replayed. The Facebook gate is applied after Meta event classification,
so Instagram ingestion on the shared endpoint remains independent.

For a deployment emergency, set `FACEBOOK_MESSENGER_ENABLED=false` in API and
worker and restart them. To recover, restore and verify the dedicated server
configuration first, set the deployment flag to true, restart and confirm
health, then enable the runtime control in **Admin -> Integrations**. For a
single tenant, disconnect the Page from Settings; this cleanup action remains
available during a platform pause. If Meta unsubscribe has an unknown outcome,
allow the recorded cleanup job to finish before reconnecting.

Do not claim general availability until all live checklist items are complete.
