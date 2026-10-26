# Profile form validation audit

## Scope and evidence

Provisional supplied-source review for an actor editing contact email and display name to save a profile. Environment, revision, locale, actual display-name constraints and helper ownership are unspecified. The declared contract requires localized inline errors after submit; permission and provider outages remain form-level. No implementation or external actions are authorized.

- E1: Email `aria-describedby` references an existing hint only; invalid email receives a red border and generic toast.
- E2: `onChange` clears the entire error map.
- E3: Failure resets both values and displays the raw provider body.
- C1: Supplied validation and server-failure contract above.

These are source descriptions without file/symbol identifiers. Runtime, focus, screen-reader, deployed-revision, existing-helper and save/persistence evidence are absent. Display name is editable; no extra required, length or format rule is inferred.

## Findings

| Finding | Evidence and consequence | Severity / confidence | Rule and narrow remedy | Reproducible check |
|---|---|---|---|---|
| Confirmed source defect: safe entries lost on failure | E3 resets email and display name, making users repeat work | High / high for supplied source; deployed outcome unknown | Preserve safe entered values on failed save | Inject a controlled failure with fictional entries; assert exact entries remain |
| Confirmed source defect: unsafe provider feedback | E3 displays unfiltered provider body; potential sensitive diagnostic exposure, actual body contents unknown | High / high for rendering behavior, unknown for actual exposure | C1: map documented failures to safe localized form-level messages; exclude raw bodies from UI and audit artifacts | Controlled provider/permission responses show safe non-field feedback with no raw diagnostic text |
| Confirmed contract defect: email feedback lacks specific inline guidance | E1 offers color and generic toast; existing described-by points only to hint | Medium / high | C1: add localized email-format error beside email using established helpers; retain hint association and expose the custom invalid state/error association | Invalid email after submit shows specific adjacent message; inspect valid IDs and supported association/invalid state |
| Confirmed lifecycle defect: unrelated issues erased | E2 clears every error whenever either field changes | Medium / high; simultaneous field issues depend on actual rules | Clear/revalidate only the edited field and real dependencies | With two independently supported issues, edit email; unresolved display-name issue remains. If display name has no independent rule, use an appropriate controlled lifecycle test without inventing a domain rule |

Focus and announcements are unverified, not confirmed missing. A toast can supplement inline feedback. Permission/outage messages belong at form level; inventing a field issue for them would be incorrect.

## Before / after and acceptance plan

First preserve values and replace raw bodies; next repair email guidance and scoped clearing. Reuse the current validation/API owners and visual identity. No form-library replacement is justified.

| Scenario | Proposed acceptance evidence | Status |
|---|---|---|
| Invalid submit | Component and authorized browser: localized inline email error after submit; existing hint retained; predictable keyboard recovery to first invalid field or established actionable summary | Open |
| Correction | Component/browser: correction removes or revalidates email issue; unrelated current issues remain; entered values retained | Open |
| Permission/provider failure | Controlled fixture then authorized browser: safe localized form-level feedback and preserved entries; correction/retry possible | Open |
| Successful correction/save | Authorized browser: explicit confirmation, reload retains saved profile, every affected profile display reflects it | Open |
| Assistive/responsive use | Actual screen reader plus keyboard, supported locale and zoom: error understandable, associated and reachable | Open |

No tests, browser or assistive checks were run. Next, frontend and API owners should identify the existing helper and safe error contracts, then implement and verify these scoped checks in an authorized fictional-data environment. This limited audit does not certify accessibility or security.
