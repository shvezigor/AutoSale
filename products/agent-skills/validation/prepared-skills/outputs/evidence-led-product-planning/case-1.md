# Supplier sync: next product decision

Validate the import obstacle before committing to four providers. The founder owns the decision; the actor is a seller importing a supplier catalogue; the desired outcome is a reviewed, persisted catalogue with less setup friction.

## Evidence and uncertainty

- Supplied sales-call evidence: two callers requested supplier sync. Call dates, customer segment and selection process are absent. This demonstrates interest among those callers, not prevalence or willingness to adopt.
- Supplied product context: reviewed CSV import already exists. Reuse its review and approval flow; actual persistence and ownership boundaries still need confirmation.
- Founder claim: 30% activation gain is an untested hypothesis. Its baseline, activation definition, relative-versus-percentage-point meaning and attribution are unknown.
- Audience size, provider approvals, engineering effort and operational cost are unknown. No numerical prioritization score is justified.

## Options

| Option | Benefit supported by current evidence | Effort/dependencies | Tradeoff |
|---|---|---|---|
| Improve the current reviewed CSV flow | Reuses an existing import path; reduced friction remains hypothetical | Existing flow inspection and evidence of where users struggle | May not address a real need for continuous updates |
| Validate one supplier format using fictional data | Can reveal whether mapping/setup is the obstacle | Owner selects a format; prototype preparation and later authorized testing | Does not establish live-provider reliability or market demand |
| Build four-provider sync | Responds to the requested category; activation benefit unproven | Provider permissions, access, engineering sizing and ongoing operations all unresolved | Broad commitment before demand and feasibility are known |
| Defer supplier work | Preserves capacity | Opportunity cost remains unknown | Leaves the two requests unresolved |

## Recommendation and validation plan

Validate first. Prepare a one-format, reviewed-import prototype brief using fictional files. A candidate slice is saving a column mapping and reusing it after reload, followed by preview, explicit approval and a visible persisted catalogue. Treat this as a candidate to test, not proof that saved mapping solves the requests. Exclude live sync, four-provider coverage, unattended writes, new provider accounts and automatic deletion.

The riskiest assumption is that supplier-format setup materially prevents activation and that a narrower import improvement addresses the underlying need. First inspect available, authorized call notes and existing import evidence to distinguish first-time mapping pain from recurring stock/price synchronization needs. Then obtain a bounded engineering assessment and provider feasibility information where relevant. Preparation is authorized here; outreach, prototype implementation, telemetry activation and a pilot require separate authorization.

For a later authorized pilot, predefine:

- Population/unit: unique eligible seller import sessions for the selected format, entered when import starts; exclude fictional internal test traffic consistently and retain failed sessions.
- Outcome: sessions producing a reviewed, explicitly approved, persisted catalogue visible within 24 hours divided by eligible sessions starting import. Retries do not create extra sessions. This is an import outcome; it is not automatically the business activation metric.
- Baseline: unknown. Establish a fully observed comparable current-flow cohort with the same eligibility and completion definition before interpreting change.
- Threshold: owner to set a minimum useful improvement and required evidence volume before launch, informed by baseline, reachable audience and effort. No numeric target is supported yet.
- Window: proposed two-week intake, followed by full 24-hour follow-up for every included session; extend or conclude inconclusive if volume is sparse. This window is a planning assumption.
- Ownership/budget: founder is decision owner; assign a pilot/measurement owner and approve a capped budget before execution. Neither is supplied.
- Guardrails: no duplicate products, unapproved overwrites, unexpected catalogue deletion or identifying data in reports; track correctness, support burden and operating cost. Stop the pilot on unauthorized writes, data exposure or unexpected saved-data changes; restore the reviewed CSV path.

Proceed toward a narrow build only if evidence supports the specific obstacle and the owner accepts feasibility and cost. Evidence that recurring synchronization is essential would change the candidate slice; confirmed provider constraints could rule it out. Small samples and before/after differences alone cannot establish a causal 30% uplift.

Next step: prepare the fictional one-format validation brief and resolve the activation definition, relevant audience, approval dependencies and engineering effort before any build or live pilot decision.
