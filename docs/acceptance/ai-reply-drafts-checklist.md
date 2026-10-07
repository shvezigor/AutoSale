# Catalogue-grounded AI reply drafts — acceptance

Status: **automatic ten-second preparation implemented; partial production-browser evidence recorded; remaining live validation pending**. Do not enable this capability for a production tenant until a consenting owner completes the controlled pilot below. The tenant switch defaults off. Disabling it blocks new generation and draft-linked sending while ordinary manual replies remain available.

## Automatic-preparation acceptance gate

Before marking the automatic slice available, prove all of the following in automated tests and in a real browser:

- one inbound message produces one system-attributed draft only after ten seconds of quiet;
- several inbound messages inside the interval move the deadline and produce one draft grounded in the complete recent block;
- duplicate and out-of-order provider events do not restart the deadline or spend another model request;
- a later attachment-only provider event does not stale the pending or processing draft for the latest textual message;
- a missed delayed queue wake-up is recovered from PostgreSQL without early or duplicate generation;
- a newer inbound message safely stales queued, processing or ready work for the older anchor;
- a ready draft fills an untouched editor once, survives page reload through persisted draft state, and is not reinserted after a manager edits or clears it;
- existing or deliberately cleared manager text is preserved; the ready draft remains visible but is not silently inserted;
- sending still requires an explicit manager action and creates one linked outbound message;
- disabling the tenant switch prevents scheduling and generation while ordinary manual replies continue to work.
- ungrounded or malformed automatic model output never reaches the editor; an explicit model-options request receives deterministic exact catalogue variants when primary-name matches exist, otherwise a localized fact-free clarification is offered, while a provider outage and equivalent manual retry remain visibly failed or blocked;
- a ready draft for the latest inbound message remains visible and fills an untouched editor even if newer retries for that same message failed.

## Automated evidence

- Contract, DB/RLS, API, worker and web component tests cover tenant isolation, owner-only editing, idempotent generation, bounded catalogue candidates, structured claim validation, worker lease recovery, stale messages/sources, one linked outbound message and Facebook copy-only behavior.
- API rejects AI-draft use outside Instagram's standard 24-hour window; a separate manager-authored manual reply retains its existing eligibility.
- Worker logs only draft IDs and controlled metadata. The source snapshot, generated text and manager's final text are tenant-scoped and included in the tenant export lifecycle.
- Catalogue retrieval and processor tests prove explicit model-options requests exclude compatibility-only parenthetical matches and build verified exact-name option lists.
- Admin queue health includes the `ai_replies` queue; reconciliation revives eligible queued jobs and fails expired possibly-spent calls without a second provider charge.
- Reply-style reads and saves return only the public settings contract after Prisma persistence; storage metadata cannot invalidate the response and roll back an otherwise valid owner update.
- Focused worker, API and web acceptance runs on 7 October 2026 passed 10 files / 50 tests. They include the active-generation race (a newer inbound message stales the processing draft), disabling before execution (the model is not called), quiet-period scheduling, duplicate/out-of-order delivery, reconciliation, safe-output validation and the manager-controlled composer.
- The Instagram text-plus-attachment regression is automated: a later attachment-only row leaves the textual anchor current both before and during generation, while a genuinely newer textual message still stales old work.

## Production-browser evidence

- On 5 October 2026, a consenting test tenant received an automatic draft for an explicit model-options request. The production worker returned a grounded `ANSWER` containing only the three primary-name `Регіон` catalogue variants; compatibility-only accessory matches were absent. After a reload, the same ready text and the three safe catalogue sources were visible and the untouched reply editor contained the ready draft.
- The manager later explicitly sent that draft. A follow-up browser review on 7 October 2026 showed exactly one sent outbound message. The tenant-scoped audit row was `USED`, linked to exactly one outbound message, and its final text matched the generated text. No automated send occurred.
- On 7 October 2026, the consenting test tenant sent two textual inbound messages 2.812 seconds apart. Each persisted row received its own ten-second deadline, the first scheduled draft became `STALE` with zero attempts and no model request, and the latest anchor produced one `READY` draft with one model attempt. Neither row had an outbound message. This proves that an inbound burst moves the effective deadline and does not spend a model request on superseded work.
- In the same production-browser check, the ready draft filled an untouched editor. A fictional manager test value remained unchanged through multiple polling cycles, then a deliberately cleared field remained empty while the ready draft stayed visible. Reloading created a new untouched editor and restored the persisted ready draft. No send action was invoked. Application code produced no console error; observed warnings belonged only to a browser extension.
- On 7 October 2026, the tenant owner disabled AI drafts in production, saved the setting and reloaded the page. The setting remained disabled, the AI-draft surface disappeared from an eligible Instagram conversation, and the ordinary manual reply editor remained enabled. The owner then re-enabled the feature, saved and reloaded; the settings row returned to `Active`. No customer message was sent during this check. Application code produced no console error; observed warnings belonged only to a browser extension.
- This evidence covers the exact-options fallback, multi-message debounce, no-spend supersession, persisted ready state after reload, untouched-editor insertion, manager edit/clear preservation, one explicitly sent linked outbound and disabled-switch/manual-composer behavior. The active-processing race is covered by automated tests but still lacks a controlled live reproduction. Facebook copy-only behavior, eligible TikTok delivery, product mutation while pending and the remaining failure/provider-window scenarios are also pending in a live browser.

## Controlled live pilot

1. Deploy the migration and worker with the existing worker-only `OPENAI_API_KEY` and `OPENAI_MODEL`; confirm API, web, worker and `ai_replies` queue are healthy. Do not paste credentials into screenshots or tickets.
2. In a fictional or consenting tenant with a small catalogue, set a company name and communication style under **Settings → Social / customers → AI reply style**, then enable drafts.
3. For Instagram and an eligible TikTok conversation, send a short inbound block, wait for automatic preparation, review the source products and text, edit it, then explicitly send once. Confirm one outbound message, one `USED` draft and the exact final text in the audit record.
4. For Facebook, verify the draft can be reviewed and copied, but no Facebook API send action appears.
5. Change or deactivate a product and send a new inbound message while a draft is pending. Confirm the old draft becomes `STALE`, the editor's typed text survives polling, and no outbound message is created from it.
6. Confirm missing stock, missing currency, ambiguous products, an unsupported promise, model timeout and provider outage result in safe clarification/handoff or a visible failure, never an unverified product promise.
7. Test a manager's ordinary manual Instagram reply during the 24-hour to 7-day `HUMAN_AGENT` interval, then confirm the same interval rejects draft-linked sending.
8. Disable drafts and confirm manual replies still work. Review privacy-minimized queue/error metrics and check that no customer message or prompt appears in logs.

The pilot targets in the canonical spec are hypotheses, not measured results. Any critical factual, privacy or duplicate-send incident calls for immediately disabling the tenant switch and returning to manual replies.
