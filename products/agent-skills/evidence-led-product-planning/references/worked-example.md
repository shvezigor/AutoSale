# Fictional example: automatic catalogue import

Input: two sales calls request automatic supplier imports. The existing product supports reviewed CSV import. A founder proposes a four-provider sync service and claims it will raise activation by 30%. No baseline, reach estimate, provider approval or engineering estimate is available. Request: decide the next product step, without implementing or contacting customers.

Evidence: two requests establish interest among those callers. Their selection and broader prevalence are unknown. Existing reviewed CSV import is a reusable flow. The 30% uplift is an untested hypothesis.

Options: improve the existing CSV mapping flow; prototype one supplier format using fictional files; build all four providers. Benefit and effort estimates for the broad service are unsupported, so do not compute RICE scores or rank with invented reach.

Recommendation: validate first with one reviewed supplier-format prototype. Keep final import approval and the existing catalogue authority. Non-goals: live synchronization, unattended overwrites, new provider accounts and automatic catalogue deletion. A saved mapping reused after reload is a narrow vertical slice that can test whether format setup is a material obstacle.

Proposed metric: eligible prototype import sessions resulting in a reviewed, persisted catalogue within 24 hours / eligible prototype sessions starting import. Baseline is unmeasured; the owner should define a decision threshold before a pilot. A proposed two-week observation window is a planning assumption, extended if evidence is sparse. Guardrails: no duplicate products, no unapproved overwrites and no supplier/customer identifiers in reports. Stop on unexpected changes to saved data.

Acceptance example: given a fictional required column is unmapped, submit shows a field-specific error, focuses it and preserves the other mappings; correcting it permits preview and explicit approval; reload displays the approved catalogue. No test is claimed passed. The next authorized step is preparing the fictional prototype brief, not running a live pilot.
