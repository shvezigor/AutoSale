# TikTok Business Messaging acceptance checklist

## Automated Slice A evidence

- [x] OAuth state is tenant/user-bound, hashed, expiring and single-use.
- [x] Credentials are encrypted, generation-fenced and never returned to the browser.
- [x] App-level `DIRECT_MESSAGE` webhook reconciliation is fail-closed.
- [x] Timestamped signatures are verified against the exact raw body before parsing.
- [x] Tenant routing uses only an active external account mapping.
- [x] Duplicate signed deliveries create one durable event, one message and one order trigger.
- [x] Text, image, video, shared-post and unsupported content have a visible safe representation.
- [x] Authenticated media is size-limited, hashed and copied into tenant-owned storage.
- [x] Token refresh uses a lease and stale credential generations cannot win a race.
- [x] Permanent refresh rejection requires reconnect instead of silently dropping messages.
- [x] Settings are collapsed by default, owner mutations are role-gated and managers are read-only.
- [x] Inbox/list/detail/onboarding render TikTok without changing Instagram or Facebook behavior.
- [x] Slice A exposes `CHANNEL_READ_ONLY` and no outbound composer.
- [x] Fictional opt-in browser acceptance verifies signed duplicate delivery and inbox rendering.

## Live inbound gate

- [ ] Sales AITO developer app has TikTok Business Messaging access and completed required review.
- [ ] Production OAuth callback and `DIRECT_MESSAGE` webhook URLs are registered exactly.
- [ ] Region and account eligibility are confirmed by TikTok for one controlled Business Account.
- [ ] Owner connects the account; manager sees only safe read-only status.
- [ ] One real text message appears exactly once with the TikTok label.
- [ ] One real image and one real video are copied to controlled storage and render safely.
- [ ] Re-delivery of the same provider event creates no second message or order trigger.
- [ ] One explicit purchase message invokes recognition once and creates no duplicate order.
- [ ] Reconnect replaces the credential generation without reviving the old token.
- [ ] Disconnect and any cleanup retry finish without exposing credentials or provider payloads.
- [ ] Evidence contains only statuses, counts and timestamps—no content, account IDs or tokens.

## Separate outbound gate

- [ ] TikTok has granted the required send capability for the app/account/region.
- [ ] Conversation-specific eligibility is checked immediately before send.
- [ ] One manual text reply is accepted and delivered exactly once.
- [ ] Transient/ambiguous results reconcile before any retry can contact TikTok again.
- [ ] Permanent rejection produces a localized safe reason and no optimistic `SENT` state.

Outbound remains out of scope for Slice A. Its unchecked items do not block an
inbound-only pilot, but the UI must continue to say that TikTok replies are not
available.
