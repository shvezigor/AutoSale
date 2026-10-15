# Current Implementation Plan: AI Reply Draft Controlled Pilot

## Goal and ownership

Close every reachable safety and browser gate in the [AI reply draft acceptance checklist](../docs/acceptance/ai-reply-drafts-checklist.md) without turning manager-reviewed drafts into autonomous sends. Reuse the existing reply-draft processor, claim validator, conversation composer and provider adapters. The owner authorizes test-account changes, but each concrete Instagram message still requires action-time confirmation. Do not send a customer reply unless that exact text and recipient are confirmed.

## Ordered pilot tasks

### P1 — Verify remaining factual and failure boundaries

- [x] Add focused fictional-data regressions for missing currency, ambiguous product identity, unsupported commercial promises, model timeout and provider outage, fixing the observed shipping-promise and arbitrary-single-product defects in the existing worker boundary.
- Acceptance: no unsupported price, product, discount, delivery or availability claim reaches a ready draft; provider failure remains visible and does not spend a second model call.
- Verification: focused worker tests, full worker suite, typecheck and build. Depends on none. Likely files: reply-draft processor/validator specs and, only if necessary, their existing implementations. Scope: medium.

### P2 — Verify reachable live Instagram draft paths

- [ ] In the consenting test-account conversation, send only specifically confirmed inbound test messages for missing-currency and ambiguous/promise requests; observe one inbound and one safe ready/failed draft per message, then reload and verify persistence and no unintended outbound.
- The first approved missing-currency question exposed stale stock-intent carry-over; a focused test-first worker fix is green (374 tests, one skipped; typecheck/build green). Release `d966db5` was manually deployed with validated backup and healthy runtime checks. One fresh owner-approved price question then produced a safe price-check draft after the quiet period and preserved it after browser reload; neither the historical incorrect draft nor the new draft was sent. A separate owner-approved ambiguous entrance-door question produced a persisted clarification instead of an arbitrary single-product recommendation. The approved next-day shipping question exposed an irrelevant generic fallback despite no unsafe promise; a focused test-first shipping-specific clarification passed 376 worker tests (one skipped), typecheck and build. Release `c385405` was manually deployed with a verified backup and healthy services/queue; repeat the live case with new exact-message consent.
- Acceptance: no ungrounded monetary or commercial promise is displayed; the editor and source disclosure accurately represent each result.
- Verification: real Instagram and Sales AITO browser evidence, plus read-only runtime health. Depends on P1 and action-time user confirmation for each batch of exact Instagram text. Scope: medium.

### P3 — Audit provider-dependent gates without inventing eligibility

- [x] Check the existing Facebook copy-only and TikTok eligibility contracts and UI tests; determine whether a permitted test account exists. Audit the Instagram 24-hour to seven-day `HUMAN_AGENT` path against existing tests and the live test conversation's age. The current workspace exposes Instagram only; no eligible Facebook/TikTok live account is available. A consented manual Instagram attempt after 24 hours returned durable `INSTAGRAM_HUMAN_AGENT_UNAVAILABLE`, pending Meta App Review.
- Acceptance: record which paths are verified and which need a real eligible account or elapsed reply window; do not send to unrelated customers or manipulate production clocks/provider credentials.
- Verification: focused API/web/worker tests and safe browser read-only checks where possible. Depends on none. Scope: medium.

### P4 — Publish evidence and release

- [x] Update canonical feature documentation, index, acceptance and backlog to distinguish closed gates from external prerequisites; if code changed, back up and manually deploy tested `master`, then verify public health, queues and browser behavior. Releases `8a28bed` and `d966db5` were merged/pushed and manually deployed after validated backups; public health and `ai_replies` backlog were healthy. The historical error state was verified in the browser; the fresh P2 acceptance remains separately open.
- Acceptance: no full-pilot claim while a live provider gate remains open; scoped branch merged/pushed and removed; unrelated `artifacts/` untouched.
- Verification: diff check, tests, deployment and browser evidence as applicable. Depends on P1–P3. Scope: medium.

### Checkpoints

- [x] After P1: tests/typecheck/build pass with fictional fixtures.
- [ ] After P2: each approved test-account message and resulting draft is visible after reload, with no unapproved customer reply. The missing-currency price and ambiguous-product cases passed; the unsupported-promise live case needs a fresh post-deployment inbound check.
- [x] After P4: `master` matches origin, production release is healthy if changed, and residual provider gates are explicit.

## Risks and stop conditions

- Instagram sends are externally visible: require the owner's confirmation of exact sender, recipient and text at the moment of sending.
- A production provider outage must not be induced by disabling live credentials or queues; exercise it in isolated tests.
- Facebook/TikTok eligibility and the `HUMAN_AGENT` interval may be unavailable today. In that case preserve a truthful validation-pending status and specify the precise missing prerequisite.

---

# Previous Implementation Plan: Platform Administration Workspace

## Overview

Build the approved `platform-admin-workspace` vertical slice: a privacy-safe administrator shell with an operational overview, client organization table/detail and background queue monitoring. The canonical behavior is defined in `docs/superpowers/specs/2026-10-02-platform-admin-workspace-design.md`.

## Architecture decisions

- Reuse the current `PLATFORM_ADMIN` authorization boundary and `/admin` redirect behavior.
- Reuse `platform_tenant_directory()` and `platform_order_counts()`; do not bypass RLS or add business-data queries.
- Inspect BullMQ through narrow queue-monitor interfaces and return counts/worker metadata only.
- Keep the admin shell separate from tenant navigation, search and notifications.
- Keep lifecycle controls on the client detail page, not in the table or overview.
- Use existing design tokens, shared button variants and locale infrastructure.

## Dependency graph

```text
A1 contracts + safe API aggregates
  -> A2 admin shell
      -> A3 overview dashboard
      -> A4 clients table
          -> A5 client detail/actions
      -> A6 operations monitor
          -> A7 responsive/browser/security verification
```

## Task list

### Phase 1: Safe platform data

- [x] A1: Add typed overview/operations contracts and a privacy-safe admin API.

**Acceptance:** aggregates match tenant summaries; queue states are classified deterministically; queue inspection failures are safe and never expose job data.

**Verify:** API service/controller tests and contracts tests.

**Likely files:** contracts auth, admin service/controller/module and focused specs.

**Dependencies:** none.

### Phase 2: Admin navigation and overview

- [x] A2: Add the responsive admin shell, navigation and localized copy.
- [x] A3: Replace the old card page with KPI and operations-attention overview.

**Acceptance:** desktop sidebar/mobile drawer work by keyboard; overview renders only approved aggregates and real monitoring state.

**Verify:** shell/dashboard component tests plus web typecheck.

**Dependencies:** A1.

### Checkpoint: Overview

- [x] Focused API and web tests pass.
- [x] `/admin` loads without tenant navigation or business-data links.

### Phase 3: Client management

- [x] A4: Add the searchable, filterable and sortable client table.
- [x] A5: Add client detail with block/unblock and existing lifecycle controls.

**Acceptance:** row click, keyboard activation and explicit action open detail; unknown ids return 404; mutations show confirmation/loading/failure feedback.

**Verify:** table/detail tests and controller regression tests.

**Dependencies:** A1, A2.

### Checkpoint: Client flow

- [x] Client list-to-detail path works on desktop and mobile.
- [x] Privacy assertions exclude customer/order content and workspace links.

### Phase 4: Operations and release evidence

- [x] A6: Add the queue/service operations page and safe status presentation.
- [x] A7: Complete responsive, accessibility, security and full regression verification; update canonical status.

**Acceptance:** all configured queues are visible with counts, workers and pending age; 390 px layout does not overflow; full tests/typecheck/build pass.

**Verify:** focused tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, browser acceptance and diff/security review.

**Dependencies:** A1-A5.

### Checkpoint: Complete

- [x] All spec success criteria are met.
- [x] Canonical feature index reports evidence-based status.
- [ ] Scoped commits are merged to `master`, pushed and the feature branch is removed.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Admin monitoring accidentally exposes job or tenant content | High | Fixed response schemas, narrow monitor interfaces and explicit sensitive-field tests |
| No worker appears as a false incident for an unused queue | Medium | `IDLE` when both worker and backlog are absent; `ATTENTION` only for failures or unserved pending work |
| Large tenant list becomes unwieldy | Medium | Client-side search/filter/sort for the current slice; pagination remains a measured follow-up |
| Existing lifecycle actions regress during relocation | High | Reuse the component unchanged and retain its focused tests |
| Admin mobile navigation diverges from workspace behavior | Medium | Reuse the existing drawer/focus pattern and verify at 390 px |

## Open questions

None block implementation. Historical charts, alert delivery, server-level infrastructure probes and queue mutations are explicitly deferred.
