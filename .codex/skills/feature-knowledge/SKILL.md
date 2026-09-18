---
name: feature-knowledge
description: Maintain and use the Sales AITO feature map. Use before planning, implementing, debugging, or documenting product functionality so existing behavior, invariants, integrations, tests, and decisions are reused instead of duplicated.
---

# Sales AITO feature knowledge

Keep product knowledge discoverable without loading the whole repository into one context window.

## Before changing functionality

1. Read `docs/features/README.md` and locate the relevant capability.
2. Read only the linked canonical spec/runbook plus the listed source and test entry points.
3. Search the repository for the domain terms, API route, queue name, data model, and provider before creating new code.
4. Decide whether the request extends an existing capability, replaces it, or is genuinely new. Do not create a second service, schema, queue, integration adapter, or UI flow for behavior already owned elsewhere.
5. Preserve the documented invariants. If code and documentation disagree, verify behavior with tests and update the stale source of truth in the same change.

## While implementing

- Keep provider-neutral domain logic separate from provider adapters.
- Reuse shared contracts and existing tenant, authorization, idempotency, audit, retry, and observability patterns.
- Put detailed design in the feature's canonical document, not in this skill or a second summary file.
- Add a new spec only for a new capability or a material design decision. Link it from `docs/features/README.md` immediately.
- Record future work in the existing backlog or the canonical feature document; do not hide it in chat context.

## Definition of done

A feature change is incomplete until all applicable items are true:

- behavior and non-goals are reflected in the canonical feature documentation;
- the feature index points to the current source, tests, operations guide, and status;
- acceptance tests cover the changed behavior and regression risks;
- setup, environment, rollout, or recovery steps are documented when they changed;
- no secrets, database dumps, runtime state, generated build output, or personal production data are staged;
- the verified change is committed, merged into `master`, pushed, and its short-lived branch is removed.

For architecture choices that are expensive to reverse, add or update an ADR rather than burying the rationale in implementation notes.
