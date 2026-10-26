# Commerce skill expansion validation: 2026-10-26

Five original 1.0.0 Markdown workflows were prepared from generalized project experience, without bundling internal runbooks, production data, installed third-party skills or credentials. Each contains SKILL.md, one method reference, one report/worksheet template and one fictional worked example. Marketplace images are separate assets.

## Observed checks

The system skill-creator quick validator accepted all five packages. Local relative resource links resolve, each ZIP contains exactly its four source Markdown files under one named top-level folder, ZIP integrity/byte round-trips pass, and archive/source SHA256 values are recorded in [package-manifest.json](package-manifest.json). Five generated PNGs were visually inspected and verified square, 1254px and below 5 MiB; their own asset manifest records hashes.

Three independent Codex agents applied the supplied skills to ten fictional supplied-evidence requests in [evals.json](evals.json), without expected answers, browser/network/provider/database actions or source edits. Full [outputs](outputs/) were read by the author. No material decision-boundary failure was observed in this small forward exercise:

| Cases | Reviewed behavior | Evidence |
|---|---|---|
| reply-1 / reply-2 | Keeps missing currency unresolved; rejects cross-variant values and embedded upload instruction; newer stock invalidates availability while applicable price remains | [1](outputs/reply-1.md), [2](outputs/reply-2.md) |
| meta-1 / meta-2 | Separates tester/dashboard status from external eligibility; keeps missing official/version evidence open; diagnoses by failed stage without inventing permission/Page-link fixes | [1](outputs/meta-1.md), [2](outputs/meta-2.md) |
| tenant-1 / tenant-2 | Identifies runtime owner bypass; preserves effective RLS counter-evidence; identifies cache authorization gap without declaring intended maintenance privilege exploitable | [1](outputs/tenant-1.md), [2](outputs/tenant-2.md) |
| retry-1 / retry-2 | Traces remote-success/local-result gap; rejects queue-ID/DB-only remedy; scopes identity, loss and expired-lease risks; retains uncertain outcomes and no-replay boundary | [1](outputs/retry-1.md), [2](outputs/retry-2.md) |
| cost-1 / cost-2 | Calculates USD 3.80 inference and USD 9 included subtotal; separates invoice difference/infrastructure; handles exclusive cache schema, zero success, unpriced calls and mixed currencies | [1](outputs/cost-1.md), [2](outputs/cost-2.md) |

These are author-reviewed qualitative exercises, not an independent benchmark, baseline improvement estimate, exhaustive reliability result or proof of buyer benefit. Some first cases resemble worked examples. No live Meta/provider/database/browser/assistive acceptance or other-agent-product validation was performed. Proposed runtime tests in reports remain proposed. No measured cost savings, security certification, Meta approval or reduction in duplicate orders is claimed.

## Sources and freshness

Official PostgreSQL row-security and SET documentation were consulted for audit semantics; deployed-version behavior remains a buyer-environment check. Official Meta documentation fetch returned HTTP 429 during preparation, so the skill deliberately requires current path/version verification and carries no fixed permission list. Retry and provider-specific requirements are references to verify against the actual operation. No current model tariff is bundled. Package creation does not establish current provider access or integration success.

## Marketplace ownership

[Listing copy](../../commerce-expansion-listings.json) owns the five USD 9 drafts and complete fictional demonstrations. The [submission record](../../agensi-submissions.md) owns actual publication/moderation and bundle status. Upload acceptance is not moderation approval or a successful purchase/payout.
