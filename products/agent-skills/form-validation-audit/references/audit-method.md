# Validation audit method

## Evidence and classification

Start with the form's declared contract. Record which source files, screenshots, sanitized traces or authorized interactions were actually inspected. A screenshot can show missing visible feedback; it cannot show DOM associations, later persistence or keyboard focus. Mark these unknown until observed. Source can identify a destructive state update without establishing the deployed version or browser outcome.

Classify input errors by whether the user can correct the relevant value. An allow-listed invalid postal code can be a field issue; a provider outage cannot be fixed by changing an unrelated postal code. A 409 may represent a safe field-specific uniqueness issue or a broader conflict depending on the contract. Avoid exposing account existence, credentials or provider diagnostics while improving messages.

Use high severity for lost work, blocked completion, significant exposure or wrong-row actions; medium for materially difficult recovery; low for small clarity problems. Explain severity and confidence rather than treating every missing ARIA attribute as critical. A valid native-validation flow is not defective just because it lacks custom error components.

## Checks by state

- Initial: meaningful labels/instructions, declared required rules, no misleading stale errors. Timing follows the product contract; do not require all forms to use a single validation trigger.
- Invalid submit: clear identification and correction guidance, relevant field/group associations, recoverable keyboard path, values retained where safe. A summary can supplement inline feedback; evaluate the actual pattern rather than prescribing focus mechanically.
- Correction: clear/revalidate the affected error and genuine dependencies; keep unrelated unresolved errors. A confirm-password error may need reevaluation when the password changes. Error removal and validity are distinct states.
- Async: a response belongs to the current submitted values/item identity, not a newer edit or a different reordered row. Pending state, retries and server idempotency boundaries should prevent unintended duplicate effects where applicable.
- Server failure: safe, localized messages; documented field mappings only; no raw API text or credentials. Client checks supplement server validation and authorization.
- Success: explicit visible result, actual saved state, reload persistence and downstream display where relevant. A request sent or button spinner finishing is not proof of persistence.
- Responsive/assistive use: keyboard traversal, focus visibility, usable error wrapping/zoom and actual screen-reader behavior. Programmatic associations support testing; they do not certify that announcements work in every combination.

## Groups and dynamic inputs

Inspect radio/checkbox groups and composite controls as groups, with useful group naming and error association. Check custom control focus behavior against its actual implementation. Stable item keys help locate row errors after sorting or removal; a failed mutation must not silently replace values or erase other rows.

## Primary guidance

Consulted 2026-10-26: [W3C WAI user notifications](https://www.w3.org/WAI/tutorials/forms/notifications/) explains clear overall/inline feedback and error recovery; [W3C WAI validating input](https://www.w3.org/WAI/tutorials/forms/validation/) describes native constraints and the need for server validation. These are guidance references, not a claim that this checklist establishes conformance to every WCAG criterion. Verify current applicable requirements before a formal compliance assessment.
