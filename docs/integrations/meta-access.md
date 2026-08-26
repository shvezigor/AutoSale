# Meta integration access

## Local verification — 2026-08-26

- Docker migration container applied `20260826090000_init_webhook_events` successfully.
- API and proxy health checks succeeded.
- `GET /webhooks/meta` returned the supplied challenge for the configured local verification token.
- Automated tests verify valid and invalid `X-Hub-Signature-256` callbacks, durable registration, and replay suppression.

## Staging verification pending

The live Meta callback cannot be configured until the project owner supplies a test Instagram Professional account, Meta app ID, app secret, page access token, webhook verification token, and permission to configure a public HTTPS callback URL. No secrets or message content belong in this document.
