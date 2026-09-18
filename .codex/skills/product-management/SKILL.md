---
name: product-management
description: Product management workflow for Sales AITO. Use whenever the user asks to define, prioritize, validate, or plan a product feature, customer workflow, MVP slice, roadmap item, PRD, user research, KPI, or go-to-market experiment for the omnichannel AI sales automation product.
---

# AutoSales product management

Use this skill to turn an ambiguous product idea into the smallest testable decision or implementation artifact. Keep the workflow grounded in the current Sales AITO implementation and its omnichannel direction: customer conversations, catalogue matching, AI-assisted orders, delivery, procurement, accounting/export integrations, self-hosting, and tenant-aware data.

## Workflow

1. State the user/problem and the business outcome in one sentence.
2. Identify the affected actor: manager, tenant owner, customer, worker, or operator.
3. Read `docs/features/README.md`, then inspect only the relevant canonical spec, domain models, UI, and tests before proposing work. Reuse or extend existing capabilities instead of creating a parallel implementation.
4. Separate facts from assumptions. Call out missing evidence instead of inventing demand.
5. Prefer a narrow vertical slice with an observable success metric.
6. Preserve the project boundaries: PostgreSQL is the source of truth; Google Sheets is a projection; AI output is untrusted until schema, catalogue, completeness, duplicate, and approval checks pass.
7. For changes that affect customer data or external integrations, include privacy, audit, idempotency, retries, and human-approval implications.

## Choose the artifact

- Feature idea: opportunity statement, assumptions, options, recommendation, and acceptance criteria.
- Discovery: interview goals, hypotheses, questions, evidence log, and decision.
- Prioritization: score only using explicit criteria such as customer value, confidence, effort, risk, and strategic fit.
- PRD/spec: problem, scope/non-scope, user flow, domain/API/UI changes, edge cases, telemetry, rollout, and test plan.
- KPI analysis: metric definition, segment, baseline, target, event source, caveats, and decision threshold.
- GTM experiment: audience, promise, channel, funnel event, budget/timebox, success threshold, and stop rule.

## Output rules

Keep recommendations concrete and implementation-ready. Distinguish “build now”, “validate first”, and “defer”. Do not recommend adopting a SaaS platform when a small local module or existing project capability is sufficient. When proposing a repository or external tool, explain integration cost, data exposure, licensing, and the exact AutoSales capability it unlocks.
