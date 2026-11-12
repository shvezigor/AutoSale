# Settings assistant: A2UI 1.0 versus explicit React

**Date:** 2026-11-12. **Scope:** owner-authorized isolated prototype, not a production assistant release.

## Question and experiment

Does A2UI materially improve the first Sales AITO settings-assistant scenario compared with an explicit React confirmation card?

The [runnable fixture](../../apps/web/dev-fixtures/settings-assistant-prototype/README.md) presents identical Ukrainian cards, shared product CSS, `LoadingButton` and the same fictional API contract. A scripted request proposes `approvalMode: NEVER → ALWAYS`; `intentDetectionMode: AI_SUGGESTION` stays unchanged. A second request demonstrates a no-op. This is intentionally a deterministic UI experiment, not a natural-language accuracy, token-cost, voice or production-permission evaluation.

The React variant has explicit JSX. The A2UI variant uses official `@a2ui/react` and `@a2ui/web_core` **0.15.0**, protocol **1.0**, `createSurface`, `updateComponents`, `updateDataModel`, dynamic data bindings and action events. It registers five narrow product components (Section, Heading, Change, Note, Actions), preserving shared buttons. Structure is supplied as real protocol messages; actions terminate at the same local fixture boundary. Generated text and arbitrary HTML/code/URLs are not accepted.

The local API keeps independent fictional settings for each variant in memory, rejects unknown scenarios, checks the revision and simulates 403/409/503 without contacting production. Refresh reads server state; process restart discards it. These simulations do not prove real authentication, CSRF, tenant isolation or provider availability. The production action executor must still follow [ADR 0003](../adr/0003-workspace-assistant-actions.md) and reuse `OrderSettingsService`, not this mock.

## Comparison and decision

| Concern | Explicit React | A2UI in this prototype |
|---|---|---|
| User outcome | Before/after, confirmation, cancellation, error/retry | Same visible behavior and shared components |
| UI definition | JSX known at build time | JSON structure interpreted by SDK, bound to data |
| Integration work | Direct props and handlers | Catalog schemas/implementations, processor lifecycle, messages, action bridge |
| Extra protocol/runtime payload | None | Lazy chunk 309.04 kB uncompressed, **82.55 kB gzip** in this build |
| Changing composition | Change/redeploy React | Can change supported composition via messages; new component types still require frontend work |
| Authorization/execution | Application responsibility | Same application responsibility |

Build measurements are Vite 7.3.7 production-output sizes, not browser latency or production Next.js bundle estimates. Shared entry is 378.03 kB / 108.09 kB gzip, CSS 212.78 kB / 37.56 kB gzip; both include the same shared product dependencies. The lazy A2UI chunk includes the five adapters and SDK/transitive imports. No inference request was measured, so no model-token or response-speed saving is claimed. The single-variant toggle hides the other card; it is not an independent bundle benchmark.

**Recommendation:** use explicit React for the first fixed settings-confirmation flow. Keep A2UI as an evaluated option if real requirements expand to variable compositions, several client platforms or assistant-hosted surfaces. This experiment demonstrates compatibility, not a reason to commit the production application to another UI runtime. Revisit with real agent-generated schema-constrained messages, bounded validation/failure handling and a representative multi-screen workflow before adopting it.

The isolated fixture is retained for repeatable owner review under the repository's branch/merge policy. It is outside production routes and dependencies. No real assistant implementation, migration, feature flag or deployment was added.

## Verification and limits

The fixture's `acceptance.spec.ts` covers both variants: explicit confirmation before mutation, pending lock, revision increments, saved state after reload, cancellation, no-op, 403/409/503 with unchanged settings and recovery, localized field errors/focus/value preservation, keyboard submit/confirm, URL variant persistence, and no horizontal document overflow at 320/768/1024/1440 px. Screenshots use fictional data. All 12 Playwright acceptance tests passed; TypeScript typecheck and the production fixture build passed. The build has the fixture-only warnings described in its README.

Browser evidence is local Chromium and the Codex in-app browser on 2026-11-12. Screenshots are retained outside Git under `artifacts/settings-assistant-prototype/`. The prototype is Ukrainian-only. English, assistive-technology testing, production API execution, live model output/streaming, Realtime voice, Express inference, multi-device rendering, real downstream settings screens and a production deployment remain outside this experiment. Production-assistant acceptance gates remain open.

## Primary sources checked

- [Google's 1.0 announcement, 2026-11-11](https://developers.googleblog.com/a2ui-10-build-delightful-fast-reliable-agentic-experiences/).
- [Official React renderer README](https://github.com/a2ui-project/a2ui/blob/main/typescript/renderers/react/README.md), plus the installed 0.15.0 type declarations for processor, catalog, actions and child binding.
- [Approved assistant design](../superpowers/specs/2026-10-25-workspace-voice-assistant-design.md), existing `apps/web/src/components/order-settings-form.tsx`, `apps/api/src/settings/order-settings.service.ts`, shared form/action helpers and existing isolated browser-fixture structure.
