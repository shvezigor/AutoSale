---
name: user-session-analysis
description: Privacy-aware user session analysis for AutoSales. Use whenever the user asks to understand onboarding, inbox, order-review, catalogue-import, OAuth-wizard, or other product UX behavior from session recordings, analytics, funnels, or drop-off data, including OpenReplay evaluation or instrumentation planning.
---

# AutoSales session analysis

Use session evidence to find actionable UX or reliability problems, not to watch users indiscriminately. AutoSales handles personal conversations, phone numbers, addresses, images, and order data, so privacy is part of the analysis.

## Before analysis

- Define the decision, user segment, time window, and success event.
- Prefer aggregated metrics and targeted recordings over broad surveillance.
- Confirm that recording is lawful and disclosed for the deployment context.
- Mask or exclude names, phone numbers, addresses, message text, images, tokens, OAuth codes, cookies, headers, and catalogue fields that can identify a person or business.
- Never export raw recordings or personal data into tickets, prompts, screenshots, or third-party tools without explicit authorization.
- Use self-hosting and retention limits where OpenReplay is evaluated; document who can access recordings.

## Analysis loop

1. Form a hypothesis, such as “managers abandon order approval after an ambiguous SKU appears.”
2. Choose a funnel and supporting events: page/view, wizard step, validation error, retry, approval, export success, and abandonment.
3. Segment by role, tenant, browser/device, integration state, and error state; avoid re-identifying individuals.
4. Review a small sample of masked sessions around the event.
5. Separate UX friction, product misunderstanding, external-provider failure, and application defects.
6. Quantify frequency, affected users, severity, and confidence.
7. Recommend the smallest fix and define the follow-up metric.

## AutoSales priority funnels

- Google OAuth: start → consent return → Picker selection → validation → connected.
- Catalogue import: source setup → mapping → preview → import → row/error result.
- Order review: inbox → draft → ambiguity correction → approval → Sheets export.
- Instagram operations: webhook arrival → conversation normalization → media available → order trigger.

## Report format

Return: decision, evidence window/segment, key findings, privacy limitations, ranked actions, instrumentation gaps, and validation metric. Treat session replay as supporting evidence; it must not override audit logs, domain state, or reproducible error telemetry.
