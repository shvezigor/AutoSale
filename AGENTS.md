# Sales AITO repository instructions

Before planning, implementing, debugging, or documenting product behavior, use the project skill at `.codex/skills/feature-knowledge/SKILL.md`.

Start from `docs/features/README.md`. Load only the documentation and source entry points for the capability being changed. Search for an existing contract, service, adapter, queue, database model, UI flow, and tests before introducing another implementation.

Update the canonical feature documentation and feature index in the same change whenever behavior, status, setup, invariants, or ownership changes. Do not rely on chat history as project documentation.

Work in a short-lived `codex/*` branch created from current `master`. Verify and commit scoped increments. Merge into `master`, push it, then delete the merged branch and clean worktree after proving that no unique tracked or untracked work remains.

Never commit `.env`, credentials, OAuth tokens, database dumps, runtime PID/token files, build output, or production personal data. Test fixtures must contain clearly fictional data.
