# Conversation triage acceptance

Date: 2026-10-25. Status: deployed and manually verified for status moves; isolated end-to-end inbound and conflict checks remain pending. Canonical behavior: [approved design](../superpowers/specs/2026-10-25-conversation-triage-design.md).

## Evidence boundaries

All database, worker and API fixtures use fictional data in disposable PostgreSQL containers. The migration regression seeds conversations and message history against the schema immediately before `20261025160000_conversation_triage`, asserts the status column is absent, applies the additive migration, then checks ACTIVE/version zero/null actor and timestamp, preserved message linkage, forced RLS and foreign-tenant denial. It does not substitute a post-migration insert for an upgrade test.

The API service suite covers filtered cursor pages, full tenant-only counts, conditional manager writes and the overlapping inbound/manager race. The earlier Task 2 representative EXPLAIN evidence recorded an index-only scan for the page and bitmap index scan for counts using `conversations_tenant_status_last_message_id_idx`; this is not production-scale performance evidence or a fresh Task 7 query-plan measurement. The existing explicit tenant export tests include status/version/change metadata. Cross-channel worker fixtures cover new inbound, duplicate/equal/older events, repair and echo; no provider delivery is requested by triage.

## Commands and results

The affected package suites run sequentially to avoid competing Docker startups. The initial worker and web runs exposed stale test fixtures; their focused and full reruns are recorded below.

| Command | Result |
|---|---|
| `corepack pnpm --filter @autosale/contracts test` | 22 files / 128 tests passed |
| `corepack pnpm --filter @autosale/database test` | 43 files / 193 tests passed; final upgrade precondition also passed focused (5 tests) |
| `corepack pnpm --filter @autosale/api test` | 120 files passed, 1 skipped / 749 tests passed, 4 skipped (opt-in disposable Redis quota/outage checks not configured) |
| `corepack pnpm --filter @autosale/worker test` | Initial run: 536 passed, 1 failed, 2 skipped (historical migration subset). Final rerun: 79 files passed, 2 skipped / 537 tests passed, 2 skipped (opt-in catalogue benchmark/full-worker acceptance) |
| `corepack pnpm --filter @autosale/web test` | Initial run: 543 passed, 1 failed (stale layout mock). Final rerun: 110 files / 544 tests passed |
| `corepack pnpm build` | Passed, exit 0 |
| `corepack pnpm typecheck` | Passed, exit 0 |
| `corepack pnpm exec playwright test tests/e2e/conversation-inbox.spec.ts` | 4 skipped: no `E2E_OWNER_EMAIL` / `E2E_OWNER_PASSWORD`; exit 0 is not browser acceptance |

Additional focused checks: `corepack pnpm --filter @autosale/database exec vitest run src/conversation-message-rls.postgres.spec.ts --maxWorkers=1` (5 passed), `corepack pnpm --filter @autosale/worker exec vitest run src/instagram/instagram-avatar-cleanup-reconciler.spec.ts --maxWorkers=1` (5 passed), and `corepack pnpm --filter @autosale/web exec vitest run layout.spec.tsx` (3 files / 6 tests passed). Standalone E2E TypeScript validation passed with `corepack pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2023 --module ESNext --moduleResolution Bundler --typeRoots apps/web/node_modules/@types --types node tests/e2e/conversation-inbox.spec.ts`.

The worker fixture used an explicit historical migration subset; Prisma now returns triage columns from `conversation.create`, so adding the triage migration fixes the missing-column failure without changing application behavior. The layout fixture lacked the newly imported counts API and navigation hooks; its updated assertion verifies the Active initial query and full aggregate counts.

Local logs are untracked under `artifacts/triage-task7/`; they are not release artifacts or committed source.

## Isolated Playwright prerequisite and coverage

Use the existing isolated Compose pattern in `infra/compose.lifecycle-acceptance.yaml` and owner registration/bootstrap from `infra/scripts/run-tenant-lifecycle-acceptance.ps1`. That runner currently provisions lifecycle users only; it does **not** seed an Instagram connection or run triage. A triage fixture must additionally link an ACTIVE fictional Instagram account to the fictional owner's tenant, leave provider credentials absent, disable provider egress and AI/provider side effects, and provide the signing secret used by that isolated API. Do not point this suite at a production account.

Set `E2E_BASE_URL`, `E2E_OWNER_EMAIL`, `E2E_OWNER_PASSWORD`, `E2E_INSTAGRAM_ACCOUNT_ID`, `META_APP_SECRET`, and `E2E_TRIAGE_ISOLATED=1` only after those prerequisites are true. The last variable is an operator assertion, not an enforced network sandbox. No triage fixture stack or owner credentials were available for this run, so the new browser scenario is authored but unexecuted.

The new `conversation-inbox.spec.ts` scenario signs a unique fictional inbound, finds its conversation, moves Active → Inactive → Active → Closed, reloads and verifies the list and detail, retains the selected detail after its row disappears, and checks URL/tab persistence. Invalid input reaches the actual API through an intercepted browser request; a competing API manager write forces a real 409 before the stale browser request. The scenario then signs/replays a new inbound, checks one message/version increment, sees Active after reload, and asserts no outbound message record or browser outbound mutation. Those assertions do not themselves observe server network egress; the isolated fixture and worker tests own that separate boundary.

- [ ] Execute the new Playwright scenario without skips against the isolated fixture.
- [ ] Inspect browser traces/screenshots and fix any runtime-only issue before claiming local browser acceptance.

## Controlled release — 25 October 2026

- [x] Review the whole branch, run merged-result checks, merge/push and verify remote SHA. The full merged run passed 2,411 tests with six documented opt-in skips; the visual-fix web run passed 548 tests. The scoped fix received a separate review with no Critical or Important findings.
- [x] Record verified backup and rollback reference under the [backup runbook](../operations/backup-restore.md). The pre-release backup is the local private directory `backups/20261025T141848Z` (PostgreSQL, MinIO and configuration checksums verified); it must not enter Git.
- [x] Apply the additive migration, deploy API/worker/web manually under the [deployment runbook](../operations/deployment.md), verify health, and record actual SHA/environment. Migration `20261025160000_conversation_triage` applied successfully on the current Windows Docker host; all Compose services were healthy and `https://sales-aito.com/health/live` returned HTTP 200. Feature release `e9f28aad`; web styling correction `92d4a51`, both pushed to `origin/master`. Docker Desktop was updated in place to 4.96.3 after its older engine failed to restart; existing volumes and services recovered.
- [x] With an authorized test account, verify move/reverse move, reload persistence and tab/count/detail downstream effects. A pre-existing test conversation moved Active → Inactive → Closed → Active through row and detail menus. Counts changed 18/0/0 → 17/1/0 → 17/0/1 → 18/0/0; detail status and the selected tab followed; reload preserved both the intermediate Inactive and final Active state. No customer response was sent. Browser conflict/error recovery remains unverified.
- [ ] Verify the complete responsive and accessibility matrix. The tabs and controls were reachable at 320, 390, 768, 1024 and 1440 px; the menu closed with Escape and restored trigger focus; Ukrainian and English labels were checked. Touch input and 200% zoom were not tested. Final desktop/mobile/menu screenshots are private ignored files in `artifacts/conversation-triage-sdd/browser/` and must not be committed.
- [ ] Verify authorized new inbound reopening without any outbound customer/provider send. Do not send real customer messages to produce evidence.

The Playwright scenario remains skipped because the isolated Instagram fixture and owner credentials were not provisioned. API and worker tests cover conflict and inbound reopening, but they do not replace the missing live browser/provider checks. This feature therefore remains **Validation pending**.
