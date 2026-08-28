# Meta Instagram OAuth and Local Tunnel — Design

**Status:** Approved for implementation planning  
**Date:** 2026-08-28  
**Initial environment:** Docker Compose on a local Windows computer, exposed through an ngrok free development domain

## 1. Objective

Replace manual Instagram Account ID configuration with a safe, tenant-aware “Connect Instagram” flow. A customer organization owner authorizes its own Instagram Professional account through Meta, while AutoSale stores the resulting credential securely and routes webhook events to the correct tenant.

The first deployment remains local and portable. Meta reaches the local Docker stack through a stable ngrok development domain; after a production domain is purchased, the public URL can be changed without changing business logic.

## 2. Supported Accounts and API

- Instagram Professional Business accounts.
- Instagram Professional Creator accounts.
- Meta's Instagram API with Instagram Login.
- MVP permissions: `instagram_business_basic` and `instagram_business_manage_messages`.
- Personal Instagram accounts are not supported.
- Browser scraping, password collection, and unofficial session automation are prohibited.

The Meta Graph API version is configured explicitly through the environment so upgrades are intentional and testable.

## 3. Public Connectivity

### Development

ngrok exposes Caddy on local port 80 through a stable free `*.ngrok-free.app` hostname:

```text
Meta -> HTTPS ngrok domain -> localhost:80 -> Caddy -> API / Web
```

The relevant public routes are:

- OAuth callback: `https://<ngrok-domain>/api/integrations/instagram/callback`
- Meta webhook: `https://<ngrok-domain>/webhooks/meta`

The computer, Docker Desktop, AutoSale containers, and ngrok process must remain running. No public IP address, router port forwarding, or inbound firewall rule is required.

### Production

A purchased domain will point to a named Cloudflare Tunnel or another HTTPS reverse proxy. `APP_PUBLIC_URL` is the only public-origin setting used to derive browser redirects and callback URLs. Meta Dashboard settings must be updated when the origin changes.

## 4. Authorization Flow

1. An authenticated tenant owner opens Instagram settings and clicks **Connect Instagram**.
2. The API creates a cryptographically random, single-use OAuth state bound to the current user, tenant, and intended return path. Only a hash is stored, with a short expiration.
3. The API redirects the browser to Meta authorization with the configured app ID, callback URL, and required scopes.
4. Meta redirects to the callback with an authorization code and state.
5. The API atomically consumes and validates the state before exchanging the code server-side.
6. The API obtains the professional Instagram account identity and a long-lived access token, then validates the granted scopes.
7. The API encrypts the token and upserts the connection for the current tenant.
8. The API subscribes the connected account to the required webhook fields.
9. The browser returns to settings and displays the connected account and operational status.

Authorization codes and tokens never enter frontend JavaScript, URLs rendered by the application, analytics, or ordinary logs.

## 5. Tenant and Role Boundaries

- A tenant has at most one active Instagram connection in the first release.
- Only the tenant `OWNER` may connect, reconnect, or disconnect Instagram.
- Tenant managers may see that the channel is active but cannot access credentials.
- Platform administrators may see only operational metadata such as status, timestamps, error category, and tenant identifier. They cannot see tokens, message contents, customer profiles, or tenant business data.
- Webhook routing continues to use the unique external Instagram account ID and resolves it to exactly one tenant.

## 6. Credential Storage

`InstagramConnection` is extended with:

- external Instagram account ID and display username/name;
- encrypted access-token payload;
- token expiration timestamp when supplied by Meta;
- granted scopes;
- connection state (`ACTIVE`, `REAUTH_REQUIRED`, `ERROR`, `DISCONNECTED`);
- last successful verification timestamp;
- sanitized last error code/category;
- connected-by user and connection timestamps.

Tokens use authenticated encryption (AES-256-GCM) with a random nonce per value. `INTEGRATION_ENCRYPTION_KEY` is supplied as a deployment secret and is never stored in the database or repository. Ciphertext includes a format/key-version marker to allow future key rotation.

Existing manually configured account IDs remain readable during migration, but the production interface no longer treats a bare ID as an active authenticated connection.

## 7. API and UI Boundaries

### API

- `GET /api/integrations/instagram` — safe connection summary.
- `POST /api/integrations/instagram/connect` — create state and return/perform Meta redirect.
- `GET /api/integrations/instagram/callback` — validate state, exchange code, persist connection, subscribe webhook.
- `POST /api/integrations/instagram/disconnect` — revoke/unsubscribe where supported and disable locally.

The callback produces a short-lived success/error result and redirects to the settings page. Provider error text is normalized before it is shown to users.

### Settings UI

The Instagram card displays one of: not connected, connecting, active, reauthorization required, or error. It provides connect, reconnect, and disconnect actions plus the connected username and last verification time. Manual Account ID entry is removed from the normal user flow; it may remain behind an explicit development-only flag until migration is complete.

## 8. Webhook Integration

The existing `/webhooks/meta` endpoint remains the sole webhook entry point.

- Verification uses the deployment's `META_VERIFY_TOKEN`.
- Incoming POST requests retain `X-Hub-Signature-256` verification with `META_APP_SECRET`.
- The external account ID is resolved against an active authenticated connection.
- Unknown, disconnected, or ambiguous accounts are rejected from business processing and logged only with safe identifiers.
- Durable event registration and deduplication remain unchanged.

## 9. Disconnect and Failure Behavior

- Disconnect is explicit and confirmation-protected in the UI.
- Existing conversations, orders, and audit history are retained.
- The encrypted credential is deleted or rendered unusable and the connection is marked disconnected.
- If remote unsubscribe/revocation fails, local access is still disabled and a retryable sanitized operational event is recorded.
- Expired or rejected tokens transition the connection to `REAUTH_REQUIRED`; the system does not repeatedly retry unauthorized calls.
- OAuth state reuse, expiry, tenant mismatch, or invalid callback parameters fail closed.

## 10. Configuration

Required deployment variables:

```text
APP_PUBLIC_URL=https://<stable-ngrok-domain>
META_APP_ID=<meta-app-id>
META_APP_SECRET=<meta-app-secret>
META_VERIFY_TOKEN=<random-webhook-verification-token>
META_GRAPH_API_VERSION=<pinned-version>
INTEGRATION_ENCRYPTION_KEY=<32-byte-key-in-documented-encoding>
```

Secret values are placed in local `.env` only, which remains excluded from Git. `.env.example` contains placeholders and format guidance.

## 11. Meta Developer App Setup Guide

Implementation includes a Ukrainian operator guide covering:

1. Creating a Meta developer account and app with the appropriate business use case.
2. Adding Instagram API with Instagram Login.
3. Adding the test Business and Creator accounts and accepting tester access where required.
4. Registering the exact OAuth redirect URI.
5. Configuring the webhook callback URL and verify token.
6. Selecting message-related webhook subscriptions and required permissions.
7. Copying App ID/App Secret into local secrets without committing them.
8. Running ngrok with the assigned stable domain.
9. Testing connect, callback, webhook verification, inbound message routing, reconnect, and disconnect.
10. Understanding Development Mode versus Live Mode, Standard Access versus Advanced Access, and the later App Review requirements.

Screens and labels in Meta may change; the guide identifies both the purpose of each setting and its expected value rather than relying only on screenshots.

## 12. Testing

- Unit tests for OAuth URL creation, state hashing/expiry/single use, callback validation, encryption round trips, safe serialization, and role checks.
- Integration tests for successful connection, provider rejection, duplicate callback, tenant isolation, reconnect, and disconnect.
- Existing webhook signature, deduplication, and tenant-routing tests remain mandatory.
- Frontend tests cover connection states and owner-only controls.
- A manual staging checklist uses a real Meta test app, ngrok domain, and test Professional accounts.

Meta network calls are represented by a narrow adapter and mocked in automated tests. No real credentials are needed for CI.

## 13. Rollout

1. Add the encrypted credential and OAuth-state schema with a reversible migration.
2. Add configuration validation and the Meta OAuth adapter.
3. Add owner-only API endpoints and audit events.
4. Replace manual settings UI with connection-state UI.
5. Add the ngrok and Meta Developer App guide.
6. Run automated tests and local Docker verification.
7. Perform a real test-account connection only after the user supplies Meta app credentials.

The release does not claim live Instagram readiness until the real callback, subscription, and inbound message test pass end to end.

