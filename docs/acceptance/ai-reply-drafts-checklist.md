# Catalogue-grounded AI reply drafts — acceptance

Status: **automatic ten-second preparation implemented; full browser and live validation pending**. Do not enable this capability for a production tenant until a consenting owner completes the controlled pilot below. The tenant switch defaults off. Disabling it blocks new generation and draft-linked sending while ordinary manual replies remain available.

## Automatic-preparation acceptance gate

Before marking the automatic slice available, prove all of the following in automated tests and in a real browser:

- one inbound message produces one system-attributed draft only after ten seconds of quiet;
- several inbound messages inside the interval move the deadline and produce one draft grounded in the complete recent block;
- duplicate and out-of-order provider events do not restart the deadline or spend another model request;
- a missed delayed queue wake-up is recovered from PostgreSQL without early or duplicate generation;
- a newer inbound message safely stales queued, processing or ready work for the older anchor;
- a ready draft fills an untouched editor once, survives page reload through persisted draft state, and is not reinserted after a manager edits or clears it;
- existing or deliberately cleared manager text is preserved; the ready draft remains visible but is not silently inserted;
- sending still requires an explicit manager action and creates one linked outbound message;
- disabling the tenant switch prevents scheduling and generation while ordinary manual replies continue to work.
- an ungrounded automatic model result never reaches the editor; a localized fact-free clarification is offered instead, while an equivalent manual retry remains visibly blocked.

## Automated evidence

- Contract, DB/RLS, API, worker and web component tests cover tenant isolation, owner-only editing, idempotent generation, bounded catalogue candidates, structured claim validation, worker lease recovery, stale messages/sources, one linked outbound message and Facebook copy-only behavior.
- API rejects AI-draft use outside Instagram's standard 24-hour window; a separate manager-authored manual reply retains its existing eligibility.
- Worker logs only draft IDs and controlled metadata. The source snapshot, generated text and manager's final text are tenant-scoped and included in the tenant export lifecycle.
- Admin queue health includes the `ai_replies` queue; reconciliation revives eligible queued jobs and fails expired possibly-spent calls without a second provider charge.
- Reply-style reads and saves return only the public settings contract after Prisma persistence; storage metadata cannot invalidate the response and roll back an otherwise valid owner update.

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
