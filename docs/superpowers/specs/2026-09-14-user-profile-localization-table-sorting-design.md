# User profile, localization, and table sorting design

Date: 2026-09-14
Status: approved design

## Problem and outcome

AutoSale currently mixes company settings with a minimal header identity, has no editable personal profile, exposes Ukrainian copy directly in components, and cannot sort paginated catalogue or order data. The outcome is a clear personal profile, a production-grade Ukrainian/English interface, and stable server-side sorting that works with search, filters, and pagination.

The primary actor is any authenticated user. Tenant owners additionally see their company role and retain access to team management. Managers receive the same personal-profile capabilities without gaining tenant-owner permissions.

## Current facts

- `User` currently stores email, name, an optional password hash, status, and platform role.
- A separate `GoogleIdentity` marks accounts linked to Google sign-in.
- The header profile menu currently links to company settings and, for owners, the team page.
- User-facing strings are written directly in React components and API error responses.
- Catalogue and order lists are paginated on the server.
- Catalogue and orders are the current product tables; both already have search, pagination, row numbers, and mobile card layouts.
- Personal notification settings remain in their current settings section and are outside this project.

## Decisions

The work ships as four sequential checkpoints:

1. Personal profile and header-menu improvements.
2. Localization foundation followed by complete Ukrainian and English coverage.
3. Server-side sorting for catalogue and orders.
4. Cross-device regression testing, deployment, and live verification.

Each checkpoint is independently tested, committed, pushed to `master`, deployed, and verified on `sales-aito.com`.

Rejected approaches:

- A single large release couples unrelated failure modes and delays usable improvements.
- Client-only translation and sorting would lose persisted preferences and sort only the current page.

## Scope

### Included

- An authenticated `/profile` page.
- Editable name and optional international mobile phone number normalized to E.164.
- Read-only email, role, registration date, last-login date, and sign-in method.
- User avatar upload, replacement, deletion, and initials fallback.
- Password change for users with a local password.
- Ukrainian and English locale preference.
- A fast `UA` / `EN` header switcher.
- Typed translations for all user-visible web application copy.
- Localized labels for stable domain and API error codes.
- Server-side sorting for catalogue and orders.
- Accessible desktop sort headers and a compact mobile sort control.

### Not included

- Changing the account email.
- Storing a home or personal address.
- Moving or redesigning notification settings.
- Giving Google-only users a local password.
- Translating customer messages, product names, or other tenant content.
- Adding languages other than Ukrainian and English.

## Profile domain model

Extend `User` with:

- `phone`: nullable normalized E.164 phone number.
- `locale`: required enum-like value, initially `uk` or `en`, defaulting to `uk`.
- `avatarStorageKey`: nullable private-object key.
- `avatarChecksum`: nullable content version used for safe cache invalidation.
- `avatarContentType`: nullable allowlisted MIME type.
- `lastLoginAt`: nullable timestamp updated only after successful authentication.

The existing `name`, `email`, `passwordHash`, `createdAt`, and `GoogleIdentity` remain authoritative. Sign-in method is derived rather than duplicated:

- a non-null `passwordHash` means local email/password sign-in is available;
- an attached `GoogleIdentity` means Google sign-in is available;
- the current UI distinguishes local-only, Google-only, and linked accounts if both mechanisms exist in historical data.

Profile data belongs to the user, not a tenant membership. Updating a name therefore updates the identity shown in every workspace and in tenant member lists. Role remains membership-specific and read-only.

## Profile API

Add an authenticated profile module with explicit contracts:

- `GET /api/profile` returns safe personal data, role for the active tenant, sign-in methods, avatar URL, and account timestamps.
- `PATCH /api/profile` accepts only `name`, `phone`, and `locale`.
- `POST /api/profile/avatar` accepts one multipart image.
- `DELETE /api/profile/avatar` removes the current avatar.
- `POST /api/profile/password` accepts current password, new password, and confirmation.
- `GET /api/media/profile/avatar` serves the authenticated user's controlled avatar copy.

Mutations require an authenticated session and CSRF protection. Contracts reject unknown fields. Users can act only on their own `userId`; tenant identifiers are never accepted from the request body.

Profile responses expose stable capability flags such as `canChangePassword` rather than exposing whether a password hash exists. Email is read-only in the API. Password mutations never return password material.

Changing a password verifies the current password, hashes the replacement using the existing password service, records a security audit entry, and revokes every other active session for the user. The current session remains active.

## Avatar handling

Accepted uploads are JPEG, PNG, and WebP up to 5 MB. Validation uses decoded file content, not only the filename or request MIME type. The server:

1. validates and decodes the upload;
2. corrects orientation;
3. center-crops it to a square;
4. outputs a bounded WebP avatar;
5. stores it under a random private key;
6. updates the user record transactionally;
7. schedules the replaced object for deletion only after the new reference is committed.

External image URLs are not accepted. The media endpoint serves the stored object inline with an allowlisted content type, private cache policy, and checksum-based version. Missing or invalid images produce initials in the UI.

## Profile user interface

The `/profile` page is responsive and contains four focused sections:

1. **Photo and personal information**: avatar, name, read-only email, optional phone, and active membership role.
2. **Interface language**: Ukrainian and English choices with immediate preview and persistence.
3. **Security**: a password-change form for local-password users, or a read-only “Sign in with Google” explanation for Google-only users.
4. **Account**: registration date, last login, sign-in method, and sign out.

Forms preserve entered values after recoverable failures. Field errors appear adjacent to their field. Pending buttons retain their dimensions and show a spinner. Success and general failure use the global right-side toast system.

The header profile menu contains:

- **My profile** for every authenticated user;
- **Team** for tenant owners only;
- **Sign out**.

The company-settings link is removed from this menu because it already exists in primary navigation. The trigger and page avatar update after a successful profile mutation without requiring a manual browser reload.

## Localization architecture

Use one shared typed translation system for the authenticated and authentication route groups. Do not duplicate pages or add locale segments to URLs.

Locale resolution order is:

1. the authenticated user's persisted `User.locale`;
2. the locale cookie for unauthenticated pages;
3. a supported browser language;
4. Ukrainian fallback.

The only supported locale identifiers are `uk` and `en`. The cookie stores only that identifier and uses appropriate secure, same-site, and path settings. User preference remains the source of truth after login.

Translation resources are grouped by product area rather than component filename: common, authentication, navigation, profile, conversations, orders, catalogue, team, settings, delivery, integrations, notifications, validation, and errors. Ukrainian is the canonical completeness shape; English must satisfy the same typed key structure.

The localization provider supplies the active locale, typed translation lookup, date/number formatters, and a locale mutation. Server-rendered pages receive the resolved locale so the initial HTML is already in the correct language and does not flash Ukrainian before changing to English.

The header shows a compact `UA` or `EN` button. Its menu exposes both languages. A selection keeps the current pathname and query parameters, persists the preference, and refreshes server-rendered content without redirecting to a different route. The same control appears in the profile page.

All user-visible application copy is translated, including navigation, authentication, profile, conversations, orders, catalogue, team, settings, delivery, integration cards, validation messages, dialogs, empty states, loading states, toasts, statuses, and date/number formatting.

Customer messages, catalogue content, customer names, and other business data are rendered verbatim. Stable codes such as `AUTO_APPROVED` and `NOVA_POSHTA` remain unchanged in storage and transport; the UI maps them to localized labels.

API errors introduced or touched by this work expose stable error codes. The web layer maps known codes to translations and uses one localized generic fallback for unknown or unavailable errors. Sensitive backend details never become translated client copy.

## Sorting contracts and data flow

Sorting is server-side and encoded in existing list URLs:

- `sort`: an allowlisted field name;
- `direction`: `asc` or `desc`.

Invalid or unsupported values safely fall back to the list default. Search, filters, page size, and sorting survive navigation and pagination. Changing a sort field or direction resets the page to 1.

Every sort uses a deterministic secondary key so pagination remains stable when primary values are equal.

### Catalogue sorting

Allowed fields:

- `sku`;
- `name`;
- `price`;
- `stock`;
- `status`.

Default: `name asc`, then stable product ID. Null price or stock values are placed consistently after concrete values in both directions. Search and tenant scoping are applied before ordering and pagination.

### Order sorting

Allowed fields:

- `product`;
- `customer`;
- `status`;
- `procurement`;
- `confidence`;
- `date`.

Default: `date desc`, then order ID. Derived values use explicit database expressions or stored sortable columns; the implementation must not fetch an unbounded tenant result set for in-memory sorting. If a derived field cannot be expressed efficiently in the first delivery, the plan must add the necessary stored projection or index before exposing that sort option.

## Sorting user interface

On desktop, sortable column headings are buttons. The active heading exposes `aria-sort` and a clear direction icon. The first activation uses the field's natural direction; subsequent activation toggles it. Non-sortable number and action columns remain plain headings.

On mobile, table cards are preceded by a compact “Sort by” field and an ascending/descending direction control. It uses the same URL state and server response as desktop. Cards do not contain tiny per-field sort icons.

Row numbers continue to represent position in the current sorted result: `(page - 1) * pageSize + local index + 1`.

A reusable sort model and UI primitive are shared by catalogue and orders so later tables can adopt the same behavior without copying URL or accessibility logic.

## Authorization, privacy, and audit

- Profile reads and writes are self-scoped.
- Membership role and account email are read-only.
- Password and avatar mutations are rate-limited.
- Audit events record profile-field categories and mutation outcomes, never passwords, image bytes, or old/new phone values.
- Avatar object keys are not exposed directly.
- Locale contains no sensitive data and can be safely cached as a two-value preference.
- Sorting parameters are parsed through allowlists and never interpolated into raw SQL.

## Failure behavior

- A failed profile save preserves edits and reports field-specific problems when available.
- A failed locale save restores the previous locale and shows a localized toast.
- A failed avatar replacement retains the current avatar and cleans up any unreferenced new object.
- A failed avatar deletion retains the database reference until object/reference cleanup can complete safely.
- An incorrect current password returns a generic localized validation error and is rate-limited.
- Missing translation keys fail type checking or tests; production lookup still uses a safe Ukrainian fallback.
- Invalid sort parameters return the default ordering rather than an error page.
- Sorting an empty list preserves the empty-state message and controls.

## Observability

Add structured, privacy-safe events for:

- profile update succeeded/failed by field category;
- avatar upload, replacement, and deletion outcome;
- password-change outcome and other-session revocation count;
- locale changed from supported locale to supported locale;
- invalid sort parameter fallback by list and parameter name.

No event contains password values, file content, phone numbers, names, customer data, or arbitrary query text.

## Rollout checkpoints

### Checkpoint 1: profile

- Database migration and profile contracts/API.
- Avatar storage and controlled delivery.
- Profile page and header menu.
- Password capability behavior for local and Google-only users.
- Ukrainian UI initially, with locale preference ready for checkpoint 2.

### Checkpoint 2: localization

- Typed localization foundation and locale resolution.
- Header/profile language control.
- Translation of all user-visible web areas in small, testable route groups.
- Stable localized API error-code mapping.

### Checkpoint 3: sorting

- Catalogue list contract, query, desktop header, and mobile control.
- Order list contract, query/projections, desktop header, and mobile control.
- Shared sort primitives and URL-state tests.

### Checkpoint 4: release verification

- Full type check, test suite, and production build.
- Desktop and mobile browser checks in both languages.
- Live verification after deployment.

## Acceptance criteria

### Profile

- An authenticated user can open `/profile` from the header.
- The user can update their own name and optional phone, and the header reflects the result.
- The user can upload, replace, and delete a valid avatar; invalid or oversized files are rejected without losing the current avatar.
- Email, active role, dates, and sign-in methods are displayed but cannot be edited.
- A local-password user can change their password after supplying the current password.
- A Google-only user sees the Google sign-in state and no password form.
- Other active sessions are revoked after a password change; the current session remains usable.
- A manager cannot read or modify another user's profile.

### Localization

- A user can switch between Ukrainian and English from the header or profile.
- The choice persists across routes, refreshes, and later sessions.
- Switching keeps the current route, filters, and selected record.
- All user-visible application chrome and feedback exists in both languages.
- Tenant and customer content remains unchanged.
- Translation resources are type-checked for completeness.

### Sorting

- Catalogue and order results sort across the complete filtered result set.
- Sort state works with search, filters, pagination, page size, and return navigation.
- Desktop controls expose the active direction accessibly.
- Mobile controls are usable without horizontal table interaction.
- Invalid query values fall back safely.
- Equal values do not cause records to move unpredictably between pages.

## Test plan

- Contract tests for all profile payloads, locale values, and sort parameters.
- API integration tests for self-scope, CSRF, password verification, session revocation, upload validation, and media authorization.
- Storage tests for successful replacement and cleanup failure paths.
- Component tests for profile forms, Google-only state, stable loading buttons, toasts, and header updates.
- Translation completeness tests and route-level Ukrainian/English rendering tests.
- Locale resolution and persistence tests for authenticated and unauthenticated users.
- Repository tests for every allowed sort, null handling, tenant scope, deterministic tie-breakers, filtering, and pagination.
- Component tests for `aria-sort`, URL preservation, page reset, and mobile sort controls.
- Responsive browser checks for the profile, header menu, catalogue, and orders.
- Full monorepo type check, test suite, production build, deploy health check, and live smoke test.
