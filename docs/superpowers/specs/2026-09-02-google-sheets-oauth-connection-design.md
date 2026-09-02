# Google Sheets OAuth Connection Design

## Purpose

AutoSale already contains Google Sheets adapters, catalogue synchronization, order export, and settings screens, but production access still depends on one server-wide service-account file. This design replaces that incomplete customer experience with a tenant-owned Google OAuth connection. A tenant owner signs in to Google once, explicitly selects spreadsheets through Google Picker, and AutoSale can then synchronize the selected files in background jobs without asking the owner to sign in again.

PostgreSQL remains the source of truth. Google Sheets is either an external catalogue source or an order-export destination; it is never the application database.

## Decisions

- AutoSale uses one production Google Cloud project and one OAuth web application for all tenants.
- The primary authorization scope is `https://www.googleapis.com/auth/drive.file`.
- Google Picker is the primary way to grant AutoSale access to an existing spreadsheet. Pasting a URL alone never implies access to a private file.
- OAuth requests use authorization-code flow, durable state, PKCE where supported, and `access_type=offline` so the server can obtain a refresh token.
- Refresh tokens are encrypted at rest and scoped to one tenant connection. Raw tokens are never returned by an API or written to logs.
- One Google connection may authorize multiple catalogue sources and order destinations selected by the owner.
- Catalogue sources and order destinations remain separate records and may refer to separate spreadsheets, separate tabs, or the same spreadsheet.
- A service-account connection may be added later as an advanced enterprise option. It is not part of the primary first-release flow.

## Google Cloud Configuration

The production project enables:

- Google Sheets API;
- Google Drive API;
- Google Picker API;
- Google Auth Platform for an external audience.

Production credentials consist of:

- an OAuth web client ID;
- an OAuth client secret stored only in server environment/secrets;
- a browser-visible Google Picker API key restricted to the `https://sales-aito.com` origin and the Picker API;
- the authorized JavaScript origin `https://sales-aito.com`;
- the exact redirect URI `https://sales-aito.com/api/integrations/google/callback`.

Development and production use separate Google Cloud projects or OAuth clients. Production branding, support email, homepage, privacy policy, terms, and authorized domains must match AutoSale before verification.

## Roles and Tenant Isolation

- Only a tenant `OWNER` may connect, reconnect, disconnect, or select Google files.
- A `MANAGER` may view safe connection and synchronization status but cannot obtain tokens or change authorization.
- A platform administrator may see aggregate connection health, error categories, and timestamps but cannot see Google account email, spreadsheet names, file IDs, source rows, products, orders, or tokens.
- Every connection, OAuth attempt, selected file, source, destination, job, and credential lookup is server-scoped by `tenantId`.

## Domain Model

### GoogleConnection

One active connection per tenant initially stores:

- tenant ID and connection status;
- Google subject ID as the stable external account identity;
- encrypted refresh token and credential generation ID;
- granted scopes;
- safe account email for display to the tenant owner only;
- connected-by user ID and connection timestamps;
- last verification timestamp and safe error category;
- disconnect and credential-cleanup state.

The access token is short-lived and normally held only in memory. If cached, it is encrypted and expires automatically. A reconnect that returns no new refresh token preserves the currently valid refresh token only after verifying that the Google subject matches the existing connection.

### GoogleOAuthAttempt

Every connection attempt stores a single-use, expiring, hashed state value, tenant/user binding, PKCE verifier where applicable, requested return path, and consumed timestamp. Callback handling rejects expired, reused, cross-tenant, or mismatched attempts.

### Selected Google File

Catalogue sources and order destinations store only the selected spreadsheet ID, selected tab identity/name, display label, connection ID, and validation state. They do not store browser access tokens. Deleting or disconnecting a Google connection pauses all dependent sources and destinations without deleting internal products or orders.

## Owner Connection Flow

1. The owner opens **Settings → Google Sheets** and selects **Connect Google**.
2. The API creates a durable OAuth attempt and redirects to Google authorization.
3. Google asks the owner to select an account and grant access to files explicitly used with AutoSale.
4. Google redirects to the exact AutoSale callback with an authorization code and state.
5. The API atomically consumes the state, exchanges the code server-side, obtains the Google subject/email, encrypts the refresh token, and activates the tenant connection.
6. AutoSale returns the owner to Google settings and shows the connected account without exposing credentials.
7. The owner selects **Choose spreadsheet**. Google Picker opens, filtered to Google Sheets.
8. Picker grants access to and returns the chosen file ID. The backend verifies the file with the tenant's connection, loads spreadsheet metadata, and returns selectable tabs.
9. The owner chooses whether the file is a catalogue source or order destination, selects a tab, and confirms it.
10. AutoSale validates the required operation and saves an active or review-required configuration.

The owner can repeat steps 7–10 to connect additional files without repeating OAuth while the connection remains valid.

## Catalogue Source Flow

For a catalogue source, AutoSale reads the selected tab and passes normalized headers, inferred types, and a bounded redacted sample to the existing AI mapping pipeline. AI may propose column mappings but cannot invent product data. The owner reviews and confirms the mapping before the first import or after any structural change.

After confirmation, **Synchronize now** and the configured schedule use the encrypted tenant refresh token to obtain a short-lived access token. Existing fencing, idempotency, mapping-version, and catalogue ownership rules remain unchanged. Revoked Google access pauses synchronization and preserves the last valid internal catalogue.

## Order Destination Flow

For an order destination, AutoSale verifies or creates the required header contract only after explicit owner confirmation. An approved order is exported idempotently by `order_id`: an existing row is updated and a missing row is appended. Catalogue synchronization never writes order rows, and order export never modifies catalogue products.

The owner may later configure destination column mapping, but the first release retains the current canonical required headers to limit scope.

## Interface

The Google settings screen shows:

- connection status and owner-visible Google email;
- connect, reconnect, and disconnect actions;
- separate **Product catalogues** and **Order exports** sections;
- a Google Picker action for each new source or destination;
- selected spreadsheet label and tab;
- access validation, last synchronization, next synchronization, and safe error summary;
- synchronize-now and retry actions where applicable.

The interface never asks a normal customer for a client secret, API key, service-account JSON, refresh token, or manual sharing email.

## Security and Credential Lifecycle

- Client secret and Picker API key restrictions are deployment configuration, not tenant data.
- Refresh tokens use authenticated encryption and a versioned application encryption key.
- OAuth callbacks, token exchange responses, authorization codes, and file contents are redacted from logs.
- State is single-use and bound to the authenticated owner, tenant, intended action, and safe return path.
- A disconnect first blocks new jobs, then revokes the Google grant when possible, deletes local credential material through a durable cleanup workflow, and marks dependent configurations paused.
- Credential rotation or replacement uses generation IDs so an old cleanup job cannot delete a newer connection.
- Background jobs load connection and tenant state from PostgreSQL; queue payloads contain internal IDs only.
- API keys are restricted by origin and API. They do not authorize spreadsheet data access.

## Error Handling

- A cancelled OAuth flow returns to settings with an actionable message and leaves the existing connection unchanged.
- Missing refresh tokens, subject mismatches, invalid state, and callback replay cannot replace an active credential.
- Revoked or expired grants mark the connection `REAUTHORIZATION_REQUIRED`, pause dependent jobs, and prompt the owner to reconnect.
- A pasted or Picker-returned file that is not accessible is not saved as active.
- Deleted files, renamed/deleted tabs, quota errors, and network errors preserve internal data and produce retryable or owner-actionable states.
- Structural catalogue changes pause before mutation and reopen mapping review.
- Repeated callbacks, Picker selections, sync requests, and export retries remain idempotent.

## Verification and Release

Automated coverage includes OAuth state consumption, tenant/user binding, callback replay, refresh-token preservation, subject mismatch, token encryption, disconnect cleanup, Picker file validation, tab selection, tenant isolation, revoked grants, and safe logging. Existing catalogue and order export tests are rerun with a tenant OAuth token provider instead of a global service account.

Staging acceptance requires a real test Google account to:

1. connect through OAuth;
2. select a private catalogue spreadsheet through Picker;
3. select a tab, approve AI mapping, and synchronize products;
4. select an order destination and export one approved order exactly once;
5. revoke Google access, observe a safe reauthorization state, reconnect, and recover without duplicated products or order rows;
6. disconnect and confirm that background access stops and stored credentials are removed.

Production release additionally requires configured branding, verified domains, published privacy/terms pages, least-privilege scopes, and completion of the Google verification path required for the final requested scopes.

## Migration from the Current Implementation

The current global `GOOGLE_SERVICE_ACCOUNT_FILE` remains usable only during development migration. OAuth-capable adapters receive a tenant credential provider, while catalogue and export domain logic continues to depend on the existing Google Sheets adapter interface. Once staging OAuth acceptance passes, production configuration no longer requires customers to share files with the global service account, and the service-account path is disabled by default.

Existing Google source/destination configurations remain paused until an owner connects Google and explicitly reselects or validates each spreadsheet. No internal products, orders, mappings, or historical export records are deleted during migration.

## Delivery Boundary

This work includes Google Cloud setup documentation, OAuth connection lifecycle, Picker selection, tenant credential storage, integration of OAuth credentials into existing catalogue and export workers, settings UI, tests, and production acceptance. It does not include Google sign-in as AutoSale authentication, arbitrary Drive browsing outside Picker, broad Drive scopes, multiple Google accounts per tenant, or service-account onboarding for customers.
