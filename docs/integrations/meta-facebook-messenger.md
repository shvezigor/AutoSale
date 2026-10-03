# Meta Facebook Messenger setup and acceptance

## Current status

Facebook Page Messenger inbound is implemented behind
`FACEBOOK_MESSENGER_ENABLED=false` and remains **Validation pending**. The
current slice receives new Page messages, stores them in the shared inbox and
may invoke the existing order-recognition flow. It does not send Facebook
replies, import history, process comments/Marketplace, or connect personal
Messenger accounts.

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
- permissions `pages_show_list`, `pages_manage_metadata`,
  `pages_read_engagement` and `pages_messaging`;
- the Page `messages` webhook subscription.

The connecting owner must have a Page task that permits messaging. Live
messages from people without an app/Page role require the applicable Meta
Advanced Access/App Review approval. Provider requirements can change; verify
the current [Messenger Platform documentation](https://developers.facebook.com/docs/messenger-platform/)
before production enablement.

## Owner flow

1. Set the dedicated Facebook credentials, then enable
   `FACEBOOK_MESSENGER_ENABLED=true` in API and worker only for the controlled
   environment. Restart both and confirm health. The API deliberately refuses
   to start with the feature enabled and missing/partial Facebook credentials.
2. Open **Settings -> Social networks / customers -> Facebook** as an owner.
3. Choose **Connect Facebook** and authorize the requested Page permissions.
4. If more than one eligible Page exists, select one. Sales AITO activates it
   only after identity verification and webhook subscription succeed.
5. Return to Settings and verify the safe Page name and active status.

Managers see connection status without mutation controls. OAuth state is
single-use and hashed. Candidate Page tokens live encrypted for at most ten
minutes; the selected Page token remains encrypted and never reaches the
browser, normal logs or metrics.

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

Set `FACEBOOK_MESSENGER_ENABLED=false` in both API and worker and restart them.
This stops new Facebook connection and ingestion work without deleting stored
conversations. A signed callback may still be acknowledged safely while the
feature is disabled. For a single tenant, disconnect the Page from Settings;
if Meta unsubscribe has an unknown outcome, allow the recorded cleanup job to
finish before reconnecting.

Do not claim general availability until all live checklist items are complete.
