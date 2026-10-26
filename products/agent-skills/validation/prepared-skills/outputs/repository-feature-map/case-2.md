# Case 2: Missing index and unavailable source

## Buyer-facing response

I cannot confirm that import is implemented correctly from a README and a failing test. I also cannot justify a new import service without seeing whether an existing owner already implements the capability. This isolated review authorizes analysis only, so I have created no service or repository files.

The evidence is fictional supplied material, not an inspected repository:

| Evidence | What it supports | Limit |
|---|---|---|
| Supplied README describes import | Import is documented as intended or claimed behavior | Documentation alone does not establish implementation or runtime behavior |
| Supplied test reportedly fails and expects duplicate rejection | Duplicate rejection is a test expectation and verification is unresolved | Without the test body, failure output and source, the cause could be implementation, fixture, assertion or environment |
| No feature index exists | There is no index to consult or update | This does not imply the import implementation is absent |
| Source unavailable | Ownership and execution path cannot be established | No service, contract, adapter, persistence model, queue or UI owner can be named responsibly |

The current status is “documented import capability; implementation and correctness unverified; duplicate-rejection test reported failing.” The failing expectation must not be silently rewritten to match possible defective behavior. Whether duplicate rejection is the authoritative product rule should be checked against the actual requirement; the README details supplied here do not settle that question.

The reuse decision is pending. Locate the existing entry point and follow its calls to the code that decides import eligibility and persists imported data. That owner is the first candidate for a duplicate-handling fix or extension. A new service is justified only if inspection shows no suitable owner or an explicit architectural need; missing documentation is not that evidence.

The next useful material is the relevant README section, the failing test with its failure output, and the import entry point plus called implementation and persistence code. With source access, use scoped searches for import and the test's referenced symbols, then trace input through validation and duplicate handling to persisted state and any visible outcome. Until then, authorization, tenant boundaries, duplicate keys, transaction behavior and downstream effects remain unknown rather than assumed.

No documentation system needs to be created for this review. Proposed documentation correction, if the README claims correctness or availability: qualify that claim with the unresolved duplicate test and missing acceptance evidence. If later documentation changes are authorized and no canonical feature document exists, use one focused import document with a discoverable link from the existing README. Do not invent an index just to fill a template.

Confirmation would require explaining the failing test, verifying duplicate rejection against the authoritative requirement, and passing the relevant success and failure tests. Any user-visible import flow would also need authorized environment acceptance, including duplicate feedback and saved state after reload where applicable. None of those checks has been performed here.

## Separate skill evaluation

- The skill handles the missing index explicitly and permits a provisional map when source access is absent. It discourages a duplicate service and an unnecessary documentation system.
- No material flaw was observed. The brief template is broad enough that a mechanical response could become an inventory of unknowns; its instruction to scale detail and prefer a concise brief mitigates this. An optional improvement would be a short worked example using only a failing test and inaccessible source, since the current example offers much stronger ownership evidence.

## Evaluation provenance

Read only the evaluated skill and its four linked resources listed in case 1. No source search was simulated, no implementation paths or symbols were invented, and no repository or external actions were taken. The only files written are the two requested evaluation reports.
