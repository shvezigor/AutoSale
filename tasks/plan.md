# Current Implementation Plan: Platform Administration Workspace

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
