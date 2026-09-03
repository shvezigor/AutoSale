# Google Sign-In for AutoSale

**Date:** 2026-09-03  
**Status:** Approved in chat; awaiting review of this written specification

## Problem and outcome

Prospective tenant owners currently have to register with email and password, verify the email, and then log in. AutoSale needs a lower-friction Google sign-in that can create a new owner and workspace, while safely linking an existing password account when Google returns the same verified email.

The affected actor is a tenant owner. Managers continue to join through the existing invitation flow, and platform administrators remain isolated from tenant customer data.

## Scope

Build now:

- Add **Continue with Google** to login and registration pages.
- Authenticate with Google using only OpenID Connect identity scopes: `openid`, `email`, and `profile`.
- Sign in an already linked Google identity.
- Link a new Google identity to an existing AutoSale user only when Google confirms the email is verified and the normalized email matches exactly.
- For a new email, issue a short-lived onboarding grant and ask the user for a business/workspace name.
- Atomically create an active user, tenant, and active `OWNER` membership after onboarding.
- Issue the existing HttpOnly AutoSale session after sign-in or onboarding.
- Allow Google-only users to establish a password later through the existing password-reset flow.
- Record privacy-safe security audit events and enforce rate limits.

Defer:

- Other identity providers.
- Selecting among multiple existing tenant memberships during login.
- Importing Google contacts, profile photos, Drive files, or Sheets during sign-in.
- Replacing the separate Google Sheets/Drive authorization flow.
- Account unlinking UI. It requires a separate recovery-policy design so users cannot lock themselves out.

## Architecture decision

Google identity authentication and Google Sheets authorization are separate OAuth flows, even when they use the same Google Cloud project and OAuth client.

- Sign-in requests only identity scopes and never stores Google access or refresh tokens.
- Sheets authorization remains tenant-owner initiated in Settings, requests its existing Drive/Sheets scope, and stores an encrypted refresh token in `GoogleConnection`.
- The two callbacks, state records, services, audit actions, and redirect allowlists remain distinct.

This prevents login from requesting unnecessary business-data access and prevents a personal login identity from silently becoming a tenant integration credential.

## Domain model

Add `GoogleIdentity`:

- `id`: UUID primary key.
- `userId`: required relation to `User`, cascade on user deletion.
- `googleSubject`: immutable Google `sub`, globally unique.
- `emailAtLink`: normalized verified email observed when linked.
- `createdAt` and `lastUsedAt`.
- Unique `userId` for the first version: one Google identity per AutoSale user.

Add `GoogleSignInAttempt`:

- Hashed opaque `state`, expiry, one-time `usedAt`, and a sanitized local `returnPath`.
- Optional hashed onboarding grant and expiry after a successful callback for a new user.
- Stores only the minimum verified identity claims needed until onboarding: Google subject, normalized email, and display name.
- Claims are cleared or the attempt is consumed when onboarding completes.

Change `User.passwordHash` to nullable. Password login rejects a user without a hash using the same neutral `Invalid credentials` response. Password reset can create the first hash for an active Google-only user.

No Google ID token, access token, refresh token, authorization code, raw OAuth state, or raw onboarding grant is persisted.

## User flows

### Existing linked identity

1. User selects **Continue with Google**.
2. API creates a one-time sign-in attempt and redirects to Google.
3. Callback validates and consumes state, exchanges the code, and validates the ID token.
4. API finds `GoogleIdentity.googleSubject`, updates `lastUsedAt`, creates the normal AutoSale session, and redirects to the safe local return path.

### Existing password account with the same email

1. Google returns an ID token with `email_verified=true`.
2. No identity exists for the subject, but an active AutoSale user has the same normalized email.
3. In one transaction, AutoSale verifies that neither the subject nor user is linked elsewhere, creates `GoogleIdentity`, and records an automatic-link audit event.
4. AutoSale creates the normal session and redirects.

Email matching is never used when Google reports an unverified email. A subject already linked to another user is a conflict and is not relinked.

### New owner and workspace

1. Callback validates Google identity but finds no AutoSale user for the subject or email.
2. API creates a single-use, short-lived onboarding grant and redirects to `/onboarding/google` without creating a user or tenant.
3. The page displays the verified email and suggested display name as read-only context and asks for the business name.
4. Submission consumes the onboarding grant and, in one transaction, creates an active user with no password, a tenant, an active `OWNER` membership, and `GoogleIdentity`.
5. API creates the normal session and redirects to `/conversations`.

Concurrent or repeated submissions are idempotent: only one user, tenant, membership, and identity can be created. A consumed or expired grant returns the user to login with a safe error.

## API and UI

New public API routes:

- `POST /api/auth/google/start` with an optional safe local `returnPath`; returns an authorization URL.
- `GET /api/auth/google/callback`; validates provider response and redirects to the application.
- `GET /api/auth/google/onboarding`; returns limited pending identity context when an onboarding cookie/grant is valid.
- `POST /api/auth/google/onboarding`; accepts only `tenantName`, consumes the grant, creates the account, and sets the session cookie.

The start endpoint is rate-limited by IP prefix. Callback and onboarding failures use neutral public messages and detailed internal audit codes.

UI changes:

- Add a Google button and visual separator to both login and registration forms.
- Preserve a validated `next` path through sign-in for existing users.
- Add `/onboarding/google` with one required business-name field, loading, expired, validation, and retry states.
- Do not show or request a password during Google onboarding.

## Provider validation

The Google client validates:

- OAuth callback state is present, unexpired, single-use, and stored only as a hash.
- ID token signature against Google keys.
- `iss` is an allowed Google issuer.
- `aud` matches the configured AutoSale OAuth client ID.
- `exp` is in the future and `iat` is reasonable.
- `sub`, `email`, and `email_verified=true` are present.
- Authorization denial, missing code, token-exchange failure, and malformed claims do not create or link accounts.

Redirects accept only local absolute paths beginning with one `/`, reject protocol-relative paths, backslashes, control characters, and auth/onboarding loops, and fall back to `/conversations`.

## Security, privacy, and audit

- Reuse the existing secure, HttpOnly, `SameSite=Lax` session cookie.
- Use a separate short-lived HttpOnly onboarding cookie or an equally protected opaque grant; never put Google claims in a browser-readable token.
- Enforce database uniqueness for Google subject and normalized user email.
- Redact email, codes, state, tokens, and cookies from logs.
- Audit `GOOGLE_SIGN_IN_STARTED`, `GOOGLE_SIGN_IN_SUCCEEDED`, `GOOGLE_IDENTITY_LINKED`, `GOOGLE_ONBOARDING_COMPLETED`, and safe failure codes.
- Do not grant Sheets access, create a `GoogleConnection`, or persist provider credentials during sign-in.

## Configuration and Google Cloud

Reuse the current Google Cloud project. The existing OAuth client may be reused if it supports both callback URLs, but configuration must expose a distinct sign-in callback URL and identity scopes.

Required production redirect URI:

`https://sales-aito.com/api/auth/google/callback`

Environment validation must ensure that sign-in client ID, client secret, callback URL, and public URL are either all configured or all absent. Secrets remain server-only. Google OAuth consent branding, authorized JavaScript origins, production redirect, and domain verification are documented and manually verified.

## Error handling and recovery

- Provider cancellation returns to login with a non-sensitive message.
- Expired or replayed state fails without exchanging credentials or mutating users.
- Email or subject conflicts fail closed and create a security audit event.
- If account creation succeeds but session creation fails, the user can repeat Google sign-in and enter through the now-linked identity.
- Temporary Google outages do not alter existing password login or Sheets connections.
- Existing password registration, verification, login, reset, invitations, and platform-admin authentication remain compatible.

## Telemetry

Record counters and durations without personal data:

- sign-in starts, callbacks, successes, cancellations, validation failures;
- existing linked sign-ins, automatic email links, and completed new-workspace onboardings;
- onboarding abandonment and expiry;
- provider/token-exchange latency and failure category.

Initial success metric: at least 80% of users who reach a valid new-user callback complete workspace onboarding, with zero duplicate users or tenants in replay/concurrency tests.

## Rollout

1. Ship schema and backend behind `GOOGLE_SIGN_IN_ENABLED=false`.
2. Configure and verify the production callback in Google Cloud.
3. Enable for the project owner and test existing-account link plus new-workspace onboarding.
4. Enable the buttons for all users.
5. Monitor callback failures, conflicts, onboarding completion, and session errors; disable the flag without affecting password login or Sheets.

## Test plan and acceptance criteria

- Unit tests validate state hashing, expiry, one-time consumption, safe redirects, ID-token claims, and nullable-password login.
- Service tests cover linked sign-in, verified-email automatic link, new onboarding, conflict, replay, concurrent completion, disabled feature, and provider cancellation.
- Controller tests verify cookies, redirects, rate limits, neutral errors, and no token leakage.
- Database integration tests prove uniqueness and atomic user/tenant/identity creation.
- Web tests cover Google buttons, preserved `next`, onboarding validation, expiry, and successful redirect.
- End-to-end tests exercise password regression, existing-account link, new-workspace creation, logout/login, password establishment, and separation from Google Sheets scopes/credentials.
- `pnpm test` and the production Docker build must pass before rollout.

