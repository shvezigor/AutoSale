# Fictional before / after: supplier contact form

All data and source identifiers here are fictional. This is a review example, not a runnable application or a browser result.

## Supplied evidence

E1 markup: an editable email input has a label but no associated custom error. After invalid submit, a generic toast says "Save failed". E2 source descriptions: every edit clears the entire error object; failure handling replaces all values with empty strings and shows the raw response body. The declared contract requires email format checks, a safe contact-name error and a form-level provider-outage result. No browser or assistive-technology evidence is supplied.

## Audit decision

Prioritize value loss and raw-response exposure, then field-error recovery. E2 establishes problematic source behavior; whether that version is deployed is unknown. E1 supports a generic-feedback problem in the supplied invalid state; actual focus and announcement behavior remain unverified.

| Before | Proposed after |
|---|---|
| Generic toast for invalid email | Safe localized email-format message beside the input, exposed to assistive technology |
| Any edit clears every field error | Revalidate/clear the edited email issue while retaining an unresolved contact-name issue |
| Failure resets the entire form | Preserve safe user-entered contact values; respect any explicit secret/file retention policy |
| Raw provider response is shown | Safe form-level outage message; raw provider text remains excluded |

Illustrative invalid-state markup, assuming the existing implementation uses described-by errors:

```html
<label for="contact-email">Email</label>
<input id="contact-email" name="email" type="email" required
       aria-invalid="true" aria-describedby="email-hint email-error">
<small id="email-hint">Use a contact address you can access.</small>
<small id="email-error">Enter a valid email address.</small>
```

Render the invalid state only when supported by current validation. Keep the hint association when adding the error. On correction, update the error/state according to the product's validation lifecycle; the snippet does not implement that lifecycle. Focus the first reachable invalid control or an actionable error summary according to the existing pattern, revealing hidden sections first where necessary.

Proposed proof: invalid email and contact name show separate safe feedback; keyboard recovery reaches the error; correcting email retains the contact-name issue; provider outage preserves safe values and remains form-level; successful correction saves and survives reload with the downstream contact visible. Source/component checks and real-browser/assistive verification are still required. No WCAG compliance, deployment or successful save is claimed.
