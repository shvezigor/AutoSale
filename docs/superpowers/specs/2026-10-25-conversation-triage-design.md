# Conversation triage in the workspace inbox

Date: 2026-10-25. Status: approved by owner; implementation in progress. Schema/contracts and status-filtered list, aggregate counts and detail reads are implemented; remaining transitions, ingestion, UI, deployment and browser acceptance are pending.

## Purpose and decision

Owners and managers need a small, reversible way to separate conversations that need attention from customers who stopped responding and from completed sales. The inbox uses three **Sales AITO-only** workflow states:

- `ACTIVE` — work is in progress; the default for every existing and new conversation.
- `INACTIVE` — a manager is waiting after the customer stopped responding.
- `CLOSED` — the manager considers the interaction finished, for example after delivery.

Only a manager/owner moves a conversation between these states. Neither a delivery update nor an inactivity timer moves it automatically. A status is organizational metadata, not an order, shipment, Instagram-folder, AI-draft, or messaging-delivery state. A manager may close a conversation without a linked order; closing never claims that an order was delivered.

The user approved automatic return to `ACTIVE` when a **new inbound customer message** arrives after a manual move to `INACTIVE` or `CLOSED`. The original history and conversation ID remain. A late duplicate or delayed older inbound event must not reopen it. Outbound sends and provider echoes do not move it automatically.

Permanent per-conversation deletion is outside this slice. It would leave references from orders, messages, drafts and exports to resolve, and could be undone by provider re-ingestion. No Meta deletion or Instagram folder operation is offered or implied: the published [Meta Conversations API collection](https://www.postman.com/meta/messenger-platform-api/folder/22794852-255610cd-47f5-4f4d-b3fa-71aec360be9a) lists reads, not a supported conversation-delete operation. Tenant-level export and deletion remain governed by the existing lifecycle policy.

## User experience

The left inbox column has three localized tabs in the order **Активні / Неактивні / Закриті** (and English equivalents). `ACTIVE` is the default view. Each tab shows its tenant-scoped count and an honest empty state. The selected tab is retained in the URL so reload and browser navigation return to the same view; a conversation link preserves this context. The existing conversation-detail and order rail remain readable even when a status change removes the selected row from the current list. A visible status label and action in the detail header let the manager recover without finding the row again.

Each conversation row has a compact **Move to…** action adjacent to, not nested inside, its navigation link. On pointer devices the control is visually emphasized on row hover; it also appears on keyboard focus, and stays visible on touch devices. The opened action list contains only the two other states. Its trigger has an accessible name including the conversation, and the action list supports keyboard open/close, Escape/focus return and visible focus. The header offers the same options on mobile. Use shared button variants and `LoadingButton` for the status mutation; preserve the current light/violet workspace identity. No confirmation dialog is needed for a reversible move; show a concise success status and a localized failure with retry/reload guidance. The action never sends a customer message.

The status tabs filter on the server. Each tab loads its newest page and can request older pages through the existing cursor contract; it must not pretend that the first 50 rows are the complete category. Counts are separate from paged item count and refresh after moves and new inbound processing. Polling may refresh the first page without discarding already loaded older rows or stealing focus while someone is reading. Search is a separate existing inbox control: this change must not present a loaded-page-only filter as a search across all conversations.

This follows the distinction between waiting and resolved conversations described in [Intercom's inbox guidance](https://www.intercom.com/help/en/articles/6564538-snooze-a-conversation), while keeping the user's requested names and manual workflow. The menu follows the [WAI-ARIA menu-button keyboard pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/); hover is enhancement, never the only way to operate it.

## Data and API ownership

Extend the existing `Conversation` row; do not create a second inbox or provider-specific status model. Add a constrained `workflowStatus` with default `ACTIVE`, a monotonic `statusVersion`, and `statusChangedAt`/`statusChangedByUserId` metadata. Existing rows backfill to `ACTIVE` without rewriting messages or orders. The existing forced tenant RLS remains the authority for reads and writes. Index `(tenant_id, workflow_status, last_message_at, id)` for paged status lists; inspect the query plan before assuming the index suffices for growing count queries.

Extend `packages/contracts/src/conversations.ts` with status/version on list and detail records. `GET /api/conversations` keeps its current unfiltered default for existing callers, and accepts an optional validated `status` filter with the existing bounded cursor/limit. A tenant-scoped counts endpoint returns only the three aggregate numbers, never message content. A manager-authorized `PATCH /api/conversations/:id/status` accepts the target state and expected `statusVersion`; it uses the existing authenticated CSRF-protected mutation path and a tenant-scoped conditional update. A stale version returns a safe conflict, a missing/cross-tenant ID returns the same not-found response, and an invalid state returns a localized validation error. Repeating the already-current state with the current version is a no-op. Successful responses return the persisted state/version/timestamp. Do not expose raw database or provider errors.

The shared `apps/worker/src/social/social-inbound-ingestion.service.ts` handles all supported channels. After a **newly inserted** inbound `Message`, it conditionally reopens a non-active conversation only if the provider source timestamp is later than the last manual status change. This update and message insertion occur in the same tenant transaction, increment `statusVersion`, and set the actor to system/null. Duplicate delivery, historical replay, attachment repair and outbound echo must not reopen. Competing manager changes and inbound processing use the version/conditional predicate so a stale browser action cannot silently overwrite a newer inbound return to `ACTIVE`. Existing order recognition and AI-draft scheduling continue from the same inbound message without additional dispatch.

Include the new status metadata in the explicit tenant lifecycle export dataset. No new retention or deletion rule is introduced; conversation-data retention is still unconfigured. Metrics/logs may record bounded state-transition counts and safe reason codes but never participant identity or message contents.

## Failure handling and rollout

A failed status update leaves the row in its last confirmed category and shows a recoverable error. On `409`, refresh list, counts and detail before allowing a new choice. A polling failure retains the last usable list with a visible retry path for the status mutation; it must not display a false success. A new inbound message during a manual move is resolved by the conditional/versioned transaction and reflected on the next list refresh. Opening an old link can still display a conversation regardless of the selected tab.

Ship the additive migration before API/worker/web changes, with the existing backup and manual deployment process. No feature flag is required because default `ACTIVE` preserves existing data and no provider action occurs. Keep the repository's existing channel feature gates unchanged. Rollback of the app may ignore the new columns; rollback must not delete status data without a separate migration/backup decision.

## Implementation evidence

The existing manager API now accepts the optional validated `status` filter while preserving unfiltered callers and cursor pagination. `GET /api/conversations/status-counts` returns zero-filled tenant-only aggregates; list/detail expose persisted `workflowStatus` and `statusVersion`. Fictional PostgreSQL service and HTTP controller tests cover filtering, pagination, counts, foreign-detail denial, invalid status and manager authorization. Representative local `EXPLAIN` queries use `conversations_tenant_status_last_message_id_idx` for both the ordered page (index-only scan) and tenant count aggregate (bitmap index scan); no additional index is justified by that fixture. This does not establish production-scale count performance or close browser acceptance.

## Verification

- Contract and PostgreSQL tests: old-row default, tenant RLS, status-filter pagination, exact aggregate counts, invalid input, no-op, role checks, cross-tenant denial, stale-version conflict and concurrent change/inbound races.
- Worker tests with fictional Instagram/Facebook/TikTok events: genuinely new inbound reopens; duplicate, older delayed event, attachment repair and outbound echo do not; order recognition and AI-draft dispatch remain idempotent.
- Web component and end-to-end tests: tab navigation/counts, move and reverse move, selected detail persistence after row disappears, loading/error/conflict states, older-page access, URL/reload persistence, Ukrainian/English copy and no provider outbound call.
- Real-browser acceptance after deployment: authorized fictional/test-account conversations at 320, 768, 1024 and 1440 px, keyboard, touch and 200% zoom; verify saved status after reload and its visible downstream list/detail result. Capture final screenshots. Do not send Instagram messages or alter real customer conversations solely for this test without explicit authorization.

## Explicit non-goals

No permanent delete or Meta inbox deletion; no automatic status change on delivery, elapsed time, manager reply or outbound echo; no bulk actions, assignment/SLA system, new message-search service, customer-facing notification, or change to order/delivery state.
