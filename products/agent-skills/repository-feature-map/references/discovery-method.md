# Focused discovery

Start from the requested observable behavior. Search terms should include the user-facing label, domain noun, route/event name and provider name when applicable. Trace caller → contract → owner → state → downstream result; use the existing test nearest each boundary as corroboration.

Maintain a small evidence ledger: claim, file/symbol, what it establishes, and what it does not establish. References supplied as snippets are partial evidence; do not pretend to inspect files not supplied or accessible. If access is unavailable, give a provisional map with a precise missing-file request.

An adapter may only translate external payloads. A projection may display data without owning it. A queue may transport an ID while the database owns retry state. Follow writes and business decisions to locate ownership; do not move logic based only on file naming.

When documentation says available and code is gated, distinguish code implementation from environment configuration. When tests conflict with the requirement, identify which behavior each asserts and ask for the product decision only if it cannot be resolved from authoritative material. Do not make unrelated changes to settle uncertainty.

For evidence-based status, use the repository vocabulary. If none exists: planned = intended only; implemented = code present with stated verification; validation pending = required integration/environment check missing; available = supported by applicable test and acceptance evidence. A status is scoped to the documented environment and date, not an eternal claim.
