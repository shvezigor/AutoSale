# ADR 0003: Workspace assistant actions over existing domain services

**Date:** 2026-10-25

**Status:** Accepted by the owner on 2026-10-25; implementation remains planned.

## Context

Sales AITO needs voice-guided onboarding first and later access to order, message and other workspace operations. The product already has authenticated tenant APIs, domain services, RLS, lifecycle freeze, audit and durable provider outboxes. A voice-only implementation must not become a second source of business rules or stronger authority than the signed-in user.

## Decision

Use OpenAI Realtime as the initial speech/conversation adapter and an explicit typed action registry in the existing NestJS API. The server owns authorization, prepared operations, confirmation and domain execution. The authenticated workspace uses WebRTC audio and presents application-owned previews/results. Voice and button confirmations bind to one immutable operation; model output cannot grant confirmation. Invoke existing domain services through shared validation/permission boundaries and transaction-aware methods where needed.

Buttons and assistant actions share domain behavior, not browser selectors. Migrate common action boundaries only as a capability is exposed. Preserve existing workers/outboxes and provider-specific delivery restrictions. Begin with onboarding reads/navigation and the two order-processing mode fields; do not build a generic workflow engine or expose every endpoint.

Each user can persistently enable or disable the assistant through their existing profile boundary. The preference defaults off and is checked at session start and action execution independently of tenant rollout/role gates. Enabling never starts the microphone automatically; disabling stops sessions and invalidates unclaimed proposals without undoing committed domain effects.

## Alternatives

- Browser clicking offers broad apparent coverage but fragile targeting, recovery and confirmation.
- A hosted voice widget still needs the same domain action boundary and adds another workflow/data-processing dependency.
- Independent assistant business services would duplicate validation, authorization and delivery logic.

## Consequences

Each new capability requires a typed adapter, permission and confirmation policy, idempotency/recovery behavior and browser acceptance. This is slower than exposing arbitrary HTTP calls but makes results reviewable and preserves tenant invariants. Settings need atomic preconditions shared by every writer; future messages need explicit assistant-origin provenance, not just the existing optional draft ID. Provider and UI adapters can change without moving business ownership.

The full contract, alternatives, first-release boundary, retention proposals and evidence gates live in the [canonical voice assistant design](../superpowers/specs/2026-10-25-workspace-voice-assistant-design.md). This ADR neither implements the assistant nor approves deployment.
